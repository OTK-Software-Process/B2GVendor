import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

// Integration check for admin poll control: the automatic-schedule interval
// (default 24h, floor 2h), the server-side "a poll is running" lock that every
// admin shares, stale-job recovery, and the department enable/disable list.
// Run: npm run check:poll-control  (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". It also forces AI off and points the
// e-GP feed at a dead port, so it can never spend AI credits or touch the
// real government feed, whatever is in Backend/.env.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-poll-control-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI; // set BEFORE the app modules read env
process.env.AI_TAGGING_ENABLED = 'false';
process.env.EGP_RSS_BASE_URL = 'http://127.0.0.1:9/none';

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function minutesFromNow(date: Date | undefined | null, now = Date.now()): number | null {
  return date ? (date.getTime() - now) / 60_000 : null;
}

async function rejectsWith(promise: Promise<unknown>): Promise<{ status?: number; code?: string; message?: string; name?: string }> {
  try {
    await promise;
    return {};
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string; name?: string };
    return { status: e.status, code: e.code, message: e.message, name: e.name };
  }
}

async function main(): Promise<void> {
  const { GovSite } = await import('../../src/models/govSite.model');
  const { PollJob } = await import('../../src/models/pollJob.model');
  const { IngestionRun } = await import('../../src/models/ingestionRun.model');
  const { IngestionSettings } = await import('../../src/models/ingestionSettings.model');
  const { Work } = await import('../../src/models/work.model');
  const { Account } = await import('../../src/models/account.model');
  const { Session, issueSessionToken, SESSION_TTL_MS } = await import('../../src/models/session.model');
  const { SESSION_COOKIE_NAME } = await import('../../src/config/cookie');
  const polling = await import('../../src/config/polling');
  const settingsService = await import('../../src/services/ingestionSettings.service');
  const pollJobService = await import('../../src/services/pollJob.service');
  const schedulerService = await import('../../src/services/scheduler.service');
  const govSiteService = await import('../../src/services/govSite.service');
  const { adminRouter } = await import('../../src/routes/admin.routes');
  const { govSiteRouter } = await import('../../src/routes/govSite.routes');
  const { errorHandler, notFoundHandler } = await import('../../src/middlewares/error.middleware');
  const { sanitizeInput } = await import('../../src/middlewares/sanitize.middleware');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    GovSite.syncIndexes(),
    PollJob.syncIndexes(),
    IngestionSettings.syncIndexes(),
    Account.syncIndexes(),
    Session.syncIndexes()
  ]);

  const resetJobsAndRuns = async (): Promise<void> => {
    await Promise.all([PollJob.deleteMany({}), IngestionRun.deleteMany({})]);
  };
  const resetSites = async (): Promise<void> => {
    await Promise.all([GovSite.deleteMany({}), Work.deleteMany({})]);
  };

  let deptCounter = 1000;
  const makeSite = (over: Record<string, unknown> = {}) =>
    GovSite.create({
      name: `Site ${deptCounter}`,
      shortCode: `S${deptCounter}`,
      deptId: String(deptCounter++),
      ...over
    });

  // ---------------------------------------------------------------- 1. interval rules
  {
    const s = await settingsService.getIngestionSettings();
    record(s.pollIntervalMinutes === 1440, 'default interval is 24 hours (1440 min)', `got ${s.pollIntervalMinutes}`);
    record(s.scheduleEnabled === true, 'schedule is enabled by default');
    record((await IngestionSettings.countDocuments({})) === 1, 'settings is a singleton document');

    const [a, b] = await Promise.all([settingsService.getIngestionSettings(), settingsService.getIngestionSettings()]);
    record(String(a._id) === String(b._id) && (await IngestionSettings.countDocuments({})) === 1, 'concurrent first reads never create a second settings doc');

    record(polling.MIN_POLL_INTERVAL_MINUTES === 120, 'the floor is exactly 2 hours');
    record(polling.effectivePollIntervalMinutes(undefined, 1440) === 1440, 'no override -> global interval');
    record(polling.effectivePollIntervalMinutes(300, 1440) === 300, 'override wins over global');
    record(polling.effectivePollIntervalMinutes(5, 1440) === 120, 'a legacy override below the floor is clamped up to 2h', `got ${polling.effectivePollIntervalMinutes(5, 1440)}`);
    record(polling.effectivePollIntervalMinutes(undefined, 30) === 120, 'a global value below the floor is clamped too');
    record(polling.effectivePollIntervalMinutes(Number.NaN, Number.NaN) === 1440, 'NaN falls back to the 24h default');

    const updated = await settingsService.updateIngestionSettings({ pollIntervalMinutes: 180 }, new mongoose.Types.ObjectId());
    record(updated.pollIntervalMinutes === 180, 'admin can set a valid interval (3h)');
    record((await settingsService.getIngestionSettings()).pollIntervalMinutes === 180, 'the new interval is persisted');

    const tooLow = await rejectsWith(settingsService.updateIngestionSettings({ pollIntervalMinutes: 119 }, new mongoose.Types.ObjectId()));
    record(tooLow.name === 'ValidationError', 'the MODEL rejects 119 min even if the request validator is bypassed', `got ${tooLow.name}`);
    record((await settingsService.getIngestionSettings()).pollIntervalMinutes === 180, 'a rejected update leaves the stored interval unchanged');

    const exactly2h = await settingsService.updateIngestionSettings({ pollIntervalMinutes: 120 }, new mongoose.Types.ObjectId());
    record(exactly2h.pollIntervalMinutes === 120, 'exactly 2 hours (120 min) is allowed');

    const paused = await settingsService.updateIngestionSettings({ scheduleEnabled: false }, new mongoose.Types.ObjectId());
    record(paused.scheduleEnabled === false && paused.nextRunAt === null, 'pausing the schedule reports no next run');

    await settingsService.updateIngestionSettings({ pollIntervalMinutes: 1440, scheduleEnabled: true }, new mongoose.Types.ObjectId());
  }

  // ---------------------------------------------------------------- 2. scheduler honours the interval
  {
    await resetSites();
    await resetJobsAndRuns();
    const site = await makeSite();

    const t0 = Date.now();
    const enqueued = await schedulerService.enqueueDueSitePolls();
    record(enqueued === 1, 'a never-polled enabled site is scheduled on the first tick');
    const afterFirst = await GovSite.findById(site._id);
    const mins = minutesFromNow(afterFirst?.nextPollAt, t0);
    record(mins !== null && Math.abs(mins - 1440) < 1, 'its next poll is ~24h out', `got ${mins?.toFixed(1)} min`);

    record((await schedulerService.enqueueDueSitePolls()) === 0, 'a second tick right away enqueues nothing (not due)');

    // Admin shortens the interval to 2h while nextPollAt is still ~24h away.
    await settingsService.updateIngestionSettings({ pollIntervalMinutes: 120 }, new mongoose.Types.ObjectId());
    const overview = await settingsService.getScheduleOverview();
    const overviewMins = minutesFromNow(overview.nextRunAt);
    record(overviewMins !== null && overviewMins <= 120.5, 'shortening the interval pulls the displayed next run in to <= 2h', `got ${overviewMins?.toFixed(1)} min`);
    await schedulerService.enqueueDueSitePolls();
    const pulled = await GovSite.findById(site._id);
    const pulledMins = minutesFromNow(pulled?.nextPollAt);
    record(pulledMins !== null && pulledMins <= 120.5, 'and the scheduler persists the pulled-in time', `got ${pulledMins?.toFixed(1)} min`);

    // Paused schedule does nothing, even when a site is due.
    await GovSite.updateOne({ _id: site._id }, { $unset: { nextPollAt: 1 } });
    await PollJob.deleteMany({});
    await settingsService.updateIngestionSettings({ scheduleEnabled: false }, new mongoose.Types.ObjectId());
    record((await schedulerService.enqueueDueSitePolls()) === 0, 'a paused schedule enqueues nothing even when a site is due');
    await settingsService.updateIngestionSettings({ scheduleEnabled: true }, new mongoose.Types.ObjectId());
    record((await schedulerService.enqueueDueSitePolls()) === 1, 'resuming the schedule picks the due site up again');

    // A disabled site is never scheduled.
    await resetJobsAndRuns();
    await GovSite.updateOne({ _id: site._id }, { $set: { enabled: false }, $unset: { nextPollAt: 1 } });
    record((await schedulerService.enqueueDueSitePolls()) === 0, 'a disabled department is never scheduled');

    // A legacy per-site override below the floor (written around validation).
    await GovSite.updateOne({ _id: site._id }, { $set: { enabled: true, pollIntervalMinutes: 5 }, $unset: { nextPollAt: 1 } });
    await settingsService.updateIngestionSettings({ pollIntervalMinutes: 1440 }, new mongoose.Types.ObjectId());
    const t1 = Date.now();
    const legacyEnqueued = await schedulerService.enqueueDueSitePolls();
    const legacy = await GovSite.findById(site._id);
    const legacyMins = minutesFromNow(legacy?.nextPollAt, t1);
    record(legacyEnqueued === 1, 'a site with a legacy 5-minute override still schedules (no validation crash)');
    record(legacyMins !== null && Math.abs(legacyMins - 120) < 1, 'and its next poll is clamped to 2h, not 5 minutes', `got ${legacyMins?.toFixed(1)} min`);
  }

  // ---------------------------------------------------------------- 3. the shared "poll in progress" lock
  {
    await resetSites();
    await resetJobsAndRuns();
    const admin = new mongoose.Types.ObjectId();
    const site = await makeSite();

    record((await pollJobService.getPollStatus()).isPolling === false, 'idle: no poll in progress');

    const job = await pollJobService.enqueueAllSitesPoll(admin);
    let status = await pollJobService.getPollStatus();
    record(status.isPolling && status.activeJobs.length === 1, 'after Poll Now the server reports a poll in progress');
    record(status.activeJobs[0]?.status === 'queued' && status.activeJobs[0]?.trigger === 'manual' && status.activeJobs[0]?.scope === 'all', 'reported as a queued, manual, all-sites job');

    const second = await rejectsWith(pollJobService.enqueueAllSitesPoll(new mongoose.Types.ObjectId()));
    record(second.status === 409 && second.code === 'CONFLICT', 'a second Poll Now (any admin) is refused with 409 CONFLICT', `got ${second.status}/${second.code}`);
    const secondSite = await rejectsWith(pollJobService.enqueueSitePoll(String(site._id), 'both', new mongoose.Types.ObjectId()));
    record(secondSite.status === 409, 'a per-site poll is refused too while one is running', `got ${secondSite.status}`);
    record((await PollJob.countDocuments({})) === 1, 'the refused requests created no extra jobs');

    const claimed = await pollJobService.claimNextPollJob();
    record(claimed?.status === 'running' && !!claimed.heartbeatAt, 'claiming a job marks it running with a heartbeat');
    status = await pollJobService.getPollStatus();
    record(status.isPolling && status.activeJobs[0]?.status === 'running', 'still reported in progress while running');

    // Finishing releases the lock for everyone.
    await PollJob.updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date() } });
    record((await pollJobService.getPollStatus()).isPolling === false, 'once the job is done the lock is released');
    const next = await pollJobService.enqueueAllSitesPoll(admin);
    record(!!next._id, 'and a new Poll Now is accepted again');
    await resetJobsAndRuns();

    // Scheduler-created jobs lock it too, and are labelled as such.
    await PollJob.create({ scope: 'site', siteId: site._id, source: 'both', requestedBy: 'scheduler' });
    const sched = await pollJobService.getPollStatus();
    record(sched.isPolling && sched.activeJobs[0]?.trigger === 'scheduler' && sched.activeJobs[0]?.siteName === site.name, 'a scheduled poll also locks Poll Now and names its site');
    await resetJobsAndRuns();
  }

  // ---------------------------------------------------------------- 4. crash recovery: a dead worker never locks Poll Now forever
  {
    await resetSites();
    await resetJobsAndRuns();
    const site = await makeSite();
    const admin = new mongoose.Types.ObjectId();
    const now = Date.now();

    // A running job whose worker died 5 minutes ago (no heartbeat since).
    const dead = await PollJob.create({
      scope: 'all', source: 'both', requestedBy: admin, status: 'running',
      claimedAt: new Date(now - 10 * 60_000), heartbeatAt: new Date(now - 5 * 60_000)
    });
    const orphanRun = await IngestionRun.create({
      siteId: site._id, source: 'rss', triggeredBy: admin, status: 'running', startedAt: new Date(now - 9 * 60_000)
    });
    const unrelatedOldRun = await IngestionRun.create({
      siteId: site._id, source: 'rss', triggeredBy: admin, status: 'success', startedAt: new Date(now - 60 * 60_000), finishedAt: new Date(now - 59 * 60_000)
    });

    record((await pollJobService.getPollStatus()).isPolling === false, 'a job with a stale heartbeat does NOT count as in progress');
    const acceptedDuringStale = await rejectsWith(pollJobService.enqueueAllSitesPoll(admin));
    record(acceptedDuringStale.status === undefined, 'so a new Poll Now is accepted (the button is not stuck)');
    await PollJob.deleteMany({ _id: { $ne: dead._id } });

    const closed = await pollJobService.reapStalePollJobs();
    record(closed === 1, 'the reaper closes the abandoned job', `closed ${closed}`);
    const reaped = await PollJob.findById(dead._id);
    record(reaped?.status === 'failed' && !!reaped.finishedAt && /stopped responding/.test(reaped.error ?? ''), 'it is marked failed with an explanation');
    record((await IngestionRun.findById(orphanRun._id))?.status === 'failed', "and the run it left 'running' is closed, so isAlreadyRunning() can't block the site forever");
    record((await IngestionRun.findById(unrelatedOldRun._id))?.status === 'success', 'while an unrelated older finished run is untouched');

    // A healthy running job (fresh heartbeat) must survive the reaper.
    const healthy = await PollJob.create({
      scope: 'all', source: 'both', requestedBy: admin, status: 'running', claimedAt: new Date(), heartbeatAt: new Date()
    });
    record((await pollJobService.reapStalePollJobs()) === 0 && (await PollJob.findById(healthy._id))?.status === 'running', 'a running job with a fresh heartbeat is left alone');
    record((await pollJobService.getPollStatus()).isPolling === true, 'and still counts as in progress');
    await PollJob.deleteMany({});

    // A queued job nobody ever claimed (no worker running).
    const orphanQueued = await PollJob.create({ scope: 'all', source: 'both', requestedBy: admin });
    await PollJob.collection.updateOne({ _id: orphanQueued._id }, { $set: { createdAt: new Date(now - 2 * 60 * 60_000) } });
    record((await pollJobService.getPollStatus()).isPolling === false, 'a queued job older than an hour no longer counts as in progress');
    await pollJobService.reapStalePollJobs();
    record((await PollJob.findById(orphanQueued._id))?.status === 'failed', 'and the reaper expires it');
    await resetJobsAndRuns();
  }

  // ---------------------------------------------------------------- 5. enabling / disabling departments
  {
    await resetSites();
    await resetJobsAndRuns();
    const admin = new mongoose.Types.ObjectId();
    const on = await makeSite({ enabled: true });
    const off = await makeSite({ enabled: false });

    const offPoll = await rejectsWith(pollJobService.enqueueSitePoll(String(off._id), 'both', admin));
    record(offPoll.status === 400 && /disabled/i.test(offPoll.message ?? ''), 'polling a disabled department is refused with a clear message', `got ${offPoll.status} ${offPoll.message}`);

    // Disabled after the job was queued: the worker skips it instead of polling.
    const queued = await PollJob.create({ scope: 'site', siteId: off._id, source: 'both', requestedBy: admin, status: 'running', claimedAt: new Date(), heartbeatAt: new Date() });
    await pollJobService.executePollJob(queued);
    const executed = await PollJob.findById(queued._id);
    record(executed?.status === 'failed' && /disabled/i.test(executed.error ?? ''), 'a job for a since-disabled department fails fast without polling');
    await resetJobsAndRuns();

    await GovSite.updateMany({}, { $set: { enabled: false } });
    const noneEnabled = await rejectsWith(pollJobService.enqueueAllSitesPoll(admin));
    record(noneEnabled.status === 400, 'Poll all is refused when no department is enabled', `got ${noneEnabled.status}`);
    await GovSite.updateOne({ _id: on._id }, { $set: { enabled: true } });

    const toggled = await govSiteService.updateGovSite(String(on._id), { enabled: false });
    record(toggled.enabled === false && (await GovSite.findById(on._id))?.enabled === false, 'toggling a department off persists');
    const back = await govSiteService.updateGovSite(String(on._id), { enabled: true });
    record(back.enabled === true, 'and back on');

    const badOverride = await rejectsWith(govSiteService.updateGovSite(String(on._id), { pollIntervalMinutes: 60 }));
    record(badOverride.name === 'ValidationError', 'a per-site interval below 2h is rejected by the model too', `got ${badOverride.name}`);
    await govSiteService.updateGovSite(String(on._id), { pollIntervalMinutes: 300 });
    record((await GovSite.findById(on._id))?.pollIntervalMinutes === 300, 'a valid per-site override (5h) is stored');
    await govSiteService.updateGovSite(String(on._id), { pollIntervalMinutes: null });
    record((await GovSite.findById(on._id))?.pollIntervalMinutes === undefined, 'null clears the override so the site follows the global schedule');
  }

  // ---------------------------------------------------------------- 6. the department list shows real data
  {
    await resetSites();
    await resetJobsAndRuns();
    const a = await makeSite();
    const b = await makeSite({ enabled: false });
    const mkWork = (siteId: unknown, n: number, over: Record<string, unknown> = {}) =>
      Work.create({ siteId, projectId: `P${n}-${Math.random()}`, title: `Work ${n}`, status: 'BIDDING', announceType: 'D0', ...over });
    await mkWork(a._id, 1);
    await mkWork(a._id, 2);
    await mkWork(a._id, 3, { ingestionRelevance: 'not-related' });
    await mkWork(b._id, 4);

    const older = await IngestionRun.create({ siteId: a._id, source: 'rss', triggeredBy: 'scheduler', status: 'failed', startedAt: new Date(Date.now() - 3_600_000), finishedAt: new Date(Date.now() - 3_500_000), failedCount: 2 });
    const newest = await IngestionRun.create({ siteId: a._id, source: 'rss', triggeredBy: 'scheduler', status: 'success', startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), fetchedCount: 9, newCount: 4, updatedCount: 1 });

    const list = await govSiteService.listGovSitesForAdmin();
    const rowA = list.find(s => String(s._id) === String(a._id));
    const rowB = list.find(s => String(s._id) === String(b._id));
    record(rowA?.worksCount === 2, "worksCount is the site's real count (hidden 'not-related' works excluded)", `got ${rowA?.worksCount}`);
    record(rowB?.worksCount === 1, 'and per site', `got ${rowB?.worksCount}`);
    record(rowA?.lastRun?.runId === String(newest._id) && rowA.lastRun.status === 'success' && rowA.lastRun.newCount === 4, "lastRun is the site's most recent run with its real counts");
    record(rowA?.lastRun?.runId !== String(older._id), 'not an older one');

    // The data.go.th enrichment run that follows an RSS run is often a no-op
    // "+0"; it must not hide the RSS run's real result as "the last poll".
    const noopEnrichment = await IngestionRun.create({ siteId: a._id, source: 'data_go_th', triggeredBy: 'scheduler', status: 'success', startedAt: new Date(), finishedAt: new Date() });
    const withEnrichment = (await govSiteService.listGovSitesForAdmin()).find(s => String(s._id) === String(a._id));
    record(withEnrichment?.lastRun?.source === 'rss' && withEnrichment.lastRun.newCount === 4, "a newer no-op data.go.th run does not hide the RSS run's real counts", `got ${withEnrichment?.lastRun?.source} new=${withEnrichment?.lastRun?.newCount}`);
    await IngestionRun.deleteOne({ _id: noopEnrichment._id });
    const onlyEnrichmentSite = await makeSite();
    await IngestionRun.create({ siteId: onlyEnrichmentSite._id, source: 'data_go_th', triggeredBy: 'scheduler', status: 'success', startedAt: new Date(), finishedAt: new Date(), updatedCount: 2 });
    const onlyEnrichment = (await govSiteService.listGovSitesForAdmin()).find(s => String(s._id) === String(onlyEnrichmentSite._id));
    record(onlyEnrichment?.lastRun?.source === 'data_go_th', 'a site with only an enrichment run still reports it');
    record(rowB?.lastRun === null, 'a never-polled site has no lastRun (null, not a fake)');
    record(rowA?.nextRunAt instanceof Date && rowB?.nextRunAt === null, 'an enabled site has a next run; a disabled one has none');
    record(typeof rowA?.effectiveIntervalMinutes === 'number' && rowA.effectiveIntervalMinutes >= 120, 'each row reports the interval actually used (>= 2h)');

    const publicList = await govSiteService.listGovSitesWithWorksCount();
    record(publicList.find(s => String(s._id) === String(a._id))?.worksCount === 2, 'the public directory carries the same real works count');
  }

  // ---------------------------------------------------------------- 7. the same rules over real HTTP
  {
    await resetSites();
    await resetJobsAndRuns();
    await settingsService.updateIngestionSettings({ pollIntervalMinutes: 1440, scheduleEnabled: true }, new mongoose.Types.ObjectId());
    const site = await makeSite();

    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(sanitizeInput);
    app.use('/api/v1/admin', adminRouter);
    app.use('/api/v1/gov-sites', govSiteRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const login = async (role: 'admin' | 'superadmin' | 'user'): Promise<string> => {
      const account = await Account.create({
        email: `${role}${Math.random().toString(36).slice(2)}@x.co.th`,
        passwordHash: 'SecurePass123',
        name: `Test ${role}`,
        role
      });
      const { raw, tokenHash } = issueSessionToken();
      await Session.create({ accountId: account._id, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
      return `${SESSION_COOKIE_NAME}=${raw}`;
    };
    const call = async (method: string, path: string, cookie?: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: any; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
      return { status: res.status, json };
    };

    const adminCookie = await login('admin');
    const superCookie = await login('superadmin');
    const userCookie = await login('user');

    record((await call('GET', '/admin/ingestion/status')).status === 401, 'status endpoint requires login');
    record((await call('GET', '/admin/ingestion/status', userCookie)).status === 403, 'and admin rights');

    let r = await call('GET', '/admin/ingestion/settings', adminCookie);
    record(r.status === 200 && r.json?.data?.pollIntervalMinutes === 1440 && r.json?.data?.minIntervalMinutes === 120, 'GET settings -> 24h default and the 2h floor for the UI to validate against', JSON.stringify(r.json?.data));

    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 119 });
    record(r.status === 400 && r.json?.error?.code === 'VALIDATION_ERROR' && /2 hours/.test(r.json?.error?.fields?.pollIntervalMinutes ?? ''), 'PATCH 119 minutes -> 400 "cannot be lower than 2 hours"', JSON.stringify(r.json?.error));
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 0 });
    record(r.status === 400, 'PATCH 0 -> 400');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: -60 });
    record(r.status === 400, 'PATCH negative -> 400');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: '180' });
    record(r.status === 400, 'PATCH a string -> 400 (no silent coercion)');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 150.5 });
    record(r.status === 400, 'PATCH a fractional minute count -> 400');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 99999999 });
    record(r.status === 400, 'PATCH an absurdly large value -> 400');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, {});
    record(r.status === 400, 'PATCH an empty body -> 400');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 180, rogue: 1 });
    record(r.status === 400, 'PATCH an unknown field -> 400');
    record((await settingsService.getIngestionSettings()).pollIntervalMinutes === 1440, 'none of the rejected requests changed the stored interval');

    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 120 });
    record(r.status === 200 && r.json?.data?.pollIntervalMinutes === 120, 'PATCH exactly 2 hours -> 200');
    r = await call('PATCH', '/admin/ingestion/settings', adminCookie, { pollIntervalMinutes: 1440, scheduleEnabled: false });
    record(r.status === 200 && r.json?.data?.scheduleEnabled === false && r.json?.data?.nextRunAt === null, 'PATCH pause -> 200, no next run');
    await call('PATCH', '/admin/ingestion/settings', adminCookie, { scheduleEnabled: true });

    // Poll Now over HTTP: 201 then 409 for EVERY other admin.
    r = await call('POST', '/admin/gov-sites/poll-all', adminCookie);
    record(r.status === 201 && r.json?.data?.status === 'queued', 'POST poll-all -> 201 queued');
    r = await call('GET', '/admin/ingestion/status', superCookie);
    record(r.status === 200 && r.json?.data?.isPolling === true, 'a DIFFERENT admin account sees the poll in progress');
    r = await call('POST', '/admin/gov-sites/poll-all', superCookie);
    record(r.status === 409 && r.json?.error?.code === 'CONFLICT', 'and cannot start another (409 CONFLICT)', `${r.status} ${JSON.stringify(r.json?.error)}`);
    r = await call('POST', `/admin/gov-sites/${site._id}/poll`, adminCookie, { source: 'both' });
    record(r.status === 409, 'nor a per-site one');
    await PollJob.updateMany({}, { $set: { status: 'done', finishedAt: new Date() } });
    r = await call('GET', '/admin/ingestion/status', adminCookie);
    record(r.status === 200 && r.json?.data?.isPolling === false && r.json.data.activeJobs.length === 0, 'after it finishes, everyone sees it idle');

    // Department toggle permissions + persistence.
    r = await call('PATCH', `/admin/gov-sites/${site._id}`, adminCookie, { enabled: false });
    record(r.status === 403, 'a regular admin cannot enable/disable a department (Super Admin only, FR-N1.9)');
    r = await call('PATCH', `/admin/gov-sites/${site._id}`, superCookie, { enabled: false });
    record(r.status === 200 && r.json?.data?.enabled === false, 'a Super Admin can');
    r = await call('GET', '/admin/gov-sites', adminCookie);
    const row = (r.json?.data as any[] | undefined)?.find(s => String(s._id) === String(site._id));
    record(r.status === 200 && row?.enabled === false && 'worksCount' in row && 'lastRun' in row, 'the admin list reflects the persisted toggle, with real stats', JSON.stringify(row)?.slice(0, 140));
    r = await call('POST', `/admin/gov-sites/${site._id}/poll`, superCookie, { source: 'both' });
    record(r.status === 400, 'polling the now-disabled department over HTTP -> 400');
    r = await call('PATCH', `/admin/gov-sites/${site._id}`, superCookie, { pollIntervalMinutes: 30 });
    record(r.status === 400, 'a per-site interval of 30 min over HTTP -> 400');
    r = await call('GET', '/gov-sites');
    record(r.status === 200 && Array.isArray(r.json?.data) && 'worksCount' in r.json.data[0], 'the public directory works without login and carries worksCount');

    server.close();
  }

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
