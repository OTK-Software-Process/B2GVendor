import { Types } from 'mongoose';
import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Work, IWork, ITorFile, BudgetMissingReason, STATUS_BY_ANNOUNCE_TYPE } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { IngestionRun, IIngestionRun } from '../models/ingestionRun.model';
import { fetchEgpRssFeed, downloadTorFile, fetchHtmlDocument, EgpRssItem } from '../integrations/egpRss.client';
import { datastoreSearch } from '../integrations/dataGoTh.client';
import { resolveDataGoThResourceId, hasDataGoThConfig } from './dataGoThResource.service';
import { analyzeTorDocument, TagCandidate, DocumentAnalysisInput, DocumentAnalysisResult } from '../integrations/ai';
import { findOrCreateAiTag } from './tag.service';
import { env } from '../config/env';
import { saveTorFile } from './fileStorage.service';
import { extractPdfContent } from './pdfText.service';
import { extractHtmlContent } from './htmlText.service';
import { extractPdfsFromZip, pickPrimaryPdf } from './zipExtraction.service';
import { PriceCandidate, mergePriceCandidates } from '../utils/priceExtraction';
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

// HTML announcement pages (winner announcements, in practice) are read to get
// their price -- see downloadAndExtractTorFiles. One that keeps failing (removed,
// or e-GP's "file not found") is retried by at most this many sweeps...
const MAX_HTML_FETCH_ATTEMPTS = 3;
// ...and never sooner than this after the previous attempt: not by the sweep at
// the end of the very poll that just failed to read it, and not by every "Poll
// Now" click -- the site is asked again only after a real gap.
const HTML_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
// ...and one sweep reads at most this many pages, so the first poll after this
// was introduced (which catches up EVERY existing work that has an unread page)
// can't run for ages while holding the "Poll Now" lock. The rest follow on the
// next polls.
const MAX_HTML_FETCHES_PER_SWEEP = 40;

export interface SweepOptions {
  // Most HTML pages this sweep may read (default MAX_HTML_FETCHES_PER_SWEEP). The
  // backfill command lifts it: it is a deliberate one-off run, not a poll that
  // holds the "Poll Now" lock.
  htmlLimit?: number;
  // Also try pages that were given up on (MAX_HTML_FETCH_ATTEMPTS misses) or
  // that were tried within the last HTML_RETRY_AFTER_MS.
  retryFailedHtml?: boolean;
  // Leave failed pdf/zip downloads alone.
  htmlOnly?: boolean;
  // Called after each work the sweep changed and saved -- progress for a long run.
  onWorkSaved?: (work: IWork) => void;
}

// A work with no price and an HTML page nobody has read yet (skipped altogether
// while reading pages is switched off). $not/$gt also matches a missing or zero budget.
function unreadHtmlPriceFilter(retryFailed: boolean) {
  const retryCutoff = new Date(Date.now() - HTML_RETRY_AFTER_MS);
  return {
    budget: { $not: { $gt: 0 } },
    torFiles: {
      $elemMatch: {
        linkType: 'html',
        downloadedAt: { $exists: false },
        supersededAt: { $exists: false },
        ...(retryFailed
          ? {}
          : {
              fetchAttempts: { $not: { $gte: MAX_HTML_FETCH_ATTEMPTS } },
              $or: [{ fetchAttemptedAt: { $exists: false } }, { fetchAttemptedAt: { $lt: retryCutoff } }]
            })
      }
    }
  };
}

// One request per (60000 / requestsPerMinute) ms -- the site's own configured rate.
function requestGapMs(site: Pick<IGovSite, 'requestsPerMinute'>): number {
  return Math.ceil(60000 / site.requestsPerMinute);
}

// Announce types whose document IS a winner announcement (W0, and W2 = its
// modification); W1 cancels one, so its figure is not accepted as a price.
function isWinnerAnnouncement(announceType: AnnounceType): boolean {
  return announceType === 'W0' || announceType === 'W2';
}

// Safety net for a download (or text extraction) that failed transiently on
// its first attempt -- the inline download in upsertWorkFromRssItem doesn't
// retry itself; this sweep does, once per poll. If a work still has no
// description or no price (meaning its original analysis had no document text
// to work with), a successful recovery here also re-runs the analysis so it
// isn't stuck title-only forever.
//
// It also catches up HTML announcement pages that were never read (works
// ingested before pages were read at all): only while the work still has no
// price, at most MAX_HTML_FETCHES_PER_SWEEP a poll, paced by the site's rate.
async function retryMissingTorDownloads(site: IGovSite, candidateTags: TagCandidate[], options: SweepOptions = {}): Promise<number> {
  const htmlRetryCutoff = new Date(Date.now() - HTML_RETRY_AFTER_MS);
  const retryFailedHtml = options.retryFailedHtml === true;
  const htmlLimit = options.htmlLimit ?? MAX_HTML_FETCHES_PER_SWEEP;

  const awaiting: Record<string, unknown>[] = [
    // A pdf/zip whose download failed.
    ...(options.htmlOnly
      ? []
      : [{ torFiles: { $elemMatch: { linkType: { $in: ['pdf', 'zip'] }, storageKey: { $exists: false }, supersededAt: { $exists: false } } } }]),
    // An HTML page nobody has read yet -- worth a request only while the work has no price.
    ...(env.EGP_HTML_TOR_ENABLED ? [unreadHtmlPriceFilter(retryFailedHtml)] : [])
  ];
  if (awaiting.length === 0) return 0;

  const works = await Work.find({
    siteId: site._id,
    // A work already marked 'not-related' never has its TOR reprocessed --
    // that's the whole point of persisting ingestionRelevance (customer
    // requirement). Its torFiles entries deliberately have no storageKey
    // (see the update branch of upsertWorkFromRssItem below), so without
    // this exclusion they'd otherwise look exactly like a transient
    // download failure and get retried here forever.
    ingestionRelevance: { $ne: 'not-related' },
    $or: awaiting
  });

  const gapMs = requestGapMs(site);
  let htmlFetches = 0;
  let recovered = 0;

  for (const work of works) {
    let mutated = false; // the work needs saving
    let recoveredHere = false; // a document really came back

    // Group by sourceUrl, not by individual file -- a 'zip' link's
    // placeholder is a single entry (the file count inside isn't known
    // until it's actually downloaded), so recovery must re-derive the whole
    // group rather than patch one entry's fields in place.
    const missingBySourceUrl = new Map<string, { announceType: AnnounceType; linkType: EgpRssItem['linkType'] }>();
    for (const file of work.torFiles) {
      if (file.supersededAt) continue;
      if (file.linkType === 'pdf' || file.linkType === 'zip') {
        if (options.htmlOnly || file.storageKey) continue;
      } else if (file.linkType === 'html') {
        if (!env.EGP_HTML_TOR_ENABLED) continue;
        // Already read, or not worth a request (has a price).
        if (file.downloadedAt || work.budget) continue;
        // Given up on, or attempted so recently it would only be asking the
        // site again -- unless this run was told to try those too.
        if (!retryFailedHtml) {
          if ((file.fetchAttempts ?? 0) >= MAX_HTML_FETCH_ATTEMPTS) continue;
          if (file.fetchAttemptedAt && file.fetchAttemptedAt > htmlRetryCutoff) continue;
        }
      } else {
        continue;
      }
      missingBySourceUrl.set(file.sourceUrl, { announceType: file.announceType, linkType: file.linkType });
    }

    for (const [sourceUrl, { announceType, linkType }] of missingBySourceUrl) {
      const isHtml = linkType === 'html';
      if (isHtml && htmlFetches >= htmlLimit) continue;

      try {
        const item: EgpRssItem = { title: work.title, link: sourceUrl, linkType, description: '', pubDate: null, projectId: work.projectId };
        if (isHtml) htmlFetches += 1;
        const extracted = await downloadAndExtractTorFiles(item, gapMs);

        if (!extracted || extracted.length === 0) {
          if (isHtml) {
            // Remember the miss, so a page that keeps failing is given up on
            // instead of being retried -- and using up this sweep's quota --
            // forever.
            for (const f of work.torFiles) {
              if (f.sourceUrl === sourceUrl && !f.supersededAt && !f.downloadedAt) {
                f.fetchAttempts = (f.fetchAttempts ?? 0) + 1;
                f.fetchAttemptedAt = new Date();
              }
            }
            mutated = true;
          }
          continue;
        }

        for (let i = work.torFiles.length - 1; i >= 0; i--) {
          const f = work.torFiles[i];
          if (f.sourceUrl === sourceUrl && !f.storageKey && !f.supersededAt) work.torFiles.splice(i, 1);
        }
        work.torFiles.push(...buildTorFiles(announceType, item, extracted));
        mutated = true;
        recoveredHere = true;

        // Also re-analyze when only the price is missing: the document that
        // just came back may be the one that states it.
        if (!work.description || !work.budget) {
          // An HTML page goes to the AI only if the work has never been
          // described; otherwise it is read for its price alone, so this can't
          // re-word the description or re-tag a work.
          const analysis = await analyzeTorDocument(analysisInputFor(work.title, extracted, announceType), candidateTags, {
            priceOnly: isHtml && !!work.description
          });
          if (analysis.description && !work.description) work.description = analysis.description;
          applyDocumentBudget(work, analysis, extracted);
          for (const tagIdStr of analysis.tagIds) {
            const tagId = new Types.ObjectId(tagIdStr);
            if (!work.tags.some(t => t.equals(tagId))) work.tags.push(tagId);
          }
          const newTagId = await resolveNewTag(analysis, candidateTags);
          if (newTagId && !work.tags.some(t => t.equals(newTagId))) work.tags.push(newTagId);
        }
      } catch (err) {
        logger.warn('ingestion', `Retry download still failing for work ${work.projectId}`, err);
      }
    }

    if (mutated) {
      // One work failing to save (e.g. a poll changed it meanwhile) must not
      // abandon the rest of the sweep; the next run picks it up again.
      try {
        await work.save();
        if (recoveredHere) recovered += 1;
        options.onWorkSaved?.(work);
      } catch (err) {
        logger.warn('ingestion', `Could not save work ${work.projectId} after its retry sweep`, err);
      }
    }
  }

  return recovered;
}

// --- one-off backfill (npm run backfill:html-prices) ---------------------------
// Works ingested BEFORE HTML pages were read have no price and an unread page.
// Polls catch them up MAX_HTML_FETCHES_PER_SWEEP at a time; this reads them all
// in one go, at the site's request rate, through the very same code path.

// How many works of the site still have an unread HTML page and no price:
// `awaiting` can be read right now, `givenUp` only with retryFailedHtml.
export async function countHtmlPriceBackfill(site: IGovSite): Promise<{ awaiting: number; givenUp: number }> {
  const scope = { siteId: site._id, ingestionRelevance: { $ne: 'not-related' } };
  const [awaiting, all] = await Promise.all([
    Work.countDocuments({ ...scope, ...unreadHtmlPriceFilter(false) }),
    Work.countDocuments({ ...scope, ...unreadHtmlPriceFilter(true) })
  ]);
  return { awaiting, givenUp: all - awaiting };
}

export async function backfillHtmlPrices(site: IGovSite, options: Pick<SweepOptions, 'htmlLimit' | 'retryFailedHtml' | 'onWorkSaved'> = {}): Promise<number> {
  return retryMissingTorDownloads(site, await getCandidateTags(), { htmlLimit: Infinity, ...options, htmlOnly: true });
}

export interface ExtractedTorFile {
  // Set for a stored PDF. An HTML page is read but not stored, so it has neither.
  storageKey?: string;
  filename?: string;
  role?: 'primary' | 'attachment';
  // What the AI reads -- only ever set for the primary PDF (see below).
  pdfText: string | null;
  // Whether ANY text could be extracted from this file, primary or not (false
  // = scanned / image-only PDF). Distinct from pdfText, which is deliberately
  // null for attachments even when they're perfectly readable.
  hasText: boolean;
  // "บาท" amounts found in this file's FULL text -- collected from every PDF,
  // because the ราคากลาง table is often a separate attachment.
  priceCandidates: PriceCandidate[];
}

// Reading a huge attachment (site drawings, scanned annexes) just to look for
// a price isn't worth the memory/CPU -- the price table is a small document.
const MAX_ATTACHMENT_SCAN_BYTES = 25 * 1024 * 1024;

// A 'pdf'/'zip' link is downloaded, stored (deduplicated by content hash), and
// its text extracted so the AI analysis call right after can read the real
// document, not just the title.
//
// A 'zip' (seen on B0/draft-TOR items, delivered via egp-upload-service)
// can bundle several PDFs -- all are stored so a vendor can download any of
// them, and all are scanned for a price, but only the primary one
// (pickPrimaryPdf) has its text sent to the AI; the rest are attachments.
//
// An 'html' link (every winner announcement, on the live feed) is fetched and
// read too, but NOT stored -- the entry stays a reference to the source page.
// This is a deliberate override of the old "never fetch an HTML page" rule --
// see integrations/egpRss.client.ts. An 'other' link is still never fetched.
//
// null = nothing could be read (failed download, blocked/unreachable page, or
// e-GP's "file not found" page) -- a later poll's retry sweep tries again.
async function downloadAndExtractTorFiles(item: EgpRssItem, htmlGapMs: number): Promise<ExtractedTorFile[] | null> {
  if (item.linkType === 'html') {
    if (!env.EGP_HTML_TOR_ENABLED) return null;

    try {
      const html = await fetchHtmlDocument(item.link, { minGapMs: htmlGapMs });
      const content = extractHtmlContent(html, 'announcement page');
      if (content.text === null) {
        logger.warn('ingestion', `HTML announcement ${item.link} had no readable document (e-GP "file not found" page, or empty)`);
        return null;
      }
      return [{ pdfText: content.text, hasText: true, priceCandidates: content.priceCandidates }];
    } catch (err) {
      logger.warn('ingestion', `Failed to read HTML announcement ${item.link}`, err);
      return null;
    }
  }

  if (item.linkType === 'pdf') {
    try {
      const downloaded = await downloadTorFile(item.link, 'pdf');
      const saved = await saveTorFile(downloaded.buffer, downloaded.filename);
      const content = await extractPdfContent(downloaded.buffer, saved.filename);
      return [
        {
          storageKey: saved.storageKey,
          filename: saved.filename,
          pdfText: content.text,
          hasText: content.text !== null,
          priceCandidates: content.priceCandidates
        }
      ];
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
        const skipScan = !isPrimary && entry.buffer.length > MAX_ATTACHMENT_SCAN_BYTES;
        const content = skipScan
          ? { text: null, priceCandidates: [] as PriceCandidate[] }
          : await extractPdfContent(entry.buffer, saved.filename);
        results.push({
          storageKey: saved.storageKey,
          filename: saved.filename,
          role: isPrimary ? 'primary' : 'attachment',
          pdfText: isPrimary ? content.text : null,
          // An attachment we chose not to scan is unknown, not unreadable --
          // count it as readable so it can't wrongly blame a scanned file.
          hasText: skipScan || content.text !== null,
          priceCandidates: content.priceCandidates
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

// What the AI call gets for a set of downloaded files: the primary PDF's
// (capped) text to read, plus price candidates scanned from the FULL text of
// EVERY file -- so a price sitting past the text cap, or in an attachment, is
// still handed over (see utils/priceExtraction.ts).
function analysisInputFor(title: string, extracted: ExtractedTorFile[] | null, announceType?: AnnounceType): DocumentAnalysisInput {
  const primary = extracted?.find(f => f.role !== 'attachment') ?? null;
  return {
    title,
    documentText: primary?.pdfText,
    priceHints: mergePriceCandidates(...(extracted ?? []).map(f => f.priceCandidates)),
    acceptAwardedPrice: announceType !== undefined && isWinnerAnnouncement(announceType)
  };
}

// Why no price could be found, from what we were actually able to read --
// shown on the website instead of a bare "0" (see Work.budgetMissingReason).
export function explainMissingBudget(extracted: ExtractedTorFile[] | null): BudgetMissingReason {
  if (!extracted || extracted.length === 0) return 'no-document';
  // Every file was readable and none states a price -> the document really
  // doesn't say. If any file had no text layer (scanned) the price might be in
  // it, so don't claim the document lacks one.
  return extracted.every(f => f.hasText) ? 'not-stated' : 'unreadable';
}

function logScanRecovery(analysis: DocumentAnalysisResult, projectId: string): void {
  if (analysis.budget && analysis.budgetSource === 'text-match') {
    const how = analysis.budgetBasis === 'awarded' ? 'read as the winning bid' : 'recovered by the "บาท" scan (the AI returned none)';
    logger.info('ingestion', `Price ${analysis.budget} THB for project ${projectId} ${how}`);
  }
}

// Applies a document analysis's price to a work without ever overwriting one
// that's already there (e.g. the real contract price from data.go.th beats an
// estimate read from a later document). When there's still no price, records
// WHY. Returns whether the work changed.
function applyDocumentBudget(work: IWork, analysis: DocumentAnalysisResult, extracted: ExtractedTorFile[] | null): boolean {
  if (work.budget) return false;

  if (analysis.budget) {
    work.budget = analysis.budget;
    work.budgetBasis = analysis.budgetBasis ?? undefined;
    work.budgetMissingReason = undefined;
    logScanRecovery(analysis, work.projectId);
    return true;
  }

  const reason = explainMissingBudget(extracted);
  if (work.budgetMissingReason === reason) return false;
  work.budgetMissingReason = reason;
  return true;
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
    // Nothing read yet (transient failure, or a link type that's never
    // fetched at all) -- still record the link itself so a later poll's retry
    // sweep (pdf/zip/html) or a human ('other') can act on it. An HTML page
    // that was JUST attempted is stamped, so the sweep at the end of this same
    // poll leaves it alone (see HTML_RETRY_AFTER_MS).
    const attemptedHtml = item.linkType === 'html' && env.EGP_HTML_TOR_ENABLED;
    return [
      {
        announceType,
        linkType: item.linkType,
        sourceUrl: item.link,
        ...(attemptedHtml ? { fetchAttempts: 1, fetchAttemptedAt: new Date() } : {})
      }
    ];
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
    const extracted = await downloadAndExtractTorFiles(item, requestGapMs(site));
    const analysis = await analyzeTorDocument(analysisInputFor(item.title, extracted, announceType), candidateTags);

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

    logScanRecovery(analysis, item.projectId);

    const createdWork = await Work.create({
      siteId: site._id,
      projectId: item.projectId,
      title: item.title,
      description: analysis.description ?? undefined,
      // Pre-award estimate read from the doc's ราคากลาง/วงเงิน figure (by the
      // AI, or by the "บาท" scan when the AI returns none) -- gives the
      // website a price to show immediately instead of waiting for
      // data.go.th enrichment, which only has a figure AFTER award
      // (enrichWorkFromContractRecord below always wins over this once it
      // has a real value). With no price, say WHY so the site can show a
      // meaningful message rather than "0".
      budget: analysis.budget ?? undefined,
      budgetBasis: analysis.budget ? analysis.budgetBasis ?? undefined : undefined,
      budgetMissingReason: analysis.budget ? undefined : explainMissingBudget(extracted),
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
      newExtracted = await downloadAndExtractTorFiles(item, requestGapMs(site));
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
    const analysis = await analyzeTorDocument(analysisInputFor(item.title, newExtracted, announceType), candidateTags, {
      // A winner-announcement page is read for its price alone once the work
      // has been described: a lifecycle event must not re-word the description,
      // re-tag the work or re-notify its followers -- nor cost an AI call.
      priceOnly: item.linkType === 'html' && !!existing.description
    });

    if (analysis.description) {
      existing.description = analysis.description;
      changed = true;
    }
    // Never overwrites a budget that's already set -- if data.go.th already
    // enriched this work with the real post-award contract price, an
    // estimate read from a later document must not clobber it.
    if (applyDocumentBudget(existing, analysis, newExtracted)) changed = true;
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

  // Only a real (positive) figure replaces what we have -- an empty CSV cell
  // arrives as null/'' and Number(null) === Number('') === 0, which used to
  // wipe out a good price read from the TOR.
  const contractBudget = toPositiveNumber(record.proj_mny) ?? toPositiveNumber(record.contrct_price);
  if (contractBudget !== undefined) {
    work.budget = contractBudget;
    work.budgetBasis = undefined; // a real project budget, not a winning bid
    work.budgetMissingReason = undefined;
  }
  work.contractNumber = toStringOrUndefined(record.contrct_num) ?? work.contractNumber;
  work.contractDate = toDate(record.contrct_date) ?? work.contractDate;
  work.winnerName = toStringOrUndefined(record.corp_name) ?? work.winnerName;
  work.winnerTin = toStringOrUndefined(record.win_tin) ?? work.winnerTin;
  work.enrichedAt = new Date();

  await work.save();
  return true;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
