import { promises as fs } from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Work, IWork } from '../models/work.model';
import { AnnounceType } from '../models/govSite.model';
import { resolveTorFilePath } from '../services/fileStorage.service';
import { extractPdfContent } from '../services/pdfText.service';
import { applyWorkFacts } from '../services/workFacts.service';
import { ProcurementFacts, mergeProcurementFacts } from '../utils/procurementFacts';

/**
 * One-off catch-up for works ingested before the procurement method, fiscal
 * year and bid deadline were read (npm run backfill:facts [-- --dry-run]
 * [--limit=N]).
 *
 * Ingestion only reads a work's facts when something about it changes, so the
 * works already in the database would otherwise stay without a method tag, a
 * fiscal year or a deadline until their next lifecycle event. This applies the
 * same rules (services/workFacts.service.ts) to every work using only what is
 * already local -- the title, and the PDFs already stored on disk -- so it makes
 * no network call and no AI call. An HTML-only work (a winner page, which is
 * read but not stored) is therefore covered by its title alone.
 *
 * Writes are targeted ($set / $addToSet), never a whole-document save, so a
 * poll running at the same time can't be overwritten.
 */
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || undefined;

// Documents are applied oldest-stage first, so the newest one wins where they
// disagree -- an amendment (D2) can move the deadline a draft or invitation set.
const STAGE_ORDER: Record<string, number> = { D0: 2, D2: 3 };
const stageRank = (type: string): number => STAGE_ORDER[type] ?? 1;

// Stored PDFs only (current ones), grouped by the announce type they belong to.
async function readFactsByStage(work: IWork): Promise<Map<AnnounceType, ProcurementFacts>> {
  const byStage = new Map<AnnounceType, ProcurementFacts[]>();

  for (const torFile of work.torFiles) {
    if (!torFile.storageKey || torFile.supersededAt) continue;
    if (!/\.pdf$/i.test(torFile.storageKey)) continue;

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolveTorFilePath(torFile.storageKey));
    } catch {
      console.warn(`  ! ${work.projectId}: stored file ${torFile.storageKey} is missing -- skipped`);
      continue;
    }

    const content = await extractPdfContent(buffer, torFile.filename ?? torFile.storageKey);
    if (!content.facts) continue;
    const list = byStage.get(torFile.announceType) ?? [];
    // A zip's primary document is listed first by ingestion, so it keeps priority.
    list.push(content.facts);
    byStage.set(torFile.announceType, list);
  }

  return new Map([...byStage].map(([type, list]) => [type, mergeProcurementFacts(...list)]));
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const works = await Work.find({}).limit(LIMIT ?? 0);
  console.log(`${DRY_RUN ? '[dry run] ' : ''}${works.length} work(s) to check...`);

  const stats = { changed: 0, methodAdded: 0, fyDocument: 0, fyEstimated: 0, deadlines: 0, unchanged: 0 };

  for (const work of works) {
    const hadMethodFy = { fy: work.fiscalYear, source: work.fiscalYearSource };
    const hadDeadline = work.deadlineAt?.getTime();
    const addedTagIds: mongoose.Types.ObjectId[] = [];
    let changed = false;

    // The title alone first (method + an estimated year), then each stage's
    // documents on top of it.
    const base = { title: work.title, reference: work.pubDate, dryRun: DRY_RUN };
    const fromTitle = await applyWorkFacts(work, { ...base, announceType: work.announceType });
    changed ||= fromTitle.changed;
    addedTagIds.push(...fromTitle.addedTagIds);

    const stages = [...(await readFactsByStage(work))].sort((a, b) => stageRank(a[0]) - stageRank(b[0]));
    for (const [announceType, documents] of stages) {
      const result = await applyWorkFacts(work, { ...base, announceType, documents });
      changed ||= result.changed;
      addedTagIds.push(...result.addedTagIds);
    }

    if (!changed) {
      stats.unchanged += 1;
      continue;
    }

    stats.changed += 1;
    if (addedTagIds.length > 0) stats.methodAdded += 1;
    if (work.fiscalYear !== hadMethodFy.fy || work.fiscalYearSource !== hadMethodFy.source) {
      if (work.fiscalYearSource === 'document') stats.fyDocument += 1;
      else stats.fyEstimated += 1;
    }
    if (work.deadlineAt && work.deadlineAt.getTime() !== hadDeadline) {
      stats.deadlines += 1;
      console.log(`  + ${work.projectId}: deadline ${work.deadlineStartAt?.toISOString() ?? '-'} -> ${work.deadlineAt.toISOString()}`);
    }

    if (DRY_RUN) continue;

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};
    if (work.fiscalYear) {
      $set.fiscalYear = work.fiscalYear;
      $set.fiscalYearSource = work.fiscalYearSource;
    }
    if (work.deadlineAt) {
      $set.deadlineAt = work.deadlineAt;
      $set.deadlineHasTime = work.deadlineHasTime;
      if (work.deadlineStartAt) $set.deadlineStartAt = work.deadlineStartAt;
      else $unset.deadlineStartAt = 1;
    }
    await Work.updateOne(
      { _id: work._id },
      {
        ...(Object.keys($set).length > 0 ? { $set } : {}),
        ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        ...(addedTagIds.length > 0 ? { $addToSet: { tags: { $each: addedTagIds } } } : {})
      }
    );
  }

  console.log(
    `\nDone${DRY_RUN ? ' (dry run -- nothing written)' : ''}: ${stats.changed} of ${works.length} work(s) updated ` +
      `(${stats.methodAdded} got a procurement-method tag, ${stats.fyDocument} a fiscal year stated in the document, ` +
      `${stats.fyEstimated} an estimated fiscal year, ${stats.deadlines} a bid deadline); ${stats.unchanged} already complete.`
  );
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:facts failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
