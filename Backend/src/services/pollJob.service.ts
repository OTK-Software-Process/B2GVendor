import { FilterQuery, Types } from 'mongoose';
import { PollJob, IPollJob, PollJobSource } from '../models/pollJob.model';
import { GovSite } from '../models/govSite.model';
import { IngestionRun, IIngestionRun } from '../models/ingestionRun.model';
import { AppError } from '../utils/AppError';
import { runRssPoll, runDataGoThEnrichment, pollAllEnabledSites, TriggeredBy } from './ingestion.service';
import { logger } from '../utils/logger';

/**
 * This is what makes "Poll Now" work across two containers: the API
 * container only ever calls enqueueSitePoll/enqueueAllSitesPoll (a plain
 * Mongo insert), and returns immediately. The separate ingestion-worker
 * container's claim loop (see worker.ts) is the only thing that actually
 * calls into ingestion.service.
 *
 * Because the PollJob row is the single source of truth for "a poll is in
 * progress", that state lives on the server (getPollStatus) -- so every admin
 * account sees the same locked "Poll Now" button, and it survives a page
 * refresh, instead of being a flag in one browser tab.
 */

// While executing a job the worker refreshes `heartbeatAt` this often...
export const POLL_JOB_HEARTBEAT_MS = 15_000;
// ...and a 'running' job with no heartbeat for this long belongs to a worker
// that died (crash, redeploy, tsx-watch restart). It must stop counting as
// "in progress", or Poll Now would stay locked for every admin forever.
export const POLL_JOB_STALE_MS = 2 * 60_000;
// A 'queued' job this old was never claimed -- no worker is running. Same
// reasoning: don't let an orphaned request lock the button indefinitely.
export const POLL_JOB_QUEUE_EXPIRY_MS = 60 * 60_000;

// A job that is genuinely in progress: queued and still fresh, or running with
// a live heartbeat.
function activeJobFilter(now: number = Date.now()): FilterQuery<IPollJob> {
  return {
    $or: [
      { status: 'running', heartbeatAt: { $gte: new Date(now - POLL_JOB_STALE_MS) } },
      { status: 'queued', createdAt: { $gte: new Date(now - POLL_JOB_QUEUE_EXPIRY_MS) } }
    ]
  };
}

export interface ActivePollJobView {
  id: string;
  scope: 'site' | 'all';
  siteId?: string;
  siteName?: string;
  source: PollJobSource;
  status: 'queued' | 'running';
  trigger: 'scheduler' | 'manual';
  createdAt: Date;
  claimedAt?: Date;
}

export interface PollStatusView {
  isPolling: boolean;
  activeJobs: ActivePollJobView[];
}

interface PopulatedSiteRef {
  _id: Types.ObjectId;
  name: string;
}

export async function getPollStatus(): Promise<PollStatusView> {
  const jobs = await PollJob.find(activeJobFilter()).sort({ createdAt: 1 }).populate('siteId', 'name');

  const activeJobs = jobs.map((job): ActivePollJobView => {
    // populate() replaced the ObjectId with the site document (null if the
    // site has since been deleted).
    const site = job.siteId as unknown as PopulatedSiteRef | null | undefined;
    return {
      id: job._id.toString(),
      scope: job.scope,
      siteId: site?._id.toString(),
      siteName: site?.name,
      source: job.source,
      status: job.status as 'queued' | 'running',
      trigger: job.requestedBy === 'scheduler' ? 'scheduler' : 'manual',
      createdAt: job.createdAt,
      claimedAt: job.claimedAt
    };
  });

  return { isPolling: activeJobs.length > 0, activeJobs };
}

// One poll at a time, for everyone: while any job is queued/running, a manual
// request is refused (the UI has already disabled the button -- this is the
// server-side guarantee, e.g. two admins clicking at once). FR-N1.10.
async function assertNoActivePoll(): Promise<void> {
  if (await PollJob.exists(activeJobFilter())) {
    throw AppError.conflict('A poll is already in progress. Wait for it to finish before starting another.');
  }
}

export async function enqueueSitePoll(
  siteId: string,
  source: PollJobSource,
  requestedBy: Types.ObjectId
): Promise<IPollJob> {
  const site = await GovSite.findById(siteId);
  if (!site) throw AppError.notFound('Government site not found.');
  if (!site.enabled) {
    throw AppError.badRequest(`${site.name} is disabled. Enable it before polling it.`);
  }

  await assertNoActivePoll();
  return PollJob.create({ scope: 'site', siteId: site._id, source, requestedBy });
}

export async function enqueueAllSitesPoll(requestedBy: Types.ObjectId): Promise<IPollJob> {
  if ((await GovSite.countDocuments({ enabled: true })) === 0) {
    throw AppError.badRequest('No government site is enabled. Enable at least one before polling.');
  }

  await assertNoActivePoll();
  return PollJob.create({ scope: 'all', source: 'both', requestedBy });
}

export async function getPollJob(id: string): Promise<IPollJob> {
  const job = await PollJob.findById(id);
  if (!job) throw AppError.notFound('Poll job not found.');
  return job;
}

// --- Worker-side ---

// Atomic claim so two worker replicas (or the worker's queue-loop racing its
// own scheduler-loop) never both run the same job -- FR-N1.10.
export async function claimNextPollJob(): Promise<IPollJob | null> {
  const now = new Date();
  return PollJob.findOneAndUpdate(
    { status: 'queued' },
    { status: 'running', claimedAt: now, heartbeatAt: now },
    { sort: { createdAt: 1 }, new: true }
  );
}

export async function executePollJob(job: IPollJob): Promise<void> {
  const triggeredBy: TriggeredBy = job.requestedBy === 'scheduler' ? 'scheduler' : job.requestedBy;
  const resultRunIds: Types.ObjectId[] = [];

  // Proves to reapStalePollJobs / getPollStatus that this job is still being
  // worked on, however long the (AI-assisted) ingestion takes.
  const heartbeat = setInterval(() => {
    PollJob.updateOne({ _id: job._id }, { $set: { heartbeatAt: new Date() } }).catch(err =>
      logger.warn('pollJob', `Failed to record heartbeat for job ${job._id.toString()}`, err)
    );
  }, POLL_JOB_HEARTBEAT_MS);

  try {
    if (job.scope === 'all') {
      const runs = await pollAllEnabledSites(triggeredBy);
      resultRunIds.push(...runs.map(r => r._id));
    } else {
      if (!job.siteId) throw new Error('Job scope is "site" but siteId is missing');
      const site = await GovSite.findById(job.siteId);
      if (!site) throw new Error('Government site no longer exists');
      // Disabled after the job was queued (e.g. an admin switched the
      // department off while the previous poll was still running).
      if (!site.enabled) throw new Error(`${site.name} was disabled before this poll started -- skipped.`);

      if (job.source === 'rss' || job.source === 'both') {
        const run = await runRssPoll(site, triggeredBy);
        resultRunIds.push(run._id);
      }
      if (job.source === 'data_go_th' || job.source === 'both') {
        const run = await runDataGoThEnrichment(site, triggeredBy);
        resultRunIds.push(run._id);
      }
    }

    job.status = 'done';
    job.resultRunIds = resultRunIds;
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    logger.error('pollJob', `Job ${job._id.toString()} failed`, err);
  } finally {
    clearInterval(heartbeat);
  }

  job.finishedAt = new Date();
  await job.save();
}

const ABANDONED_JOB_MESSAGE =
  'The worker stopped responding while this job was running (crash, restart or redeploy).';
const ABANDONED_RUN_MESSAGE = 'Abandoned: the worker stopped while this run was in progress.';
const EXPIRED_JOB_MESSAGE = 'Expired: no worker picked this job up within an hour.';

// Closes the runs a dead job left behind. Without this, a run stuck in
// 'running' makes ingestion.service's isAlreadyRunning() refuse every future
// poll of that site.
async function abandonRunsOf(job: IPollJob, now: Date): Promise<void> {
  const filter: FilterQuery<IIngestionRun> = {
    status: 'running',
    startedAt: { $gte: job.claimedAt ?? job.createdAt }
  };
  if (job.scope === 'site' && job.siteId) filter.siteId = job.siteId;

  await IngestionRun.updateMany(filter, {
    $set: { status: 'failed', finishedAt: now },
    $push: { errorLog: ABANDONED_RUN_MESSAGE }
  });
}

/**
 * Recovers from a worker that died mid-job (and from jobs nobody ever
 * claimed): marks them failed so they stop locking "Poll Now" and stop
 * blocking the site's next run. Cheap; run it on the worker's every-minute tick.
 * Returns how many jobs were closed.
 */
export async function reapStalePollJobs(): Promise<number> {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const staleBefore = new Date(nowMs - POLL_JOB_STALE_MS);
  const staleRunningFilter: FilterQuery<IPollJob> = {
    status: 'running',
    $or: [{ heartbeatAt: { $lt: staleBefore } }, { heartbeatAt: { $exists: false } }]
  };

  let closed = 0;

  for (const job of await PollJob.find(staleRunningFilter)) {
    // Conditional on the same staleness, so a worker that heartbeats between
    // the find and this update isn't wrongly failed.
    const result = await PollJob.updateOne(
      { _id: job._id, ...staleRunningFilter },
      { $set: { status: 'failed', finishedAt: now, error: ABANDONED_JOB_MESSAGE } }
    );
    if (result.modifiedCount === 0) continue;

    await abandonRunsOf(job, now);
    closed += 1;
    logger.warn('pollJob', `Closed abandoned poll job ${job._id.toString()} (no heartbeat since ${(job.heartbeatAt ?? job.claimedAt ?? job.createdAt).toISOString()})`);
  }

  const expired = await PollJob.updateMany(
    { status: 'queued', createdAt: { $lt: new Date(nowMs - POLL_JOB_QUEUE_EXPIRY_MS) } },
    { $set: { status: 'failed', finishedAt: now, error: EXPIRED_JOB_MESSAGE } }
  );
  closed += expired.modifiedCount;

  return closed;
}
