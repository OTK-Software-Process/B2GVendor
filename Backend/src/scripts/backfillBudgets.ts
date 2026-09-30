import { promises as fs } from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Work, IWork } from '../models/work.model';
import { resolveTorFilePath } from '../services/fileStorage.service';
import { extractPdfContent } from '../services/pdfText.service';
import { explainMissingBudget, ExtractedTorFile } from '../services/ingestion.service';
import { mergePriceCandidates, pickBestPrice } from '../utils/priceExtraction';

/**
 * One-off repair for works that were ingested with no price (npm run
 * backfill:budgets [-- --dry-run]).
 *
 * The ingestion pipeline only re-reads a document when a NEW one arrives, so
 * works whose price the AI skipped before the "บาท" scan existed would stay
 * price-less forever. This re-scans the PDFs already stored on disk for every
 * work that has no price -- purely local: no AI calls, no network -- and:
 *   - fills in the price when a labelled ราคากลาง / วงเงิน amount is found;
 *   - otherwise records WHY there's none (Work.budgetMissingReason), which the
 *     website turns into a meaningful message instead of a bare "0".
 * It never overwrites an existing price.
 */
const DRY_RUN = process.argv.includes('--dry-run');

// Same shape ingestion.service builds while downloading, rebuilt from disk.
async function readStoredFiles(work: IWork): Promise<ExtractedTorFile[]> {
  const files: ExtractedTorFile[] = [];

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
    files.push({
      storageKey: torFile.storageKey,
      filename: torFile.filename ?? torFile.storageKey,
      role: torFile.role,
      pdfText: content.text,
      hasText: content.text !== null,
      priceCandidates: content.priceCandidates
    });
  }

  return files;
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const works = await Work.find({ $or: [{ budget: { $exists: false } }, { budget: null }, { budget: 0 }] });
  console.log(`${DRY_RUN ? '[dry run] ' : ''}${works.length} work(s) have no price -- scanning their stored documents...`);

  let recovered = 0;
  let reasonsSet = 0;

  for (const work of works) {
    const files = await readStoredFiles(work);
    const best = pickBestPrice(mergePriceCandidates(...files.map(f => f.priceCandidates)));

    if (best) {
      recovered += 1;
      console.log(`  + ${work.projectId}: ${best.amount.toLocaleString('en-US')} THB  (${best.labelText}, ${best.source ?? 'document'})`);
      if (!DRY_RUN) {
        await Work.updateOne({ _id: work._id }, { $set: { budget: best.amount }, $unset: { budgetMissingReason: 1 } });
      }
      continue;
    }

    const reason = explainMissingBudget(files);
    if (work.budgetMissingReason !== reason) {
      reasonsSet += 1;
      if (!DRY_RUN) await Work.updateOne({ _id: work._id }, { $set: { budgetMissingReason: reason } });
    }
  }

  console.log(
    `\nDone${DRY_RUN ? ' (dry run -- nothing written)' : ''}: ${recovered} price(s) recovered, ` +
      `${reasonsSet} work(s) tagged with the reason no price was found, ` +
      `${works.length - recovered - reasonsSet} unchanged.`
  );
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:budgets failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
