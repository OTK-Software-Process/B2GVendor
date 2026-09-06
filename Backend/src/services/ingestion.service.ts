import { Types } from 'mongoose';
import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Work, IWork, STATUS_BY_ANNOUNCE_TYPE } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { IngestionRun, IIngestionRun } from '../models/ingestionRun.model';
import { fetchEgpRssFeed, downloadTorPdf, EgpRssItem } from '../integrations/egpRss.client';
import { datastoreSearch } from '../integrations/dataGoTh.client';
import { classifyTags, TagCandidate } from '../integrations/vertexAi.client';
import { saveTorFile } from './fileStorage.service';
import { logger } from '../utils/logger';
import { withRetry, sleep } from '../utils/retry';

export type TriggeredBy = 'scheduler' | Types.ObjectId;

/**
 * The core ingestion pipeline (ProjectDescription.md N1). Two independent
 * entry points -- runRssPoll (primary/live) and runDataGoThEnrichment
 * (secondary/batch) -- called by the ingestion-worker process, never by the
 * API container directly (see pollJob.service.ts for how "Poll Now"
 * reaches this without the two containers calling each other).
 */

async function getCandidateTags(): Promise<TagCandidate[]> {
  const tags = await Tag.find({ facet: { $in: ['category', 'keyword'] }, retired: false });
  return tags.map(t => ({ id: t._id.toString(), name: t.name, facet: t.facet as 'category' | 'keyword' }));
}

async function isAlreadyRunning(siteId: Types.ObjectId, source: 'rss' | 'data_go_th'): Promise<boolean> {
  const running = await IngestionRun.findOne({ siteId, source, status: 'running' });
  return !!running;
}

export async function runRssPoll(site: IGovSite, triggeredBy: TriggeredBy): Promise<IIngestionRun> {
  // FR-N1.10: a manual and scheduled poll for the same site+source must not
  // run destructively at the same time.
  if (await isAlreadyRunning(site._id, 'rss')) {
    throw new Error(`An RSS poll for ${site.shortCode} is already running`);
  }

  const run = await IngestionRun.create({
    siteId: site._id,
    source: 'rss',
    triggeredBy,
    status: 'running'
  });

  let fetchedCount = 0;
  let newCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const errorLog: string[] = [];
  const candidateTags = await getCandidateTags();

  // A site-level tag always exists (created alongside the GovSite) -- every
  // work carries it, per N3's "government site" facet.
  const siteTag = await Tag.findOne({ facet: 'site', siteId: site._id });

  // NFR-N1.1: throttle requests per site -- a plain, cheap inter-request
  // delay derived from the site's configured RPM, not a full token bucket.
  const minDelayMs = Math.ceil(60000 / site.requestsPerMinute);
  let isFirstRequest = true;

  for (const announceType of site.announceTypes as AnnounceType[]) {
    if (!isFirstRequest) await sleep(minDelayMs);
    isFirstRequest = false;

    let items: EgpRssItem[] = [];
    try {
      items = await withRetry(() => fetchEgpRssFeed(site.deptId, announceType));
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      errorLog.push(`[${announceType}] fetch failed: ${message}`);
      logger.warn('ingestion', `RSS fetch failed for ${site.shortCode}/${announceType}`, err);
      continue; // one announce type failing must not block the others
    }

    fetchedCount += items.length;

    for (const item of items) {
      try {
        const result = await upsertWorkFromRssItem(site, announceType, item, candidateTags, siteTag?._id);
        if (result === 'new') newCount += 1;
        if (result === 'updated') updatedCount += 1;
      } catch (err) {
        failedCount += 1;
        const message = err instanceof Error ? err.message : String(err);
        errorLog.push(`[${announceType}] item "${item.projectId ?? item.title.slice(0, 40)}" failed: ${message}`);
        logger.warn('ingestion', `Failed to upsert work for ${site.shortCode}`, err);
      }
    }
  }

  run.fetchedCount = fetchedCount;
  run.newCount = newCount;
  run.updatedCount = updatedCount;
  run.failedCount = failedCount;
  run.errorLog = errorLog;
  run.status = failedCount === 0 ? 'success' : newCount + updatedCount > 0 ? 'partial' : 'failed';
  run.finishedAt = new Date();
  await run.save();

  return run;
}

async function upsertWorkFromRssItem(
  site: IGovSite,
  announceType: AnnounceType,
  item: EgpRssItem,
  candidateTags: TagCandidate[],
  siteTagId: Types.ObjectId | undefined
): Promise<'new' | 'updated' | 'skipped'> {
  if (!item.projectId) {
    // No stable key to upsert on -- can't safely store this item.
    return 'skipped';
  }

  const status = STATUS_BY_ANNOUNCE_TYPE[announceType];
  const existing = await Work.findOne({ siteId: site._id, projectId: item.projectId });

  if (!existing) {
    const tagIds: Types.ObjectId[] = siteTagId ? [siteTagId] : [];
    const aiTagIds = await classifyTags(item.title, candidateTags);
    tagIds.push(...aiTagIds.map(id => new Types.ObjectId(id)));

    const work = await Work.create({
      siteId: site._id,
      projectId: item.projectId,
      title: item.title,
      status,
      announceType,
      pubDate: item.pubDate ?? undefined,
      torFiles: [{ announceType, linkType: item.linkType, sourceUrl: item.link }],
      statusHistory: [{ status, announceType, changedAt: item.pubDate ?? new Date() }],
      tags: tagIds
    });

    await maybeDownloadTorFile(work);
    return 'new';
  }

  let changed = false;

  // Log every distinct lifecycle event, not only ones that change the
  // derived status -- e.g. D1 (cancellation) and W1 (winner cancellation)
  // both map to CANCELLED, but a W1 arriving after a D1 is still a real,
  // separate event a vendor should see in the work's history.
  if (existing.status !== status || existing.announceType !== announceType) {
    existing.statusHistory.push({ status, announceType, changedAt: item.pubDate ?? new Date() });
    existing.status = status;
    existing.announceType = announceType;
    changed = true;
  }

  // Track documents per announce-type, not as one flat "has this URL"
  // check -- a Draft-TOR PDF and an Invitation PDF are different documents
  // and must both stay visible. Within the SAME announce-type, a new link
  // means the government re-issued/corrected that document: keep the old
  // one (marked superseded) and add the new one as current.
  const currentForType = existing.torFiles.find(f => f.announceType === announceType && !f.supersededAt);
  if (!currentForType) {
    existing.torFiles.push({ announceType, linkType: item.linkType, sourceUrl: item.link });
    changed = true;
  } else if (currentForType.sourceUrl !== item.link) {
    currentForType.supersededAt = new Date();
    existing.torFiles.push({ announceType, linkType: item.linkType, sourceUrl: item.link });
    changed = true;
  }

  if (changed) {
    await existing.save();
    await maybeDownloadTorFile(existing);
    return 'updated';
  }

  return 'skipped';
}

async function maybeDownloadTorFile(work: IWork): Promise<void> {
  let mutated = false;

  for (const file of work.torFiles) {
    if (file.linkType !== 'pdf' || file.storageKey) continue; // only fetch direct PDFs, once
    try {
      const downloaded = await downloadTorPdf(file.sourceUrl);
      const saved = await saveTorFile(downloaded.buffer, downloaded.filename);
      file.storageKey = saved.storageKey;
      file.filename = saved.filename;
      file.downloadedAt = new Date();
      mutated = true;
    } catch (err) {
      logger.warn('ingestion', `Failed to download TOR PDF for work ${work.projectId}`, err);
      // Leave storageKey unset -- a future poll (or a manual retry) can try again.
    }
  }

  if (mutated) await work.save();
}

export async function runDataGoThEnrichment(site: IGovSite, triggeredBy: TriggeredBy): Promise<IIngestionRun> {
  if (await isAlreadyRunning(site._id, 'data_go_th')) {
    throw new Error(`A data.go.th enrichment run for ${site.shortCode} is already running`);
  }

  const run = await IngestionRun.create({
    siteId: site._id,
    source: 'data_go_th',
    triggeredBy,
    status: 'running'
  });

  if (!site.dataGoThResourceId) {
    run.status = 'success';
    run.errorLog = ['No data.go.th resource configured for this site -- nothing to enrich.'];
    run.finishedAt = new Date();
    await run.save();
    return run;
  }

  let fetchedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const errorLog: string[] = [];

  try {
    const { records } = await withRetry(() => datastoreSearch(site.dataGoThResourceId as string, { limit: 200 }));
    fetchedCount = records.length;

    for (const record of records) {
      try {
        const updated = await enrichWorkFromContractRecord(site, record);
        if (updated) updatedCount += 1;
      } catch (err) {
        failedCount += 1;
        errorLog.push(err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    failedCount += 1;
    const message = err instanceof Error ? err.message : String(err);
    errorLog.push(`datastore_search failed: ${message}`);
    logger.warn('ingestion', `data.go.th enrichment fetch failed for ${site.shortCode}`, err);
  }

  run.fetchedCount = fetchedCount;
  run.updatedCount = updatedCount;
  run.failedCount = failedCount;
  run.errorLog = errorLog;
  run.status = failedCount === 0 ? 'success' : updatedCount > 0 ? 'partial' : 'failed';
  run.finishedAt = new Date();
  await run.save();

  return run;
}

async function enrichWorkFromContractRecord(site: IGovSite, record: Record<string, unknown>): Promise<boolean> {
  // Confirmed live field names on the CGD contract table -- see
  // testAPI/explore-api-data-go-th.ts's `resource` command output.
  const projectId = record.proj_no != null ? String(record.proj_no) : null;
  if (!projectId) return false;

  const work = await Work.findOne({ siteId: site._id, projectId });
  if (!work) return false; // data.go.th enrichment never creates a new work

  work.budget = toNumber(record.proj_mny) ?? toNumber(record.contrct_price) ?? work.budget;
  work.contractNumber = toStringOrUndefined(record.contrct_num) ?? work.contractNumber;
  work.contractDate = toDate(record.contrct_date) ?? work.contractDate;
  work.winnerName = toStringOrUndefined(record.corp_name) ?? work.winnerName;
  work.winnerTin = toStringOrUndefined(record.win_tin) ?? work.winnerTin;
  work.enrichedAt = new Date();

  await work.save();
  return true;
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function pollAllEnabledSites(triggeredBy: TriggeredBy): Promise<IIngestionRun[]> {
  const sites = await GovSite.find({ enabled: true });
  const runs: IIngestionRun[] = [];

  for (const site of sites) {
    try {
      runs.push(await runRssPoll(site, triggeredBy));
    } catch (err) {
      logger.warn('ingestion', `Skipped RSS poll for ${site.shortCode}`, err);
    }
    if (site.dataGoThResourceId) {
      try {
        runs.push(await runDataGoThEnrichment(site, triggeredBy));
      } catch (err) {
        logger.warn('ingestion', `Skipped data.go.th enrichment for ${site.shortCode}`, err);
      }
    }
  }

  return runs;
}
