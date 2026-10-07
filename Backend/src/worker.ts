// Must stay the FIRST import: the audit plugin only covers models compiled after it.
import { verifyAuditSetup } from './audit/install';
import cron from 'node-cron';
import { connectDb } from './config/db';
import { env } from './config/env';
import { claimNextPollJob, executePollJob, reapStalePollJobs } from './services/pollJob.service';
import { enqueueDueSitePolls } from './services/scheduler.service';
import { sendDailyDigests } from './services/notification.service';
import { logger } from './utils/logger';

/**
 * Entry point for the ingestion-worker container -- a separate process from
 * the API server (server.ts), per the project's requirement that polling
 * run in its own container while still being reachable via "Poll Now".
 *
 * Three independent loops:
 *   1. Job-claim loop -- picks up PollJob rows (both scheduler-created and
 *      admin-triggered "Poll Now" requests) and executes them.
 *   2. Scheduler tick -- every minute, closes jobs a dead worker left behind
 *      (so they stop locking "Poll Now"), then checks which GovSites are due
 *      for their next scheduled poll (FR-N1.2) and enqueues a job for them.
 *   3. Daily digest tick -- once a day, sends the batched summary email to
 *      every account on 'daily' notification frequency (see
 *      account/notifications/settings and notification.service.ts's
 *      sendDailyDigests).
 *
 * The API container (server.ts) never imports this file and never calls
 * ingestion.service.ts directly -- it only ever writes a PollJob row.
 */

let claiming = false;

async function claimLoop(): Promise<void> {
  if (claiming) return; // don't overlap if a previous claim+execute is still running
  claiming = true;
  try {
    const job = await claimNextPollJob();
    if (job) {
      logger.info('worker', `Claimed poll job ${job._id.toString()} (scope=${job.scope}, source=${job.source})`);
      await executePollJob(job);
      logger.info('worker', `Finished poll job ${job._id.toString()} (status=${job.status})`);
    }
  } catch (err) {
    logger.error('worker', 'Job-claim loop failed', err);
  } finally {
    claiming = false;
  }
}

async function schedulerTick(): Promise<void> {
  try {
    const closed = await reapStalePollJobs();
    if (closed > 0) logger.warn('worker', `Closed ${closed} abandoned/expired poll job(s)`);
  } catch (err) {
    // Housekeeping only -- never let it stop the schedule below from running.
    logger.error('worker', 'Stale poll-job cleanup failed', err);
  }

  await enqueueDueSitePolls();
}

async function main(): Promise<void> {
  await connectDb();
  for (const problem of verifyAuditSetup()) logger.error('audit', problem);
  logger.info('worker', 'ingestion-worker started');

  setInterval(() => {
    claimLoop().catch(err => logger.error('worker', 'Unhandled error in claim loop', err));
  }, env.POLL_JOB_CLAIM_INTERVAL_MS);

  cron.schedule('* * * * *', () => {
    schedulerTick().catch(err => logger.error('worker', 'Scheduler tick failed', err));
  });

  // 08:00 daily, matching what the settings page tells the user to expect
  // ("Receive one summary email every morning at 08:00 AM") -- server-local
  // time, same as every other schedule in this file.
  cron.schedule('0 8 * * *', () => {
    sendDailyDigests()
      .then(sent => {
        if (sent > 0) logger.info('worker', `Sent ${sent} daily digest email(s)`);
      })
      .catch(err => logger.error('worker', 'Daily digest tick failed', err));
  });
}

main().catch(err => {
  console.error('[fatal] failed to start ingestion-worker', err);
  process.exit(1);
});
