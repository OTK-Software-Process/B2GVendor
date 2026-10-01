import { Types } from 'mongoose';
import { Account } from '../models/account.model';
import { GovSite } from '../models/govSite.model';
import { IngestionRun, IIngestionRun, IngestionRunStatus, IngestionSource } from '../models/ingestionRun.model';
import { getPollStatus } from './pollJob.service';
import { getScheduleOverview } from './ingestionSettings.service';
import { Tag, TagFacet } from '../models/tag.model';
import { Work } from '../models/work.model';

export interface DashboardRunSummary {
  id: string;
  source: IngestionSource;
  status: IngestionRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
}

export interface DashboardSiteRow {
  siteId: string;
  name: string;
  shortCode: string;
  enabled: boolean;
  lastRun: DashboardRunSummary | null;
}

export interface AdminDashboard {
  generatedAt: Date;
  accounts: {
    vendors: { total: number; active: number; suspended: number };
    admins: { total: number; admin: number; superadmin: number; suspended: number };
  };
  tags: { active: number; retired: number; byFacet: Record<TagFacet, number> };
  sites: { total: number; enabled: number };
  works: { total: number };
  ingestion: {
    lastRun: (DashboardRunSummary & { site: { id: string; name: string; shortCode: string } }) | null;
    failedRuns24h: number;
    runningNow: number;
    queuedJobs: number;
    // From the automatic schedule itself (interval, pause switch, per-site
    // overrides), the same figure Data Ingestion shows -- null while the
    // schedule is paused or no site is enabled.
    nextScheduledAt: Date | null;
    scheduleEnabled: boolean;
    pollIntervalMinutes: number;
    sites: DashboardSiteRow[];
  };
}

const TAG_FACETS: readonly TagFacet[] = ['site', 'agency', 'method', 'category', 'keyword'];

function toRunSummary(run: IIngestionRun): DashboardRunSummary {
  return {
    id: run._id.toString(),
    source: run.source,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    fetchedCount: run.fetchedCount,
    newCount: run.newCount,
    updatedCount: run.updatedCount,
    failedCount: run.failedCount
  };
}

// One read-only snapshot for the admin landing page. Everything is computed
// from live collections -- nothing here is stored or hand-edited -- so the
// numbers always agree with the pages they summarise. Runs as parallel
// count/aggregate queries (no per-document loading), so it stays cheap as the
// collections grow.
export async function getAdminDashboard(): Promise<AdminDashboard> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    accountGroups,
    tagGroups,
    retiredTagCount,
    sites,
    workTotal,
    lastRun,
    latestRunPerSite,
    failedRuns24h,
    runningNow,
    pollStatus,
    schedule
  ] = await Promise.all([
    Account.aggregate<{ _id: { role: string; status: string }; count: number }>([
      { $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } }
    ]),
    Tag.aggregate<{ _id: TagFacet; count: number }>([
      { $match: { retired: { $ne: true } } },
      { $group: { _id: '$facet', count: { $sum: 1 } } }
    ]),
    Tag.countDocuments({ retired: true }),
    GovSite.find().select('name shortCode enabled').sort({ name: 1 }).lean(),
    Work.estimatedDocumentCount(),
    IngestionRun.findOne().sort({ startedAt: -1 }).populate('siteId', 'name shortCode'),
    IngestionRun.aggregate<{ _id: Types.ObjectId; run: IIngestionRun }>([
      { $sort: { startedAt: -1 } },
      { $group: { _id: '$siteId', run: { $first: '$$ROOT' } } }
    ]),
    IngestionRun.countDocuments({ status: 'failed', startedAt: { $gte: since24h } }),
    IngestionRun.countDocuments({ status: 'running' }),
    // A request nobody ever claimed (no worker running) stops counting as
    // queued after an hour -- the same rule that unlocks "Poll Now".
    getPollStatus(),
    getScheduleOverview()
  ]);
  const queuedJobs = pollStatus.activeJobs.filter(job => job.status === 'queued').length;

  const accountCount = (role: string, status?: string): number =>
    accountGroups
      .filter(g => g._id.role === role && (status === undefined || g._id.status === status))
      .reduce((sum, g) => sum + g.count, 0);

  const vendorActive = accountCount('user', 'active');
  const vendorSuspended = accountCount('user', 'suspended');
  const adminCount = accountCount('admin');
  const superadminCount = accountCount('superadmin');

  const byFacet = Object.fromEntries(TAG_FACETS.map(f => [f, 0])) as Record<TagFacet, number>;
  for (const group of tagGroups) byFacet[group._id] = group.count;

  const runBySite = new Map(latestRunPerSite.map(entry => [entry._id.toString(), entry.run]));
  const enabledSites = sites.filter(s => s.enabled);

  let lastRunSummary: AdminDashboard['ingestion']['lastRun'] = null;
  if (lastRun) {
    const site = lastRun.siteId as unknown as { _id: Types.ObjectId; name: string; shortCode: string } | null;
    lastRunSummary = {
      ...toRunSummary(lastRun),
      site: {
        id: site?._id?.toString() ?? '',
        name: site?.name ?? '-',
        shortCode: site?.shortCode ?? '-'
      }
    };
  }

  return {
    generatedAt: new Date(),
    accounts: {
      vendors: { total: vendorActive + vendorSuspended, active: vendorActive, suspended: vendorSuspended },
      admins: {
        total: adminCount + superadminCount,
        admin: adminCount,
        superadmin: superadminCount,
        suspended: accountCount('admin', 'suspended') + accountCount('superadmin', 'suspended')
      }
    },
    tags: {
      active: Object.values(byFacet).reduce((a, b) => a + b, 0),
      retired: retiredTagCount,
      byFacet
    },
    sites: { total: sites.length, enabled: enabledSites.length },
    works: { total: workTotal },
    ingestion: {
      lastRun: lastRunSummary,
      failedRuns24h,
      runningNow,
      queuedJobs,
      nextScheduledAt: schedule.nextRunAt,
      scheduleEnabled: schedule.scheduleEnabled,
      pollIntervalMinutes: schedule.pollIntervalMinutes,
      sites: sites.map(s => {
        const run = runBySite.get(s._id.toString());
        return {
          siteId: s._id.toString(),
          name: s.name,
          shortCode: s.shortCode,
          enabled: s.enabled,
          lastRun: run ? toRunSummary(run) : null
        };
      })
    }
  };
}
