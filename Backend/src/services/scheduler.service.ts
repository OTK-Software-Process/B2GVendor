import { GovSite } from '../models/govSite.model';
import { PollJob } from '../models/pollJob.model';
import { effectivePollIntervalMinutes } from '../config/polling';
import { getIngestionSettings, effectiveNextPollAt } from './ingestionSettings.service';
import { logger } from '../utils/logger';

// FR-N1.2: scheduled poll, admin-configurable interval (admin > Data Ingestion
// > Automatic Schedule -- default 24 hours, never below 2), pausable. Runs only
// in the ingestion-worker process (see worker.ts) -- the API container never
// calls this directly.
export async function enqueueDueSitePolls(): Promise<number> {
  const settings = await getIngestionSettings();
  // Paused by an admin: the schedule does nothing (manual Poll Now still works).
  if (!settings.scheduleEnabled) return 0;

  const now = new Date();
  const sites = await GovSite.find({ enabled: true });

  let enqueued = 0;
  for (const site of sites) {
    const nextAt = effectiveNextPollAt(site, settings.pollIntervalMinutes, now);

    if (nextAt > now) {
      // Not due. If the interval was shortened since nextPollAt was written,
      // persist the pulled-in time so the DB matches what the admin sees.
      if (!site.nextPollAt || site.nextPollAt.getTime() !== nextAt.getTime()) {
        await GovSite.updateOne({ _id: site._id }, { $set: { nextPollAt: nextAt } });
      }
      continue;
    }

    // Skip if a job for this site is already queued/running, so a slow
    // previous run doesn't pile up duplicate scheduled jobs.
    const pending = await PollJob.findOne({
      scope: 'site',
      siteId: site._id,
      status: { $in: ['queued', 'running'] }
    });

    const intervalMinutes = effectivePollIntervalMinutes(site.pollIntervalMinutes, settings.pollIntervalMinutes);
    // updateOne (not site.save()): only nextPollAt changes, and a full-document
    // save would re-validate every loaded path -- so a site override saved
    // before the 2-hour floor existed would fail here on every tick.
    await GovSite.updateOne(
      { _id: site._id },
      { $set: { nextPollAt: new Date(now.getTime() + intervalMinutes * 60 * 1000) } }
    );

    if (pending) continue;

    await PollJob.create({ scope: 'site', siteId: site._id, source: 'both', requestedBy: 'scheduler' });
    enqueued += 1;
  }

  if (enqueued > 0) {
    logger.info('scheduler', `Enqueued ${enqueued} scheduled poll job(s)`);
  }

  return enqueued;
}
