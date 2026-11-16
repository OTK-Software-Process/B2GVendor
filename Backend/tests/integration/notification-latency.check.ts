import http from 'node:http';
import mongoose, { Types } from 'mongoose';

// "Instant notifications go out within about 5 minutes of the poll"
// (SRS Notification Timeliness).
//
// A real poll (PollJob -> worker -> e-GP feed served locally -> new works ->
// followers notified) with a popular tag: FOLLOWERS instant followers of a
// government site, and the poll brings NEW_WORKS new works for it, so
// FOLLOWERS x NEW_WORKS emails go to a local SMTP server that takes
// SMTP_DELAY_MS per message (a real provider takes tens to hundreds of ms).
// Measured from the moment the poll was requested to the last email accepted,
// plus the worker's claim interval (the longest a queued job waits to start).
//
// Also checks who must NOT get an instant email (daily digest, unverified,
// email switched off) and that sending is parallel but bounded.
// Run: npm run check:notify-latency   (needs a MongoDB; see MONGODB_URI below)

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-notify-latency-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}

const FOLLOWERS = 150;
const NEW_WORKS = 10;
const SMTP_DELAY_MS = 60;
const BUDGET_MS = 5 * 60_000;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const feed: { id: string; title: string }[] = [];
function startFeed(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
      const items = url.searchParams.get('anounceType') === 'D0' ? feed : [];
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return void res.end(
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>' +
          items.map(i => `<item><title>${i.title}</title><link>http://127.0.0.1/other/${i.id}</link><description>${i.id}, ${i.title}</description></item>`).join('') +
          '</channel></rss>'
      );
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main(): Promise<void> {
  const feedServer = await startFeed();
  Object.assign(process.env, {
    MONGODB_URI,
    EGP_RSS_BASE_URL: `http://127.0.0.1:${(feedServer.address() as { port: number }).port}/EPROCRssFeedWeb/egpannouncerss.xml`,
    AI_TAGGING_ENABLED: 'false',
    EGP_HTML_TOR_ENABLED: 'false'
  });

  const { env } = await import('../../src/config/env');
  const { startFakeSmtp } = await import('../helpers/fakeSmtp'); // after the env above is set: it reads env
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Tag } = await import('../../src/models/tag.model');
  const { Account } = await import('../../src/models/account.model');
  const { Follow } = await import('../../src/models/follow.model');
  const { Notification } = await import('../../src/models/notification.model');
  const { PollJob } = await import('../../src/models/pollJob.model');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const pollJobService = await import('../../src/services/pollJob.service');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite, Tag, Account, Follow, Notification, PollJob].map(m => m.syncIndexes()));

  const smtp = await startFakeSmtp({ acceptDelayMs: SMTP_DELAY_MS });
  const site = await createGovSite({ name: 'หน่วยงานยอดนิยม', shortCode: 'POPULAR', deptId: '7001', announceTypes: ['D0'], requestsPerMinute: 600 });
  const siteTag = await Tag.findOne({ facet: 'site', siteId: site._id });

  // Accounts straight into the collection (no bcrypt: not what this measures).
  const now = new Date();
  const people = (prefix: string, n: number, over: Record<string, unknown>) =>
    Array.from({ length: n }, (_, i) => ({
      _id: new Types.ObjectId(),
      email: `${prefix}${i}@notify.check`,
      name: `${prefix} ${i}`,
      passwordHash: 'x',
      role: 'user',
      permissions: [],
      status: 'active',
      emailVerified: true,
      emailNotificationsEnabled: true,
      notificationFrequency: 'instant',
      createdAt: now,
      updatedAt: now,
      ...over
    }));
  const instant = people('instant', FOLLOWERS, {});
  const daily = people('daily', 20, { notificationFrequency: 'daily' });
  const unverified = people('unverified', 10, { emailVerified: false });
  const muted = people('muted', 10, { emailNotificationsEnabled: false });
  const everyone = [...instant, ...daily, ...unverified, ...muted];
  await Account.collection.insertMany(everyone);
  await Follow.collection.insertMany(everyone.map(a => ({ accountId: a._id, tagId: siteTag!._id, paused: false, createdAt: now, updatedAt: now })));

  const runPoll = async (works: number, prefix: string) => {
    feed.length = 0;
    for (let i = 0; i < works; i++) feed.push({ id: `${prefix}${String(i).padStart(4, '0')}`, title: `ประกาศเชิญชวนงานใหม่ ${prefix}-${i}` });
    const before = smtp.messages.length;
    const job = await pollJobService.enqueueSitePoll(String(site._id), 'rss', new Types.ObjectId()); // "Poll Now" pressed
    const claimed = await pollJobService.claimNextPollJob();
    await pollJobService.executePollJob(claimed!);
    const done = await PollJob.findById(job._id);
    const sent = smtp.messages.length - before;
    const last = smtp.acceptedAt[smtp.acceptedAt.length - 1] ?? Date.now();
    return { status: done?.status, sent, elapsedMs: last - job.createdAt.getTime() };
  };

  // ---- one by one (the old behaviour), one new work: the per-email rate
  (env as { EMAIL_SEND_CONCURRENCY: number }).EMAIL_SEND_CONCURRENCY = 1;
  const serial = await runPoll(1, '6801');
  const serialPerEmail = serial.elapsedMs / Math.max(1, serial.sent);
  record(serial.sent === FOLLOWERS, `one new work, emails sent one by one: every instant follower gets one (${FOLLOWERS})`, `${serial.sent} in ${serial.elapsedMs} ms`);

  // ---- as configured (EMAIL_SEND_CONCURRENCY, default 5), a busy poll
  (env as { EMAIL_SEND_CONCURRENCY: number }).EMAIL_SEND_CONCURRENCY = 5;
  smtp.acceptedAt.length = 0;
  const peakBefore = smtp.maxInFlightMessages;
  const busy = await runPoll(NEW_WORKS, '6802');
  const worstCaseMs = busy.elapsedMs + env.POLL_JOB_CLAIM_INTERVAL_MS;
  const perEmail = busy.elapsedMs / Math.max(1, busy.sent);

  record(busy.status === 'done', 'the poll itself completes');
  record(busy.sent === FOLLOWERS * NEW_WORKS, `${NEW_WORKS} new works x ${FOLLOWERS} instant followers = ${FOLLOWERS * NEW_WORKS} emails, all accepted by the SMTP server`, String(busy.sent));
  record(busy.sent === FOLLOWERS * NEW_WORKS && worstCaseMs <= BUDGET_MS, `all of them sent, the last one goes out within 5 minutes of Poll Now (incl. up to ${env.POLL_JOB_CLAIM_INTERVAL_MS / 1000} s until a worker claims the job)`, `${(worstCaseMs / 1000).toFixed(1)} s`);
  record(smtp.maxInFlightMessages > 1 && smtp.maxInFlightMessages <= 5 && peakBefore <= 1, 'emails are sent in parallel, but never more than EMAIL_SEND_CONCURRENCY (5) at once', `peak ${smtp.maxInFlightMessages} messages in flight (one by one: ${peakBefore})`);
  record(perEmail < serialPerEmail / 2, 'which is several times faster per email than one by one', `${perEmail.toFixed(1)} vs ${serialPerEmail.toFixed(1)} ms/email`);

  // ---- who must not get an instant email
  const recipients = new Set(smtp.messages.map(m => m.match(/^To: .*?([^<\s]+@notify\.check)/im)?.[1]));
  const wrong = [...daily, ...unverified, ...muted].filter(a => recipients.has(a.email)).map(a => a.email);
  record(wrong.length === 0, 'no instant email to daily-digest, unverified or email-off accounts', wrong.slice(0, 3).join(', '));
  const dailyInApp = await Notification.countDocuments({ accountId: { $in: daily.map(a => a._id) } });
  record(dailyInApp === daily.length * (1 + NEW_WORKS), 'daily-digest followers still get the in-app notifications (for the digest)', String(dailyInApp));

  const capacity = Math.floor(BUDGET_MS / perEmail);
  console.log(results.join('\n'));
  console.log(
    `\nMeasured: ${busy.sent} emails in ${(busy.elapsedMs / 1000).toFixed(1)} s (${perEmail.toFixed(1)} ms each with ${SMTP_DELAY_MS} ms SMTP latency; one by one ${serialPerEmail.toFixed(1)} ms). ` +
      `At this rate one poll can notify ~${capacity} follower x new-work pairs within 5 minutes.`
  );
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  await smtp.close();
  feedServer.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
