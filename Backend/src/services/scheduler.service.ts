import { GovSite } from '../models/govSite.model';
import { PollJob } from '../models/pollJob.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// FR-N1.2: scheduled poll, per site, admin-configurable interval. Runs only
// in the ingestion-worker process (see worker.ts) -- the API container never
// calls this directly.
export async function enqueueDueSitePolls(): Promise<number> {
  const now = new Date();

  const dueSites = await GovSite.find({
    enabled: true,
    $or: [{ nextPollAt: { $lte: now } }, { nextPollAt: { $exists: false } }]
  });

  let enqueued = 0;
  for (const site of dueSites) {
    // Skip if a job for this site is already queued/running, so a slow
    // previous run doesn't pile up duplicate scheduled jobs.
    const pending = await PollJob.findOne({
      scope: 'site',
      siteId: site._id,
      status: { $in: ['queued', 'running'] }
    });

    const intervalMinutes = site.pollIntervalMinutes ?? env.POLL_DEFAULT_INTERVAL_MINUTES;
    site.nextPollAt = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    await site.save();

    if (pending) continue;

    await PollJob.create({ scope: 'site', siteId: site._id, source: 'both', requestedBy: 'scheduler' });
    enqueued += 1;
  }

  if (enqueued > 0) {
    logger.info('scheduler', `Enqueued ${enqueued} scheduled poll job(s)`);
  }

  return enqueued;
}
