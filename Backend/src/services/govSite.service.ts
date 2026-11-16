import { Types, UpdateQuery } from 'mongoose';
import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Tag } from '../models/tag.model';
import { Work } from '../models/work.model';
import { IngestionRun, IngestionRunStatus, IngestionSource } from '../models/ingestionRun.model';
import { AppError } from '../utils/AppError';
import { effectivePollIntervalMinutes } from '../config/polling';
import { getIngestionSettings, effectiveNextPollAt } from './ingestionSettings.service';
import { fetchEgpRssFeed } from '../integrations/egpRss.client';
import { logger } from '../utils/logger';

export interface CreateGovSiteInput {
  name: string;
  nameEn?: string;
  shortCode: string;
  deptId: string;
  announceTypes?: AnnounceType[];
  dataGoThOrgSlug?: string;
  dataGoThResourceId?: string;
  dataGoThPackageId?: string;
  dataGoThSearchQuery?: string;
  requestsPerMinute?: number;
  pollIntervalMinutes?: number;
}

// `null` removes a setting: pollIntervalMinutes goes back to following the global
// schedule, and a data.go.th setting is no longer used.
export type UpdateGovSiteInput = Partial<
  Omit<CreateGovSiteInput, 'pollIntervalMinutes' | 'dataGoThOrgSlug' | 'dataGoThResourceId' | 'dataGoThPackageId' | 'dataGoThSearchQuery'>
> & {
  enabled?: boolean;
  pollIntervalMinutes?: number | null;
  dataGoThOrgSlug?: string | null;
  dataGoThResourceId?: string | null;
  dataGoThPackageId?: string | null;
  dataGoThSearchQuery?: string | null;
};

export async function listGovSites(): Promise<IGovSite[]> {
  return GovSite.find().sort({ createdAt: 1 });
}

export async function getGovSiteById(id: string): Promise<IGovSite> {
  const site = await GovSite.findById(id);
  if (!site) throw AppError.notFound('Government site not found.');
  return site;
}

// Works per site, counted the way the public site lists them (a work the
// topic filter marked 'not-related' is never shown, so it isn't counted).
async function countWorksBySite(): Promise<Map<string, number>> {
  const rows = await Work.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { ingestionRelevance: { $ne: 'not-related' } } },
    { $group: { _id: '$siteId', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map(row => [row._id.toString(), row.count]));
}

type PlainGovSite = ReturnType<IGovSite['toObject']>;
const toPlain = (site: IGovSite): PlainGovSite => site.toObject();

// Public directory (E4): the site plus how many works it currently has.
export async function listGovSitesWithWorksCount(): Promise<(PlainGovSite & { worksCount: number })[]> {
  const [sites, counts] = await Promise.all([listGovSites(), countWorksBySite()]);
  return sites.map(site => ({ ...toPlain(site), worksCount: counts.get(site._id.toString()) ?? 0 }));
}

export interface LastRunSummary {
  runId: string;
  source: IngestionSource;
  status: IngestionRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
}

// Each site's most recent run -- the e-GP RSS run when there is one, because
// that is the primary source and the one that discovers new works. The
// data.go.th enrichment run that follows it is often a no-op (nothing
// configured to enrich from), and reporting THAT as "the last poll" would hide
// the real result behind "+0 new". One aggregation, not one query per site.
async function lastRunBySite(): Promise<Map<string, LastRunSummary>> {
  const rows = await IngestionRun.aggregate<{
    _id: { siteId: Types.ObjectId; source: IngestionSource };
    run: {
      _id: Types.ObjectId;
      source: IngestionSource;
      status: IngestionRunStatus;
      startedAt: Date;
      finishedAt?: Date;
      fetchedCount: number;
      newCount: number;
      updatedCount: number;
      failedCount: number;
    };
  }>([
    { $sort: { siteId: 1, startedAt: -1 } },
    { $group: { _id: { siteId: '$siteId', source: '$source' }, run: { $first: '$$ROOT' } } }
  ]);

  const bySite = new Map<string, LastRunSummary>();
  for (const { _id, run } of rows) {
    const summary: LastRunSummary = {
      runId: run._id.toString(),
      source: run.source,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      fetchedCount: run.fetchedCount,
      newCount: run.newCount,
      updatedCount: run.updatedCount,
      failedCount: run.failedCount
    };
    const key = _id.siteId.toString();
    const existing = bySite.get(key);
    if (!existing || (summary.source === 'rss' && existing.source !== 'rss')) bySite.set(key, summary);
  }
  return bySite;
}

// Admin > Data Ingestion / Source Config: everything an admin needs to decide
// whether a department is worth polling -- real counts and real run results,
// not placeholders.
export async function listGovSitesForAdmin() {
  const [sites, counts, lastRuns, settings] = await Promise.all([
    listGovSites(),
    countWorksBySite(),
    lastRunBySite(),
    getIngestionSettings()
  ]);

  const now = new Date();
  return sites.map(site => ({
    ...toPlain(site),
    worksCount: counts.get(site._id.toString()) ?? 0,
    lastRun: lastRuns.get(site._id.toString()) ?? null,
    // What the schedule really uses for this site (its own override, else the
    // global setting) and when it will next fire -- null when it won't: the
    // site is disabled or the whole schedule is paused.
    effectiveIntervalMinutes: effectivePollIntervalMinutes(site.pollIntervalMinutes, settings.pollIntervalMinutes),
    nextRunAt: site.enabled && settings.scheduleEnabled ? effectiveNextPollAt(site, settings.pollIntervalMinutes, now) : null
  }));
}

// FR-2.10 / N3: adding a government site auto-creates its followable "site"
// tag, so it's a first-class facet immediately, with no separate admin step.
async function ensureSiteTag(site: IGovSite): Promise<void> {
  await Tag.updateOne(
    { facet: 'site', siteId: site._id },
    { $setOnInsert: { name: site.name, facet: 'site', aliases: [site.shortCode], siteId: site._id, retired: false } },
    { upsert: true }
  );
}

function isDuplicateKeyError(err: unknown): err is { code: 11000; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

// deptId and shortCode are each unique. The database says only "duplicate
// key"; say which field it is (and who has it), so the form can mark it.
async function describeConflict(err: unknown, excludeId?: string): Promise<AppError | null> {
  if (!isDuplicateKeyError(err)) return null;
  const clashes = Object.keys(err.keyPattern ?? {});
  for (const field of ['deptId', 'shortCode'] as const) {
    if (!clashes.includes(field)) continue;
    const value = (err as { keyValue?: Record<string, string> }).keyValue?.[field];
    const other = value ? await GovSite.findOne({ [field]: value, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('name shortCode') : null;
    const used = field === 'deptId' ? 'deptId' : 'short code';
    const message = other ? `${other.name} (${other.shortCode}) already uses this ${used}.` : `A government site already uses this ${used}.`;
    return new AppError(409, 'CONFLICT', message, { [field]: message });
  }
  return null;
}

// A site's tag is named after it, and tag names are unique within their group,
// so two sites cannot share a name: the second would be saved without its tag.
async function assertNameFree(name: string, excludeId?: string): Promise<void> {
  const other = await GovSite.findOne({ name, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('name shortCode');
  if (other) {
    const message = `${other.name} (${other.shortCode}) already uses this name.`;
    throw new AppError(409, 'CONFLICT', message, { name: message });
  }
}

export async function createGovSite(input: CreateGovSiteInput): Promise<IGovSite> {
  await assertNameFree(input.name);
  let site: IGovSite;
  try {
    site = await GovSite.create({
      name: input.name,
      nameEn: input.nameEn,
      shortCode: input.shortCode,
      deptId: input.deptId,
      announceTypes: input.announceTypes,
      dataGoThOrgSlug: input.dataGoThOrgSlug,
      dataGoThResourceId: input.dataGoThResourceId,
      dataGoThPackageId: input.dataGoThPackageId,
      dataGoThSearchQuery: input.dataGoThSearchQuery,
      requestsPerMinute: input.requestsPerMinute,
      pollIntervalMinutes: input.pollIntervalMinutes
    });
  } catch (err) {
    throw (await describeConflict(err)) ?? err;
  }

  try {
    await ensureSiteTag(site);
  } catch (err) {
    // A site-group tag with this name already exists (not made by a site): take
    // the site back out rather than leave one with no followable tag.
    await GovSite.deleteOne({ _id: site._id });
    if (isDuplicateKeyError(err)) {
      const message = 'A tag with this name already exists in the government-site group.';
      throw new AppError(409, 'CONFLICT', message, { name: message });
    }
    throw err;
  }
  return site;
}

// A site's tag is named after the site (tag.service.ts refuses to rename a site
// tag by hand: "rename the site in Source Configuration"), so a rename here has
// to carry over, or the website keeps offering the old name to follow. The tag
// itself stays, so its followers and works stay attached.
async function syncSiteTag(before: IGovSite, after: IGovSite): Promise<void> {
  if (before.name === after.name && before.shortCode === after.shortCode) return;

  const tag = await Tag.findOne({ facet: 'site', siteId: after._id });
  if (!tag) return ensureSiteTag(after);

  const previousName = tag.name;
  tag.name = after.name;
  tag.aliases = [...new Set([...tag.aliases.filter(alias => alias !== before.shortCode), after.shortCode])];
  try {
    await tag.save();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Some other site tag already has this name: keep the old name rather than
    // fail the rename the Super Admin asked for.
    logger.warn('govSite', `Site tag for ${after.shortCode} keeps its name "${previousName}": a site tag named "${after.name}" already exists.`);
    tag.name = previousName;
    await tag.save();
  }
}

export async function updateGovSite(id: string, input: UpdateGovSiteInput): Promise<IGovSite> {
  const before = await GovSite.findById(id);
  if (!before) throw AppError.notFound('Government site not found.');

  // `null` means "remove this setting" (pollIntervalMinutes: follow the global
  // schedule again; a data.go.th field: stop using it).
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) unset[key] = 1;
    else if (value !== undefined) set[key] = value;
  }
  const update: UpdateQuery<IGovSite> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  if (typeof input.name === 'string' && input.name !== before.name) await assertNameFree(input.name, id);

  let site: IGovSite | null;
  try {
    site = await GovSite.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  } catch (err) {
    throw (await describeConflict(err, id)) ?? err;
  }
  if (!site) throw AppError.notFound('Government site not found.');

  await syncSiteTag(before, site);
  return site;
}

export interface DeptIdCheckResult {
  announceType: AnnounceType;
  itemCount: number;
  // Up to 3 real titles, so an admin can eyeball "yes, this is the right agency" --
  // not just a count, which a wrong-but-still-populated deptId could also produce.
  sample: string[];
  error?: string;
}

export interface DeptIdVerification {
  deptId: string;
  checkedAt: Date;
  totalItems: number;
  // At least one announce type returned at least one real item.
  verified: boolean;
  results: DeptIdCheckResult[];
}

// e-GP's own RSS client (fetchEgpRssFeed) sets no fetch timeout -- fine for
// the worker, which has nowhere more useful to be. This is a synchronous
// admin waiting on a button, so a feed that hangs (confirmed live: the BigIP
// front door at process3.gprocurement.go.th redirects to
// process.gprocurement.go.th, which can simply never answer from some
// networks) must not spin forever with no feedback.
const DEPT_ID_CHECK_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s waiting for the e-GP feed.`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

// Live probe against the real e-GP RSS feed -- NOT a lookup (no directory
// maps a name to a deptId anywhere; see this file's header and
// seedGovSites.ts). Lets an admin confirm a candidate code actually returns
// real announcements BEFORE saving a new site, instead of saving it blind and
// finding out on the next scheduled poll. Read-only: no GovSite/Work/
// IngestionRun is touched.
export async function verifyDeptIdLive(deptId: string, announceTypes: AnnounceType[]): Promise<DeptIdVerification> {
  // In parallel -- these are independent reads of the same (small) feed, and
  // an admin waiting on this button should not pay for each type's timeout
  // in series (worst case: ~1 timeout, not announceTypes.length of them).
  const results = await Promise.all(
    announceTypes.map(async (announceType): Promise<DeptIdCheckResult> => {
      try {
        const items = await withTimeout(fetchEgpRssFeed(deptId, announceType), DEPT_ID_CHECK_TIMEOUT_MS);
        return { announceType, itemCount: items.length, sample: items.slice(0, 3).map(i => i.title) };
      } catch (err) {
        return { announceType, itemCount: 0, sample: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const totalItems = results.reduce((sum, r) => sum + r.itemCount, 0);
  return { deptId, checkedAt: new Date(), totalItems, verified: totalItems > 0, results };
}
