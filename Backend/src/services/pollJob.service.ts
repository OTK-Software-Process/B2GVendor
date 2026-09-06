import { Types } from 'mongoose';
import { PollJob, IPollJob, PollJobSource } from '../models/pollJob.model';
import { GovSite } from '../models/govSite.model';
import { AppError } from '../utils/AppError';
import { runRssPoll, runDataGoThEnrichment, pollAllEnabledSites, TriggeredBy } from './ingestion.service';
import { logger } from '../utils/logger';

/**
 * This is what makes "Poll Now" work across two containers: the API
 * container only ever calls enqueueSitePoll/enqueueAllSitesPoll (a plain
 * Mongo insert), and returns immediately. The separate ingestion-worker
 * container's claim loop (see worker.ts) is the only thing that actually
 * calls into ingestion.service.
 */

export async function enqueueSitePoll(
  siteId: string,
  source: PollJobSource,
  requestedBy: Types.ObjectId
): Promise<IPollJob> {
  const site = await GovSite.findById(siteId);
  if (!site) throw AppError.notFound('Government site not found.');

  return PollJob.create({ scope: 'site', siteId: site._id, source, requestedBy });
}

export async function enqueueAllSitesPoll(requestedBy: Types.ObjectId): Promise<IPollJob> {
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
  return PollJob.findOneAndUpdate(
    { status: 'queued' },
    { status: 'running', claimedAt: new Date() },
    { sort: { createdAt: 1 }, new: true }
  );
}

export async function executePollJob(job: IPollJob): Promise<void> {
  const triggeredBy: TriggeredBy = job.requestedBy === 'scheduler' ? 'scheduler' : job.requestedBy;
  const resultRunIds: Types.ObjectId[] = [];

  try {
    if (job.scope === 'all') {
      const runs = await pollAllEnabledSites(triggeredBy);
      resultRunIds.push(...runs.map(r => r._id));
    } else {
      if (!job.siteId) throw new Error('Job scope is "site" but siteId is missing');
      const site = await GovSite.findById(job.siteId);
      if (!site) throw new Error('Government site no longer exists');

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
  }

  job.finishedAt = new Date();
  await job.save();
}
