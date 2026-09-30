import { Types, UpdateQuery } from 'mongoose';
import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Tag } from '../models/tag.model';
import { Work } from '../models/work.model';
import { IngestionRun, IngestionRunStatus, IngestionSource } from '../models/ingestionRun.model';
import { AppError } from '../utils/AppError';
import { effectivePollIntervalMinutes } from '../config/polling';
import { getIngestionSettings, effectiveNextPollAt } from './ingestionSettings.service';

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

// `pollIntervalMinutes: null` removes a site's own override so it follows the
// global schedule again.
export type UpdateGovSiteInput = Partial<Omit<CreateGovSiteInput, 'pollIntervalMinutes'>> & {
  enabled?: boolean;
  pollIntervalMinutes?: number | null;
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

export async function createGovSite(input: CreateGovSiteInput): Promise<IGovSite> {
  const site = await GovSite.create({
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

  await ensureSiteTag(site);
  return site;
}

export async function updateGovSite(id: string, input: UpdateGovSiteInput): Promise<IGovSite> {
  const { pollIntervalMinutes, ...rest } = input;

  const update: UpdateQuery<IGovSite> = { ...rest };
  if (pollIntervalMinutes === null) {
    update.$unset = { pollIntervalMinutes: 1 };
  } else if (pollIntervalMinutes !== undefined) {
    update.pollIntervalMinutes = pollIntervalMinutes;
  }

  const site = await GovSite.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  if (!site) throw AppError.notFound('Government site not found.');
  return site;
}
