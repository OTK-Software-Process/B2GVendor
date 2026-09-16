import { Types } from 'mongoose';
import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Work, IWork, ITorFile, STATUS_BY_ANNOUNCE_TYPE } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { IngestionRun, IIngestionRun } from '../models/ingestionRun.model';
import { fetchEgpRssFeed, downloadTorFile, EgpRssItem } from '../integrations/egpRss.client';
import { datastoreSearch } from '../integrations/dataGoTh.client';
import { resolveDataGoThResourceId, hasDataGoThConfig } from './dataGoThResource.service';
import { analyzeTorDocument, TagCandidate, DocumentAnalysisResult } from '../integrations/ai';
import { findOrCreateAiTag } from './tag.service';
import { env } from '../config/env';
import { saveTorFile } from './fileStorage.service';
import { extractPdfText } from './pdfText.service';
import { extractPdfsFromZip, pickPrimaryPdf } from './zipExtraction.service';
import { logger } from '../utils/logger';
import { withRetry, sleep } from '../utils/retry';
import { notifyNewWorkMatches } from './notification.service';

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

// Customer requirement: restrict the public site to one topic (e.g.
// "software"), uniformly across every GovSite -- see
// Tag.includeInIngestionFilter. Data-driven (which tag(s) count is admin-
// configured, not hardcoded here). Returns null when the feature is off, so
// callers leave ingestionRelevance unset entirely rather than computing an
// always-"not-related" result. NOTE: unlike an early version of this
// feature, this no longer discards a work outright -- every work is still
// created/tracked either way; see computeRelevance and its callers.
async function getInScopeTagIds(): Promise<Set<string> | null> {
  if (!env.INGESTION_TOPIC_FILTER_ENABLED) return null;

  const tags = await Tag.find({ includeInIngestionFilter: true, retired: false }, '_id');
  if (tags.length === 0) {
    logger.warn(
      'ingestion',
      'INGESTION_TOPIC_FILTER_ENABLED is true but no tag is flagged includeInIngestionFilter -- ' +
        'every new work will be filtered out until an admin flags at least one tag via ' +
        'PATCH /admin/tags/:id/ingestion-filter'
    );
  }
  if (!env.AI_TAGGING_ENABLED) {
    logger.warn(
      'ingestion',
      'INGESTION_TOPIC_FILTER_ENABLED is true but AI_TAGGING_ENABLED is false -- no work can ever ' +
        'be classified as in-scope without AI, so every new work will be filtered out'
    );
  }
  return new Set(tags.map(t => t._id.toString()));
}

async function isAlreadyRunning(siteId: Types.ObjectId, source: 'rss' | 'data_go_th'): Promise<boolean> {
  const running = await IngestionRun.findOne({ siteId, source, status: 'running' });
  return !!running;
}

// Persists an AI-proposed new tag (see integrations/ai's newTag field) and
// folds it into `candidateTags` IN PLACE -- candidateTags is the same array
// instance threaded through the rest of the current poll run (including
// retryMissingTorDownloads below), so a second document about the same
// novel topic later in this run sees it as a real candidate instead of
// proposing a near-duplicate. findOrCreateAiTag itself is the actual
// dedupe authority (a fresh DB lookup, not just this in-memory list) --
// this is purely an optimization to reduce redundant proposals, not a
// correctness requirement.
async function resolveNewTag(analysis: DocumentAnalysisResult, candidateTags: TagCandidate[]): Promise<Types.ObjectId | null> {
  if (!analysis.newTag) return null;

  try {
    const tag = await findOrCreateAiTag(analysis.newTag.name, analysis.newTag.facet);
    const idStr = tag._id.toString();
    if (!candidateTags.some(c => c.id === idStr)) {
      candidateTags.push({ id: idStr, name: tag.name, facet: tag.facet as 'category' | 'keyword' });
    }
    return tag._id;
  } catch (err) {
    logger.warn('ingestion', `Failed to persist AI-proposed tag "${analysis.newTag.name}"`, err);
    return null;
  }
}

// Customer requirement: mark (not discard) a work's topic relevance --
// checked against analysis.tagIds (established candidates) only, never a
// brand-new AI-proposed tag: a newTag proposal isn't yet admin-reviewed, so
// it can never itself earn 'shown' on the same poll it was proposed in.
function computeRelevance(analysis: DocumentAnalysisResult, inScopeTagIds: Set<string> | null): 'shown' | 'not-related' | undefined {
  if (!inScopeTagIds) return undefined; // feature off -- leave the field unset entirely
  return analysis.tagIds.some(id => inScopeTagIds.has(id)) ? 'shown' : 'not-related';
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
  const inScopeTagIds = await getInScopeTagIds();

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
        const result = await upsertWorkFromRssItem(site, announceType, item, candidateTags, siteTag?._id, inScopeTagIds);
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

  try {
    const fixed = await retryMissingTorDownloads(site, candidateTags);
    if (fixed > 0) logger.info('ingestion', `Retried and recovered ${fixed} previously-failed TOR download(s) for ${site.shortCode}`);
  } catch (err) {
    logger.warn('ingestion', `TOR download retry sweep failed for ${site.shortCode}`, err);
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

// Safety net for a download (or text extraction) that failed transiently on
// its first attempt -- the inline download in upsertWorkFromRssItem doesn't
// retry itself; this sweep does, once per poll. If a work still has no
// description (meaning its original AI analysis had no PDF text to work
// with), a successful recovery here also re-runs the analysis so it isn't
// stuck title-only forever.
async function retryMissingTorDownloads(site: IGovSite, candidateTags: TagCandidate[]): Promise<number> {
  const works = await Work.find({
    siteId: site._id,
    // A work already marked 'not-related' never has its TOR reprocessed --
    // that's the whole point of persisting ingestionRelevance (customer
    // requirement). Its torFiles entries deliberately have no storageKey
    // (see the update branch of upsertWorkFromRssItem below), so without
    // this exclusion they'd otherwise look exactly like a transient
    // download failure and get retried here forever.
    ingestionRelevance: { $ne: 'not-related' },
    torFiles: { $elemMatch: { linkType: { $in: ['pdf', 'zip'] }, storageKey: { $exists: false }, supersededAt: { $exists: false } } }
  });

  let recovered = 0;
  for (const work of works) {
    let mutated = false;

    // Group by sourceUrl, not by individual file -- a 'zip' link's
    // placeholder is a single entry (the file count inside isn't known
    // until it's actually downloaded), so recovery must re-derive the whole
    // group rather than patch one entry's fields in place.
    const missingBySourceUrl = new Map<string, { announceType: AnnounceType; linkType: EgpRssItem['linkType'] }>();
    for (const file of work.torFiles) {
      if (file.storageKey || file.supersededAt) continue;
      if (file.linkType !== 'pdf' && file.linkType !== 'zip') continue;
      missingBySourceUrl.set(file.sourceUrl, { announceType: file.announceType, linkType: file.linkType });
    }

    for (const [sourceUrl, { announceType, linkType }] of missingBySourceUrl) {
      try {
        const item: EgpRssItem = { title: work.title, link: sourceUrl, linkType, description: '', pubDate: null, projectId: work.projectId };
        const extracted = await downloadAndExtractTorFiles(item);
        if (!extracted || extracted.length === 0) continue;

        for (let i = work.torFiles.length - 1; i >= 0; i--) {
          const f = work.torFiles[i];
          if (f.sourceUrl === sourceUrl && !f.storageKey && !f.supersededAt) work.torFiles.splice(i, 1);
        }
        work.torFiles.push(...buildTorFiles(announceType, item, extracted));
        mutated = true;

        if (!work.description) {
          const primary = extracted.find(f => f.role !== 'attachment');
          if (primary) {
            const analysis = await analyzeTorDocument({ title: work.title, documentText: primary.pdfText }, candidateTags);
            if (analysis.description) work.description = analysis.description;
            if (analysis.budget && !work.budget) work.budget = analysis.budget;
            for (const tagIdStr of analysis.tagIds) {
              const tagId = new Types.ObjectId(tagIdStr);
              if (!work.tags.some(t => t.equals(tagId))) work.tags.push(tagId);
            }
            const newTagId = await resolveNewTag(analysis, candidateTags);
            if (newTagId && !work.tags.some(t => t.equals(newTagId))) work.tags.push(newTagId);
          }
        }
      } catch (err) {
        logger.warn('ingestion', `Retry download still failing for work ${work.projectId}`, err);
      }
    }

    if (mutated) {
      await work.save();
      recovered += 1;
    }
  }

  return recovered;
}

interface ExtractedTorFile {
  storageKey: string;
  filename: string;
  role?: 'primary' | 'attachment';
  pdfText: string | null;
}

// Only ever called for linkType 'pdf' | 'zip' -- an 'html'/'other' link is
// never fetched (that would be scraping). Downloads, stores (deduplicated by
// content hash), and extracts text so the AI analysis call right after can
// read the real document, not just the title.
//
// A 'zip' (seen on B0/draft-TOR items, delivered via egp-upload-service)
// can bundle several PDFs -- all are stored so a vendor can download any of
// them, but only the primary one (pickPrimaryPdf) is text-extracted and
// sent to Vertex AI; the rest are attachments.
async function downloadAndExtractTorFiles(item: EgpRssItem): Promise<ExtractedTorFile[] | null> {
  if (item.linkType === 'pdf') {
    try {
      const downloaded = await downloadTorFile(item.link, 'pdf');
      const saved = await saveTorFile(downloaded.buffer, downloaded.filename);
      const pdfText = await extractPdfText(downloaded.buffer);
      return [{ storageKey: saved.storageKey, filename: saved.filename, pdfText }];
    } catch (err) {
      logger.warn('ingestion', `Failed to download/extract TOR PDF from ${item.link}`, err);
      return null; // a later poll's retryMissingTorDownloads() sweep will try again
    }
  }

  if (item.linkType === 'zip') {
    try {
      const downloaded = await downloadTorFile(item.link, 'zip');
      const pdfEntries = extractPdfsFromZip(downloaded.buffer);
      if (pdfEntries.length === 0) {
        logger.warn('ingestion', `Zip from ${item.link} contained no PDF entries`);
        return null;
      }

      const primaryEntry = pickPrimaryPdf(pdfEntries);
      const results: ExtractedTorFile[] = [];
      for (const entry of pdfEntries) {
        const saved = await saveTorFile(entry.buffer, entry.filename);
        const isPrimary = entry === primaryEntry;
        const pdfText = isPrimary ? await extractPdfText(entry.buffer) : null;
        results.push({
          storageKey: saved.storageKey,
          filename: saved.filename,
          role: isPrimary ? 'primary' : 'attachment',
          pdfText
        });
      }
      // Primary first, so callers that just want "the" analyzable document
      // can take results[0] without searching.
      results.sort((a, b) => (a.role === 'primary' ? -1 : b.role === 'primary' ? 1 : 0));
      return results;
    } catch (err) {
      logger.warn('ingestion', `Failed to download/extract TOR zip from ${item.link}`, err);
      return null; // a later poll's retryMissingTorDownloads() sweep will try again
    }
  }

  return null;
}

function buildTorFiles(announceType: AnnounceType, item: EgpRssItem, extracted: ExtractedTorFile[] | null): ITorFile[] {
  if (!item.link) {
    // Confirmed live (2026-09-16, projectId 69099235352): a real RSS item
    // can have a genuinely empty <link>. sourceUrl is required on ITorFile,
    // so pushing a placeholder with '' used to throw a Mongoose validation
    // error and fail the whole item -- there's nothing to record here, so
    // just don't add an entry. The Work itself still gets created/updated
    // for its status/lifecycle by the caller.
    return [];
  }

  if (!extracted || extracted.length === 0) {
    // Nothing downloaded yet (transient failure, or a link type that's
    // never fetched at all) -- still record the link itself so a later
    // poll's retry sweep (pdf/zip) or a human (html/other) can act on it.
    return [{ announceType, linkType: item.linkType, sourceUrl: item.link }];
  }

  return extracted.map(f => ({
    announceType,
    linkType: item.linkType,
    sourceUrl: item.link,
    storageKey: f.storageKey,
    filename: f.filename,
    downloadedAt: new Date(),
    role: f.role
  }));
}

async function upsertWorkFromRssItem(
  site: IGovSite,
  announceType: AnnounceType,
  item: EgpRssItem,
  candidateTags: TagCandidate[],
  siteTagId: Types.ObjectId | undefined,
  inScopeTagIds: Set<string> | null
): Promise<'new' | 'updated' | 'skipped'> {
  if (!item.projectId) {
    // No stable key to upsert on -- can't safely store this item.
    return 'skipped';
  }

  const status = STATUS_BY_ANNOUNCE_TYPE[announceType];
  const existing = await Work.findOne({ siteId: site._id, projectId: item.projectId });

  if (!existing) {
    // Download+extract BEFORE analysis, so a real PDF (when one exists --
    // possibly one of several bundled in a zip) informs both the tags and
    // the description -- FR-3.2.
    const extracted = await downloadAndExtractTorFiles(item);
    const primary = extracted?.find(f => f.role !== 'attachment') ?? null;
    const analysis = await analyzeTorDocument({ title: item.title, documentText: primary?.pdfText }, candidateTags);

    // Customer requirement (e.g. "software-only"): every work is still
    // created and fully populated below regardless of topic -- this only
    // decides whether it's PUBLICLY VISIBLE (see work.service.ts's query
    // filter) and is evaluated exactly once, right here. It deliberately
    // does NOT gate resolveNewTag/budget/description/tags below -- a
    // 'not-related' work still gets the richest record we can give it, in
    // case an admin ever reviews it.
    const ingestionRelevance = computeRelevance(analysis, inScopeTagIds);

    const tagIds: Types.ObjectId[] = siteTagId ? [siteTagId] : [];
    tagIds.push(...analysis.tagIds.map(id => new Types.ObjectId(id)));
    const newTagId = await resolveNewTag(analysis, candidateTags);
    if (newTagId) tagIds.push(newTagId);

    const createdWork = await Work.create({
      siteId: site._id,
      projectId: item.projectId,
      title: item.title,
      description: analysis.description ?? undefined,
      // AI-extracted pre-award estimate (from the doc's ราคากลาง/วงเงิน
      // figure) -- gives the website a price to show immediately instead of
      // waiting for data.go.th enrichment, which only has a figure AFTER
      // award (enrichWorkFromContractRecord below always wins over this
      // once it has a real value -- see its `?? work.budget` fallback).
      budget: analysis.budget ?? undefined,
      status,
      announceType,
      pubDate: item.pubDate ?? undefined,
      torFiles: buildTorFiles(announceType, item, extracted),
      statusHistory: [{ status, announceType, changedAt: item.pubDate ?? new Date() }],
      tags: tagIds,
      ingestionRelevance
    });
    // Never notify about a work the recipient can't actually view --
    // work.service.ts's public queries exclude 'not-related' works
    // entirely, so a notification linking to one would just 404.
    if (ingestionRelevance !== 'not-related') {
      await notifyNewWorkMatches(createdWork, tagIds);
    }

    return 'new';
  }

  let changed = false;
  let newExtracted: ExtractedTorFile[] | null = null;
  const newlyAddedTagIds: Types.ObjectId[] = [];

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
  // one(s) (marked superseded) and add the new one(s) as current. Grouped
  // by sourceUrl rather than a single entry, since a 'zip' link expands
  // into several files that all share it.
  const currentGroup = existing.torFiles.filter(f => f.announceType === announceType && !f.supersededAt);
  const currentUrl = currentGroup[0]?.sourceUrl;
  // A genuinely empty item.link (confirmed live, see buildTorFiles) is
  // never treated as "the government replaced the document" -- that would
  // supersede a real, already-tracked document based on what's more likely
  // a feed glitch than a deliberate removal. Leave existing torFiles alone.
  const hasNewDocument = !!item.link && (currentGroup.length === 0 || currentUrl !== item.link);

  if (hasNewDocument) {
    for (const f of currentGroup) f.supersededAt = new Date();

    // Customer requirement: a work already marked 'not-related' never gets
    // its TOR reprocessed again -- relevance is decided ONCE, at creation
    // (see computeRelevance in the branch above), and never re-evaluated on
    // later lifecycle updates. Still record the link itself so status
    // history/lifecycle stays complete and visible to an admin -- just
    // deliberately skip the download/extract/AI-analyze cost.
    if (existing.ingestionRelevance === 'not-related') {
      existing.torFiles.push({ announceType, linkType: item.linkType, sourceUrl: item.link });
    } else {
      newExtracted = await downloadAndExtractTorFiles(item);
      existing.torFiles.push(...buildTorFiles(announceType, item, newExtracted));
    }
    changed = true;
  }

  // Only re-run AI when a genuinely new document arrived -- re-analyzing an
  // unchanged item on every poll would waste calls and could flip tags for
  // no reason. Tags are MERGED (never replaced), and the description is
  // only overwritten when the new analysis actually produced one, so an
  // html-only re-poll never blanks out a description an earlier PDF gave us.
  if (newExtracted) {
    const primary = newExtracted.find(f => f.role !== 'attachment') ?? null;
    const analysis = await analyzeTorDocument({ title: item.title, documentText: primary?.pdfText }, candidateTags);

    if (analysis.description) {
      existing.description = analysis.description;
      changed = true;
    }
    // Never overwrite a budget that's already set -- if data.go.th already
    // enriched this work with the real post-award contract price, an
    // AI-read pre-award estimate from a later document must not clobber it.
    if (analysis.budget && !existing.budget) {
      existing.budget = analysis.budget;
      changed = true;
    }
    for (const tagIdStr of analysis.tagIds) {
      const tagId = new Types.ObjectId(tagIdStr);
      if (!existing.tags.some(t => t.equals(tagId))) {
        existing.tags.push(tagId);
        newlyAddedTagIds.push(tagId);
        changed = true;
      }
    }
    const newTagId = await resolveNewTag(analysis, candidateTags);
    if (newTagId && !existing.tags.some(t => t.equals(newTagId))) {
      existing.tags.push(newTagId);
      changed = true;
    }
  }

  if (changed) {
    await existing.save();
    if (newlyAddedTagIds.length > 0) {
      await notifyNewWorkMatches(existing, newlyAddedTagIds);
    }
    return 'updated';
  }

  return 'skipped';
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

  const resourceId = await resolveDataGoThResourceId(site);
  if (!resourceId) {
    run.status = 'success';
    run.errorLog = ['No data.go.th resource configured (or resolvable via package_show) for this site -- nothing to enrich.'];
    run.finishedAt = new Date();
    await run.save();
    return run;
  }
  run.resolvedResourceId = resourceId;

  let fetchedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const errorLog: string[] = [];

  try {
    const { records } = await withRetry(() => datastoreSearch(resourceId, { limit: 200 }));
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
    if (hasDataGoThConfig(site)) {
      try {
        runs.push(await runDataGoThEnrichment(site, triggeredBy));
      } catch (err) {
        logger.warn('ingestion', `Skipped data.go.th enrichment for ${site.shortCode}`, err);
      }
    }
  }

  return runs;
}
