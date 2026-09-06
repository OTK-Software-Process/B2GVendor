import cron from 'node-cron';
import { connectDb } from './config/db';
import { env } from './config/env';
import { claimNextPollJob, executePollJob } from './services/pollJob.service';
import { enqueueDueSitePolls } from './services/scheduler.service';
import { logger } from './utils/logger';

/**
 * Entry point for the ingestion-worker container -- a separate process from
 * the API server (server.ts), per the project's requirement that polling
 * run in its own container while still being reachable via "Poll Now".
 *
 * Two independent loops:
 *   1. Job-claim loop -- picks up PollJob rows (both scheduler-created and
 *      admin-triggered "Poll Now" requests) and executes them.
 *   2. Scheduler tick -- every minute, checks which GovSites are due for
 *      their next scheduled poll (FR-N1.2) and enqueues a job for them.
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

async function main(): Promise<void> {
  await connectDb();
  logger.info('worker', 'ingestion-worker started');

  setInterval(() => {
    claimLoop().catch(err => logger.error('worker', 'Unhandled error in claim loop', err));
  }, env.POLL_JOB_CLAIM_INTERVAL_MS);

  cron.schedule('* * * * *', () => {
    enqueueDueSitePolls().catch(err => logger.error('worker', 'Scheduler tick failed', err));
  });
}

main().catch(err => {
  console.error('[fatal] failed to start ingestion-worker', err);
  process.exit(1);
});
