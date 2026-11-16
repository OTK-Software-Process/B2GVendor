import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import mongoose from 'mongoose';

// Integration check: polling the government sites (ingestion, N1), end to end.
//
//   A. Poll Now for one site and for all sites (HTTP API -> PollJob -> worker -> DB)
//   B. the Poll Now lock: shared by every admin, survives a page refresh, safe
//      against simultaneous clicks, and released after a worker CRASH (a real
//      worker process is started and killed mid-poll)
//   C. the automatic schedule: 24 h by default, 2 h minimum enforced server-side
//   D. disabled sites are skipped (poll-all, per-site, scheduler, disabled after queueing)
//   E. records are upserted by project id: a re-poll creates no duplicates
//   F. data.go.th only enriches; it never creates a work on its own
//   G. a failing site / source / announce type doesn't block the others; failed
//      requests are retried with backoff; a site that never answers times out
//   H. a poll that runs too long is stopped and logged as failed
//   I. run history shows the counts per site and source
//
// Run: npm run check:ingestion   (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". The e-GP RSS feed, the TOR files and
// data.go.th are all served by a local mock server started here -- the live
// government sites are never contacted, whatever is in Backend/.env.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-ingestion-flow-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}
const section = (title: string): void => {
  results.push(`---- ${title}`);
};

// ------------------------------------------------------------------ the mock government servers

// e-GP serves TIS-620 (Windows-874). Node can only decode it, so encode by hand.
function encodeTis620(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) bytes.push(c);
    else if (c >= 0x0e01 && c <= 0x0e3a) bytes.push(c - 0x0e01 + 0xa1);
    else if (c >= 0x0e3f && c <= 0x0e5b) bytes.push(c - 0x0e3f + 0xdf);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}
const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface FeedItem {
  id: string;
  title: string;
  link?: string; // default: a link type the pipeline never fetches ('other')
}
type FeedMode =
  | { kind: 'ok' }
  | { kind: 'fail'; status: number }
  | { kind: 'flaky'; failuresLeft: number }
  | { kind: 'slow'; delayMs: number }
  | { kind: 'hang' };

const feeds = new Map<string, Record<string, FeedItem[]>>(); // deptId -> announceType -> items
const feedModes = new Map<string, FeedMode>(); // deptId -> behaviour (default ok)
const failingTypes = new Set<string>(); // "deptId/announceType" that always answer 500
const rssRequests: { deptId: string; type: string; at: number }[] = [];

interface Datastore {
  mode: 'ok' | 'fail';
  records: Record<string, unknown>[];
}
const datastores = new Map<string, Datastore>(); // resource_id -> answer
const dataGoThRequests: { resourceId: string; at: number }[] = [];
const pdfHits = new Map<string, number>();
const hangingResponses = new Set<http.ServerResponse>();

let port = 0;
const otherLink = (id: string): string => `http://127.0.0.1:${port}/other/${id}`;
const pdfLink = (name: string): string => `http://127.0.0.1:${port}/egp-template-service/dwnt/view-pdf-file?templateId=${name}`;
const PDF_BYTES = Buffer.from('%PDF-1.4\n% ingestion-flow test document\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

function rssXml(deptId: string, type: string): Buffer {
  const items = (feeds.get(deptId)?.[type] ?? [])
    .map(
      it =>
        `<item><title>${xmlEscape(it.title)}</title><link>${xmlEscape(it.link ?? otherLink(it.id))}</link>` +
        `<description>${it.id}, ${xmlEscape(it.title)}</description><pubDate>Mon, 16 Nov 2026 10:00:00 +0700</pubDate></item>`
    )
    .join('');
  return encodeTis620(
    `<?xml version="1.0" encoding="windows-874"?><rss version="2.0"><channel><title>e-GP</title><link>x</link><description>d</description>${items}</channel></rss>`
  );
}

function startMockServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
      const deptId = url.searchParams.get('deptId') ?? '';
      const type = url.searchParams.get('anounceType') ?? '';
      rssRequests.push({ deptId, type, at: Date.now() });
      const mode = feedModes.get(deptId) ?? { kind: 'ok' };
      const answer = (): void => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(rssXml(deptId, type));
      };
      if (failingTypes.has(`${deptId}/${type}`)) {
        res.writeHead(500);
        return void res.end('type down');
      }
      if (mode.kind === 'fail') {
        res.writeHead(mode.status);
        return void res.end('site down');
      }
      if (mode.kind === 'flaky' && mode.failuresLeft > 0) {
        mode.failuresLeft -= 1;
        res.writeHead(503);
        return void res.end('try again');
      }
      if (mode.kind === 'slow') return void setTimeout(answer, mode.delayMs);
      if (mode.kind === 'hang') {
        hangingResponses.add(res);
        res.on('close', () => hangingResponses.delete(res));
        return; // never answers
      }
      return answer();
    }

    if (url.pathname === '/egp-template-service/dwnt/view-pdf-file') {
      const name = url.searchParams.get('templateId') ?? '';
      pdfHits.set(name, (pdfHits.get(name) ?? 0) + 1);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"` });
      return void res.end(PDF_BYTES);
    }

    if (url.pathname === '/api/3/action/datastore_search') {
      const resourceId = url.searchParams.get('resource_id') ?? '';
      dataGoThRequests.push({ resourceId, at: Date.now() });
      const store = datastores.get(resourceId);
      res.setHeader('Content-Type', 'application/json');
      if (!store || store.mode === 'fail') {
        res.statusCode = 500;
        return void res.end(JSON.stringify({ success: false, error: { message: 'datastore down' } }));
      }
      return void res.end(JSON.stringify({ success: true, result: { total: store.records.length, fields: [], records: store.records } }));
    }

    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(150);
  }
  return null;
}

async function main(): Promise<void> {
  const mock = await startMockServer();
  port = (mock.address() as { port: number }).port;
  const torDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-flow-check-'));

  // Set BEFORE the app modules read env.
  Object.assign(process.env, {
    MONGODB_URI,
    EGP_RSS_BASE_URL: `http://127.0.0.1:${port}/EPROCRssFeedWeb/egpannouncerss.xml`,
    DATA_GO_TH_BASE_URL: `http://127.0.0.1:${port}`,
    EGP_HTML_TOR_ENABLED: 'false',
    AI_TAGGING_ENABLED: 'false',
    INGESTION_REQUEST_TIMEOUT_MS: '1500',
    TOR_STORAGE_DIR: torDir,
    BCRYPT_ROUNDS: '10', // many test accounts; password hashing isn't what this check is about
    SMTP_HOST: ''
  });
  delete process.env.DATA_GO_TH_DEFAULT_PACKAGE_ID;
  delete process.env.DATA_GO_TH_DEFAULT_SEARCH_QUERY;

  const { createApp } = await import('../../src/app');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');
  const { Tag } = await import('../../src/models/tag.model');
  const { PollJob } = await import('../../src/models/pollJob.model');
  const { IngestionRun } = await import('../../src/models/ingestionRun.model');
  const { IngestionSettings } = await import('../../src/models/ingestionSettings.model');
  const { Account } = await import('../../src/models/account.model');
  const { Session, issueSessionToken, SESSION_TTL_MS } = await import('../../src/models/session.model');
  const { SESSION_COOKIE_NAME } = await import('../../src/config/cookie');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const pollJobService = await import('../../src/services/pollJob.service');
  const { enqueueDueSitePolls } = await import('../../src/services/scheduler.service');
  const settingsService = await import('../../src/services/ingestionSettings.service');
  const { RUN_TIMED_OUT_MESSAGE } = await import('../../src/services/ingestion.service');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite, Work, Tag, PollJob, IngestionRun, IngestionSettings, Account, Session].map(m => m.syncIndexes()));

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const apiPort = (server.address() as { port: number }).port;

  type Json = { success?: boolean; data?: any; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
  const call = async (method: string, urlPath: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/v1${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Json };
  };

  let accountCounter = 0;
  const login = async (role: 'admin' | 'superadmin'): Promise<string> => {
    accountCounter += 1;
    const account = await Account.create({
      email: `${role}${accountCounter}@ingestion-flow.check`,
      passwordHash: 'SecurePass123',
      name: `Test ${role} ${accountCounter}`,
      role,
      permissions: role === 'admin' ? ['poll:manage'] : []
    });
    const { raw, tokenHash } = issueSessionToken();
    await Session.create({ accountId: account._id, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    return `${SESSION_COOKIE_NAME}=${raw}`;
  };

  // What the worker's claim loop does, run in-process until the queue is empty.
  const drainQueue = async (options: { maxDurationMs?: number } = {}): Promise<number> => {
    let executed = 0;
    for (;;) {
      const job = await pollJobService.claimNextPollJob();
      if (!job) return executed;
      await pollJobService.executePollJob(job, options);
      executed += 1;
    }
  };
  const resetQueue = async (): Promise<void> => {
    await Promise.all([PollJob.deleteMany({}), IngestionRun.deleteMany({})]);
  };
  const worksOf = (siteId: unknown) => Work.countDocuments({ siteId });
  const requestsFor = (deptId: string) => rssRequests.filter(r => r.deptId === deptId);

  const superCookie = await login('superadmin');
  const adminA = await login('admin');
  const adminB = await login('admin');
  // The automatic schedule stays paused unless a section turns it on, so the
  // real worker process below never enqueues scheduled jobs of its own.
  await settingsService.updateIngestionSettings({ scheduleEnabled: false }, new mongoose.Types.ObjectId());

  const fast = { requestsPerMinute: 600 }; // 100 ms between a site's requests
  const siteA = await createGovSite({ name: 'หน่วยงาน ก', shortCode: 'SITEA', deptId: '1001', announceTypes: ['B0', 'D0'], dataGoThResourceId: 'res-a', ...fast });
  const siteB = await createGovSite({ name: 'หน่วยงาน ข', shortCode: 'SITEB', deptId: '1002', announceTypes: ['D0'], ...fast });
  const siteOff = await createGovSite({ name: 'หน่วยงาน ปิด', shortCode: 'SITEOFF', deptId: '1003', announceTypes: ['D0'], ...fast });
  await GovSite.updateOne({ _id: siteOff._id }, { $set: { enabled: false } });

  feeds.set('1001', {
    B0: [
      { id: '67010000001', title: 'ร่าง TOR จ้างพัฒนาระบบสารสนเทศ', link: pdfLink('tor-67010000001') },
      { id: '67010000002', title: 'ร่าง TOR ซื้อครุภัณฑ์คอมพิวเตอร์' }
    ],
    D0: [{ id: '67010000003', title: 'ประกวดราคาจ้างก่อสร้างอาคาร' }]
  });
  feeds.set('1002', { D0: [{ id: '67020000001', title: 'ประกวดราคาซื้อรถยนต์' }] });
  feeds.set('1003', { D0: [{ id: '67030000001', title: 'งานของหน่วยงานที่ปิดอยู่' }] });
  datastores.set('res-a', {
    mode: 'ok',
    records: [
      { proj_no: '67010000003', proj_name: 'ประกวดราคาจ้างก่อสร้างอาคาร', proj_mny: 500000, corp_name: 'บริษัท ทดสอบ จำกัด', win_tin: '0105500000001', contrct_num: 'C-1/2570' },
      { proj_no: '67099999999', proj_name: 'โครงการที่ไม่มีใน e-GP feed', proj_mny: 999999, corp_name: 'บริษัท อื่น จำกัด' }
    ]
  });

  // ===================================================================== A. Poll Now: one site, all sites
  section('A. Poll Now for one site and for all sites');
  {
    let r = await call('POST', `/admin/gov-sites/${siteA._id}/poll`, adminA, { source: 'rss' });
    record(r.status === 201 && r.json?.data?.scope === 'site' && r.json?.data?.status === 'queued', 'POST /admin/gov-sites/:id/poll -> 201, a queued job for that one site', `${r.status} ${JSON.stringify(r.json?.data ?? r.json?.error)}`);
    const siteJobId = r.json?.data?._id as string;

    record((await drainQueue()) === 1, 'the worker picks the job up');
    let job = await PollJob.findById(siteJobId);
    record(job?.status === 'done' && job.resultRunIds.length === 1, 'the job finishes "done" with one run (source rss)', `${job?.status} runs=${job?.resultRunIds.length} ${job?.error ?? ''}`);
    record((await worksOf(siteA._id)) === 3, 'every item in both announce-type feeds of that site became a work', String(await worksOf(siteA._id)));
    record((await worksOf(siteB._id)) === 0 && requestsFor('1002').length === 0, 'no other site was polled');
    const run = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' });
    record(run?.status === 'success' && run.fetchedCount === 3 && run.newCount === 3 && run.failedCount === 0, 'its run: success, fetched 3, new 3, failed 0', JSON.stringify({ s: run?.status, f: run?.fetchedCount, n: run?.newCount, x: run?.failedCount }));
    const withPdf = await Work.findOne({ projectId: '67010000001' });
    record(!!withPdf?.torFiles[0]?.storageKey && pdfHits.get('tor-67010000001') === 1, 'the TOR PDF the item links to was downloaded and stored');
    record(dataGoThRequests.length === 0, 'source "rss" only: data.go.th was not asked');

    rssRequests.length = 0;
    r = await call('POST', '/admin/gov-sites/poll-all', adminA);
    record(r.status === 201 && r.json?.data?.scope === 'all' && r.json?.data?.source === 'both', 'POST /admin/gov-sites/poll-all -> 201, a queued all-sites job (RSS + data.go.th)', `${r.status} ${JSON.stringify(r.json?.data ?? r.json?.error)}`);
    await drainQueue();
    job = await PollJob.findById(r.json?.data?._id);
    record(job?.status === 'done', 'the all-sites job finishes "done"', `${job?.status} ${job?.error ?? ''}`);
    record((await worksOf(siteB._id)) === 1, 'site B\'s work was ingested by the all-sites poll');
    const runs = await IngestionRun.find({ _id: { $in: job?.resultRunIds ?? [] } });
    const runKeys = runs.map(x => `${String(x.siteId) === String(siteA._id) ? 'A' : String(x.siteId) === String(siteB._id) ? 'B' : '?'}:${x.source}`).sort();
    record(JSON.stringify(runKeys) === JSON.stringify(['A:data_go_th', 'A:rss', 'B:rss']), 'one run per enabled site and source (data.go.th only where configured)', runKeys.join(' '));
  }

  // ===================================================================== D. disabled sites are skipped
  section('D. disabled sites are skipped');
  {
    record(requestsFor('1003').length === 0 && (await worksOf(siteOff._id)) === 0, 'poll-all never requested the disabled site\'s feed and created none of its works');
    record(!(await IngestionRun.exists({ siteId: siteOff._id })), 'no run was recorded for the disabled site');

    const r = await call('POST', `/admin/gov-sites/${siteOff._id}/poll`, adminA, { source: 'both' });
    record(r.status === 400 && (await PollJob.countDocuments({ siteId: siteOff._id })) === 0, 'Poll Now on the disabled site -> 400, nothing queued', `${r.status} ${r.json?.error?.message}`);

    // Disabled AFTER its job was queued (e.g. switched off while another poll ran).
    await resetQueue();
    const queued = await call('POST', `/admin/gov-sites/${siteB._id}/poll`, adminA, { source: 'rss' });
    const off = await call('PATCH', `/admin/gov-sites/${siteB._id}`, superCookie, { enabled: false });
    rssRequests.length = 0;
    await drainQueue();
    const job = await PollJob.findById(queued.json?.data?._id);
    record(off.status === 200 && job?.status === 'failed' && /disabled/.test(job.error ?? '') && requestsFor('1002').length === 0, 'a site disabled after its job was queued is skipped when the job runs (no request, job says why)', `${job?.status} ${job?.error}`);

    await settingsService.updateIngestionSettings({ scheduleEnabled: true }, new mongoose.Types.ObjectId());
    await GovSite.updateMany({}, { $unset: { nextPollAt: 1 } });
    await resetQueue();
    await enqueueDueSitePolls();
    const scheduled = await PollJob.find({ requestedBy: 'scheduler' });
    const scheduledSites = scheduled.map(j => String(j.siteId));
    record(scheduled.length === 1 && scheduledSites[0] === String(siteA._id), 'the scheduler only enqueues enabled sites', `${scheduled.length} job(s)`);
    await settingsService.updateIngestionSettings({ scheduleEnabled: false }, new mongoose.Types.ObjectId());
    await call('PATCH', `/admin/gov-sites/${siteB._id}`, superCookie, { enabled: true });
    await resetQueue();
  }

  // ===================================================================== E. upsert by project id
  section('E. records are upserted by project id (no duplicates)');
  {
    const before = await Work.countDocuments({});
    const pdfBefore = pdfHits.get('tor-67010000001');
    await pollJobService.enqueueSitePoll(String(siteA._id), 'rss', new mongoose.Types.ObjectId());
    await drainQueue();
    const run = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' }).sort({ startedAt: -1 });
    record((await Work.countDocuments({})) === before, 'polling the same feed again creates no new work', `${before} -> ${await Work.countDocuments({})}`);
    record(run?.newCount === 0 && run.updatedCount === 0 && run.itemResults.every(i => i.status === 'skipped'), 'the re-poll\'s run: new 0, updated 0, every item "skipped"', JSON.stringify({ n: run?.newCount, u: run?.updatedCount }));
    record(pdfHits.get('tor-67010000001') === pdfBefore, 'an unchanged TOR document is not downloaded again');

    // The same project moves on to the next stage (draft TOR -> invitation).
    feeds.get('1001')!.D0.push({ id: '67010000002', title: 'ประกวดราคาซื้อครุภัณฑ์คอมพิวเตอร์' });
    await pollJobService.enqueueSitePoll(String(siteA._id), 'rss', new mongoose.Types.ObjectId());
    await drainQueue();
    const moved = await Work.find({ projectId: '67010000002' });
    record(moved.length === 1 && moved[0].status === 'BIDDING' && moved[0].statusHistory.length === 2, 'a project seen again under a later announce type updates its one work (status + history), no second work', `${moved.length} work(s), ${moved[0]?.status}, history ${moved[0]?.statusHistory.length}`);
    const run2 = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' }).sort({ startedAt: -1 });
    record(run2?.newCount === 0 && run2.updatedCount === 1, 'that run counts it as updated, not new', JSON.stringify({ n: run2?.newCount, u: run2?.updatedCount }));

    const dup = await Work.create({ siteId: siteA._id, projectId: '67010000001', title: 'dup', status: 'DRAFT_TOR', announceType: 'B0' }).then(() => 'inserted', (e: { code?: number }) => String(e.code));
    record(dup === '11000', 'the database itself refuses a second work with the same site + project id (unique index)', dup);
    await resetQueue();
  }

  // ===================================================================== F. data.go.th never creates a work
  section('F. data.go.th never creates a work on its own');
  {
    const before = await Work.countDocuments({});
    await pollJobService.enqueueSitePoll(String(siteA._id), 'data_go_th', new mongoose.Types.ObjectId());
    await drainQueue();
    const run = await IngestionRun.findOne({ siteId: siteA._id, source: 'data_go_th' });
    record(run?.status === 'success' && run.fetchedCount === 2 && run.updatedCount === 1 && run.newCount === 0, 'enrichment run: fetched 2 records, updated 1, new 0', JSON.stringify({ s: run?.status, f: run?.fetchedCount, u: run?.updatedCount, n: run?.newCount }));
    record((await Work.countDocuments({})) === before && !(await Work.exists({ projectId: '67099999999' })), 'a contract record with no matching e-GP work did NOT create one');
    const enriched = await Work.findOne({ projectId: '67010000003' });
    record(enriched?.budget === 500000 && enriched.winnerName === 'บริษัท ทดสอบ จำกัด' && !!enriched.enrichedAt, 'the matching work was enriched (budget, winner)', `${enriched?.budget} ${enriched?.winnerName}`);
    record(enriched?.status === 'BIDDING', 'enrichment never changes a work\'s status (status comes only from e-GP)', enriched?.status);
    await resetQueue();
  }

  // ===================================================================== G. isolation, retry with backoff, timeouts
  section('G. failures are isolated per site / source, retried with backoff');
  {
    // Site B's feed is down for good; site A is fine.
    feedModes.set('1002', { kind: 'fail', status: 500 });
    feeds.get('1001')!.D0.push({ id: '67010000009', title: 'ประกาศใหม่ระหว่างที่อีกหน่วยงานล่ม' });
    rssRequests.length = 0;
    const started = Date.now();
    const job = await pollJobService.enqueueAllSitesPoll(new mongoose.Types.ObjectId());
    await drainQueue();
    const done = await PollJob.findById(job._id);
    const runB = await IngestionRun.findOne({ siteId: siteB._id, source: 'rss' });
    const runA = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' });
    record(done?.status === 'done', 'one site down does not fail the whole poll job', done?.status);
    record(runB?.status === 'failed' && /HTTP 500/.test(runB.errorLog.join(' ')), 'the failing site\'s run is "failed" and logs why', runB?.errorLog.join(' | '));
    record(runA?.status === 'success' && (await Work.exists({ projectId: '67010000009' })) !== null, 'the other site was still polled and its new work stored');
    const bTimes = requestsFor('1002').map(r => r.at);
    record(bTimes.length === 3, 'a failed feed request is retried (1 try + 2 retries)', `${bTimes.length} request(s)`);
    const gaps = bTimes.slice(1).map((t, i) => t - bTimes[i]);
    record(gaps.length === 2 && gaps[0] >= 450 && gaps[1] >= 950, 'with backoff: ~0.5 s, then ~1 s between attempts', gaps.join(' ms, ') + ' ms');
    record(Date.now() - started < 15_000, 'and the whole poll still finished promptly');
    await resetQueue();

    // A flaky feed recovers within the retries.
    feedModes.set('1002', { kind: 'flaky', failuresLeft: 2 });
    rssRequests.length = 0;
    await pollJobService.enqueueSitePoll(String(siteB._id), 'rss', new mongoose.Types.ObjectId());
    await drainQueue();
    const flaky = await IngestionRun.findOne({ siteId: siteB._id, source: 'rss' });
    record(flaky?.status === 'success' && requestsFor('1002').length === 3, 'a feed that fails twice then answers: the run succeeds on the third attempt', `${flaky?.status}, ${requestsFor('1002').length} request(s)`);
    feedModes.delete('1002');
    await resetQueue();

    // One announce type down: the site's other announce types still go through.
    failingTypes.add('1001/B0');
    await pollJobService.enqueueSitePoll(String(siteA._id), 'rss', new mongoose.Types.ObjectId());
    await drainQueue();
    const partial = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' });
    record(partial?.failedCount === 1 && /\[B0\] fetch failed/.test(partial.errorLog.join(' ')) && partial.fetchedCount > 0, 'one announce type failing is logged, and the other announce type was still read', JSON.stringify({ failed: partial?.failedCount, fetched: partial?.fetchedCount }));
    failingTypes.clear();
    await resetQueue();

    // data.go.th down: the RSS part of the same poll is unaffected.
    datastores.set('res-a', { mode: 'fail', records: [] });
    await pollJobService.enqueueSitePoll(String(siteA._id), 'both', new mongoose.Types.ObjectId());
    await drainQueue();
    const rssRun = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' });
    const dgtRun = await IngestionRun.findOne({ siteId: siteA._id, source: 'data_go_th' });
    record(rssRun?.status === 'success' && dgtRun?.status === 'failed' && /datastore_search failed/.test(dgtRun.errorLog.join(' ')), 'data.go.th failing leaves the RSS run of the same poll successful', `${rssRun?.status} / ${dgtRun?.status}`);
    record(dataGoThRequests.filter(r => r.resourceId === 'res-a').length >= 3, 'data.go.th requests are retried too');
    datastores.set('res-a', { mode: 'ok', records: [] });
    await resetQueue();

    // A site that accepts the connection and never answers.
    feedModes.set('1002', { kind: 'hang' });
    const hangStarted = Date.now();
    await pollJobService.enqueueAllSitesPoll(new mongoose.Types.ObjectId());
    await drainQueue();
    const hung = await IngestionRun.findOne({ siteId: siteB._id, source: 'rss' });
    const okRun = await IngestionRun.findOne({ siteId: siteA._id, source: 'rss' });
    record(hung?.status === 'failed' && /abort|timeout/i.test(hung.errorLog.join(' ')), 'a site that never answers times out per request and its run fails', hung?.errorLog.join(' | '));
    record(okRun?.status === 'success' && Date.now() - hangStarted < 20_000, 'it doesn\'t block the other sites (they are polled, the job ends)', `${okRun?.status} in ${Date.now() - hangStarted} ms`);
    feedModes.delete('1002');
    await resetQueue();
  }

  // ===================================================================== H. too long -> failed
  section('H. a poll that runs too long is logged as failed');
  {
    const slowSite = await createGovSite({ name: 'หน่วยงานช้า', shortCode: 'SLOW', deptId: '1009', announceTypes: ['B0', 'D0', 'W0'], ...fast });
    feeds.set('1009', { B0: [{ id: '67090000001', title: 'งานจากหน่วยงานช้า' }], D0: [], W0: [] });
    feedModes.set('1009', { kind: 'slow', delayMs: 800 });

    const job = await pollJobService.enqueueSitePoll(String(slowSite._id), 'rss', new mongoose.Types.ObjectId());
    const started = Date.now();
    await drainQueue({ maxDurationMs: 1000 });
    const elapsed = Date.now() - started;
    const ended = await PollJob.findById(job._id);
    const run = await IngestionRun.findOne({ siteId: slowSite._id });
    record(ended?.status === 'failed' && /Timed out/.test(ended.error ?? ''), 'the job is stopped at its time limit and recorded as failed ("Timed out")', `${ended?.status}: ${ended?.error}`);
    record(run?.status === 'failed' && run.errorLog.includes(RUN_TIMED_OUT_MESSAGE) && !!run.finishedAt, 'its run is closed as failed with the time-out in its log', run?.errorLog.join(' | '));
    record(elapsed < 2500, 'it stops promptly, without waiting for the remaining requests', `${elapsed} ms`);
    record((await Work.countDocuments({ projectId: '67090000001' })) === 1, 'what it stored before the limit is kept');
    record(!ended?.manualLock && (await pollJobService.getPollStatus()).isPolling === false, 'and Poll Now is unlocked again');

    // Backstop: a worker that keeps heart-beating but never ends its job.
    await resetQueue();
    const longAgo = new Date(Date.now() - pollJobService.pollJobMaxDurationMs() - pollJobService.POLL_JOB_TIMEOUT_GRACE_MS - 60_000);
    const wedged = await PollJob.create({ scope: 'site', siteId: slowSite._id, source: 'rss', requestedBy: new mongoose.Types.ObjectId(), status: 'running', claimedAt: longAgo, heartbeatAt: new Date() });
    await IngestionRun.create({ siteId: slowSite._id, source: 'rss', triggeredBy: 'scheduler', status: 'running', startedAt: new Date(longAgo.getTime() + 1000) });
    record((await pollJobService.getPollStatus()).isPolling === false, 'a job far past the time limit no longer locks Poll Now, even with a live heartbeat');
    await pollJobService.reapStalePollJobs();
    const reaped = await PollJob.findById(wedged._id);
    const reapedRun = await IngestionRun.findOne({ siteId: slowSite._id, source: 'rss' });
    record(reaped?.status === 'failed' && /Timed out/.test(reaped.error ?? '') && reapedRun?.status === 'failed', 'the worker\'s housekeeping closes it (and its run) as timed out', `${reaped?.status}: ${reaped?.error} / run ${reapedRun?.status}`);
    feedModes.delete('1009');
    await GovSite.updateOne({ _id: slowSite._id }, { $set: { enabled: false } });
    await resetQueue();
  }

  // ===================================================================== B. the shared lock, concurrency, worker crash
  section('B. Poll Now lock: every admin, page refresh, simultaneous clicks, worker crash');
  {
    let r = await call('POST', '/admin/gov-sites/poll-all', adminA);
    record(r.status === 201, 'admin A starts a poll');
    let statusB = await call('GET', '/admin/ingestion/status', adminB);
    record(statusB.json?.data?.isPolling === true && statusB.json?.data?.activeJobs?.[0]?.status === 'queued', 'admin B (another account) sees it as in progress (queued)', JSON.stringify(statusB.json?.data));
    const refreshed = await call('GET', '/admin/ingestion/status', adminA);
    record(refreshed.json?.data?.isPolling === true, 'admin A reloading the page (a fresh status request) still sees it locked');
    r = await call('POST', '/admin/gov-sites/poll-all', adminB);
    const rSite = await call('POST', `/admin/gov-sites/${siteA._id}/poll`, adminB, { source: 'both' });
    record(r.status === 409 && r.json?.error?.code === 'CONFLICT' && rSite.status === 409, 'admin B\'s Poll Now (all sites, or one site) -> 409 while it is queued', `${r.status} / ${rSite.status}`);

    const claimed = await pollJobService.claimNextPollJob();
    statusB = await call('GET', '/admin/ingestion/status', adminB);
    r = await call('POST', '/admin/gov-sites/poll-all', adminB);
    record(statusB.json?.data?.activeJobs?.[0]?.status === 'running' && r.status === 409, 'still locked for everyone while it is running', `${statusB.json?.data?.activeJobs?.[0]?.status} / ${r.status}`);
    await pollJobService.executePollJob(claimed!);
    statusB = await call('GET', '/admin/ingestion/status', adminB);
    record(statusB.json?.data?.isPolling === false, 'unlocked for everyone once it finishes');
    await resetQueue();

    // Simultaneous clicks from many admins: exactly one poll gets in.
    const admins = await Promise.all(Array.from({ length: 12 }, () => login('admin')));
    const answers = await Promise.all(admins.map((cookie, i) => (i % 3 === 0 ? call('POST', `/admin/gov-sites/${siteA._id}/poll`, cookie, { source: 'rss' }) : call('POST', '/admin/gov-sites/poll-all', cookie))));
    const accepted = answers.filter(a => a.status === 201).length;
    const refused = answers.filter(a => a.status === 409).length;
    record(accepted === 1 && refused === 11, '12 admins clicking Poll Now at the same moment: exactly one 201, eleven 409', `${accepted} accepted, ${refused} refused, others: ${answers.filter(a => a.status !== 201 && a.status !== 409).map(a => a.status).join(',')}`);
    record((await PollJob.countDocuments({})) === 1, 'and exactly one job exists', String(await PollJob.countDocuments({})));
    await drainQueue();
    await resetQueue();

    // The same burst at the service in lockstep, on a warm connection pool (a busy
    // server): every request passes the "anything running?" read before any insert
    // lands. Before the unique manual lock this created one job PER click.
    await Promise.all(Array.from({ length: 30 }, () => GovSite.countDocuments({})));
    const burst = await Promise.allSettled(Array.from({ length: 12 }, () => pollJobService.enqueueAllSitesPoll(new mongoose.Types.ObjectId())));
    const burstOk = burst.filter(b => b.status === 'fulfilled').length;
    const burst409 = burst.filter(b => b.status === 'rejected' && (b.reason as { status?: number }).status === 409).length;
    record(burstOk === 1 && burst409 === 11 && (await PollJob.countDocuments({})) === 1, '12 simultaneous enqueues in lockstep: one job, eleven 409 (the unique lock, not just the read)', `${burstOk} ok, ${burst409} conflict, ${await PollJob.countDocuments({})} job(s)`);
    await drainQueue();
    await resetQueue();

    // A REAL worker process: it completes one poll, then is killed in the middle of the next.
    const backendRoot = path.resolve(__dirname, '..', '..');
    const workerLog: string[] = [];
    const worker: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
      cwd: backendRoot,
      env: { ...process.env, POLL_JOB_CLAIM_INTERVAL_MS: '200', INGESTION_REQUEST_TIMEOUT_MS: '60000', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    worker.stdout?.on('data', d => workerLog.push(String(d)));
    worker.stderr?.on('data', d => workerLog.push(String(d)));
    const workerExited = new Promise<void>(resolve => worker.once('exit', () => resolve()));

    feeds.get('1002')!.D0.push({ id: '67020000002', title: 'งานที่ worker จริงดึงมา' });
    r = await call('POST', `/admin/gov-sites/${siteB._id}/poll`, adminA, { source: 'rss' });
    const finished = await waitFor(async () => {
      const job = await PollJob.findById(r.json?.data?._id);
      return job && (job.status === 'done' || job.status === 'failed') ? job : null;
    }, 45_000);
    record(finished?.status === 'done' && (await Work.exists({ projectId: '67020000002' })) !== null, 'the separate worker process executes a queued Poll Now job (done, work stored)', `${finished?.status ?? 'not finished'} ${finished?.error ?? ''}`);

    feedModes.set('1002', { kind: 'hang' });
    r = await call('POST', `/admin/gov-sites/${siteB._id}/poll`, adminA, { source: 'rss' });
    const crashJobId = r.json?.data?._id as string;
    const running = await waitFor(async () => {
      const job = await PollJob.findById(crashJobId);
      const run = await IngestionRun.findOne({ siteId: siteB._id, status: 'running' });
      return job?.status === 'running' && run ? job : null;
    }, 30_000);
    record(!!running, 'the worker claimed the next job and is mid-poll (feed request in flight)');
    worker.kill('SIGKILL');
    await workerExited;

    statusB = await call('GET', '/admin/ingestion/status', adminB);
    record(statusB.json?.data?.isPolling === true, 'right after the crash the job still looks in progress (its last heartbeat is recent)');

    // Time passes with no heartbeat from the dead worker (2 min threshold).
    await PollJob.updateOne({ _id: crashJobId }, { $set: { heartbeatAt: new Date(Date.now() - pollJobService.POLL_JOB_STALE_MS - 30_000) } });
    statusB = await call('GET', '/admin/ingestion/status', adminB);
    record(statusB.json?.data?.isPolling === false, 'once its heartbeat is stale the lock is released for every admin');
    const closed = await pollJobService.reapStalePollJobs();
    const crashed = await PollJob.findById(crashJobId);
    const orphanRun = await IngestionRun.findOne({ siteId: siteB._id }).sort({ startedAt: -1 });
    record(closed >= 1 && crashed?.status === 'failed' && /stopped responding/.test(crashed.error ?? ''), 'the crashed job is closed as failed and says why', `${crashed?.status}: ${crashed?.error}`);
    record(orphanRun?.status === 'failed' && /Abandoned/.test(orphanRun.errorLog.join(' ')), 'the run it left "running" is closed too, so the site can be polled again', orphanRun?.status);

    feedModes.delete('1002');
    r = await call('POST', `/admin/gov-sites/${siteB._id}/poll`, adminB, { source: 'rss' });
    record(r.status === 201, 'a new Poll Now is accepted after the crash', String(r.status));
    await drainQueue();
    const after = await PollJob.findById(r.json?.data?._id);
    record(after?.status === 'done', 'and it runs normally', `${after?.status} ${after?.error ?? ''}`);
    for (const res of hangingResponses) res.destroy();
    if (!finished || !running) console.log('--- worker output ---\n' + workerLog.join(''));
    await resetQueue();
  }

  // ===================================================================== C. the schedule rules
  section('C. schedule: 24 h by default, 2 h minimum enforced server-side');
  {
    await IngestionSettings.deleteMany({});
    let r = await call('GET', '/admin/ingestion/settings', adminA);
    record(r.status === 200 && r.json?.data?.pollIntervalMinutes === 1440 && r.json?.data?.defaultIntervalMinutes === 1440, 'a fresh install polls every 24 hours', JSON.stringify(r.json?.data));
    record(r.json?.data?.minIntervalMinutes === 120, 'the API reports the 2-hour minimum');

    for (const bad of [119, 60, 1, 0, -120]) {
      r = await call('PATCH', '/admin/ingestion/settings', adminA, { pollIntervalMinutes: bad });
      if (r.status !== 400) record(false, `PATCH ${bad} min should be refused`, String(r.status));
    }
    record((await settingsService.getIngestionSettings()).pollIntervalMinutes === 1440, 'PATCH below 2 h (119, 60, 1, 0, negative) -> 400 and the stored interval is unchanged');
    r = await call('PATCH', '/admin/ingestion/settings', adminA, { pollIntervalMinutes: 120 });
    record(r.status === 200 && r.json?.data?.pollIntervalMinutes === 120, 'exactly 2 hours is accepted');
    const modelLevel = await settingsService.updateIngestionSettings({ pollIntervalMinutes: 30 }, new mongoose.Types.ObjectId()).then(() => 'saved', (e: Error) => e.name);
    record(modelLevel === 'ValidationError', 'the model refuses 30 min too, even when the request validator is bypassed', modelLevel);
    r = await call('PATCH', `/admin/gov-sites/${siteA._id}`, superCookie, { pollIntervalMinutes: 30 });
    record(r.status === 400, 'a per-site override below 2 h -> 400', String(r.status));

    await settingsService.updateIngestionSettings({ pollIntervalMinutes: 1440, scheduleEnabled: true }, new mongoose.Types.ObjectId());
    await GovSite.updateMany({}, { $unset: { nextPollAt: 1, pollIntervalMinutes: 1 } });
    const t0 = Date.now();
    await enqueueDueSitePolls();
    const a = await GovSite.findById(siteA._id);
    const minutesOut = ((a?.nextPollAt?.getTime() ?? 0) - t0) / 60_000;
    record(Math.abs(minutesOut - 1440) < 1, 'the scheduler sets the next run 24 h out', `${minutesOut.toFixed(1)} min`);
    await GovSite.updateOne({ _id: siteA._id }, { $set: { pollIntervalMinutes: 5 }, $unset: { nextPollAt: 1 } }); // a legacy value written around validation
    await PollJob.deleteMany({});
    await enqueueDueSitePolls();
    const legacy = await GovSite.findById(siteA._id);
    const legacyOut = ((legacy?.nextPollAt?.getTime() ?? 0) - Date.now()) / 60_000;
    record(Math.abs(legacyOut - 120) < 1, 'a stored 5-minute override is still scheduled no faster than every 2 h', `${legacyOut.toFixed(1)} min`);
    await GovSite.updateOne({ _id: siteA._id }, { $unset: { pollIntervalMinutes: 1 } });
    await settingsService.updateIngestionSettings({ scheduleEnabled: false }, new mongoose.Types.ObjectId());
    await resetQueue();
  }

  // ===================================================================== I. run history
  section('I. run history shows the counts per site and source');
  {
    datastores.set('res-a', {
      mode: 'ok',
      records: [{ proj_no: '67010000001', proj_mny: 120000 }, { proj_no: '67000000000', proj_mny: 1 }]
    });
    feeds.get('1002')!.D0.push({ id: '67020000003', title: 'งานใหม่สำหรับประวัติการดึง' });
    await pollJobService.enqueueAllSitesPoll(new mongoose.Types.ObjectId());
    await drainQueue();

    let r = await call('GET', '/admin/ingestion/runs?pageSize=50', adminA);
    const items = (r.json?.data?.items ?? []) as Array<{ siteId?: { name?: string; shortCode?: string }; source: string; fetchedCount: number; newCount: number; updatedCount: number; failedCount: number; status: string; _id: string }>;
    record(r.status === 200 && items.length === 3, 'GET /admin/ingestion/runs lists one run per site and source of the poll', `${r.status}, ${items.length} run(s)`);
    record(items.every(i => !!i.siteId?.name && !!i.siteId?.shortCode && (i.source === 'rss' || i.source === 'data_go_th')), 'each run names its site and its source');
    record(items.every(i => ['fetchedCount', 'newCount', 'updatedCount', 'failedCount'].every(k => typeof (i as unknown as Record<string, unknown>)[k] === 'number')), 'each run carries fetched / new / updated / failed counts');
    const bRss = items.find(i => i.siteId?.shortCode === 'SITEB' && i.source === 'rss');
    const aDgt = items.find(i => i.siteId?.shortCode === 'SITEA' && i.source === 'data_go_th');
    record(bRss?.newCount === 1 && bRss.fetchedCount === 3, 'site B / rss: the counts match what the feed held (3 fetched, 1 new)', JSON.stringify(bRss));
    record(aDgt?.fetchedCount === 2 && aDgt.updatedCount === 1 && aDgt.newCount === 0, 'site A / data.go.th: 2 fetched, 1 updated, 0 new', JSON.stringify(aDgt));

    r = await call('GET', `/admin/ingestion/runs?siteId=${siteA._id}&source=rss`, adminA);
    const filtered = (r.json?.data?.items ?? []) as typeof items;
    record(filtered.length === 1 && filtered[0].siteId?.shortCode === 'SITEA' && filtered[0].source === 'rss', 'filtering by site and source narrows to that run', `${filtered.length}`);
    r = await call('GET', `/admin/ingestion/runs/${bRss?._id}`, adminA);
    const detail = r.json?.data as { itemResults?: Array<{ projectId?: string; status: string }> } | undefined;
    record((detail?.itemResults ?? []).some(i => i.projectId === '67020000003' && i.status === 'new'), 'the run detail lists each item with its outcome', JSON.stringify(detail?.itemResults?.map(i => `${i.projectId}:${i.status}`)));
  }

  // ===================================================================== report
  server.close();
  for (const res of hangingResponses) res.destroy();
  mock.closeAllConnections();
  mock.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  const passes = results.filter(line => line.startsWith('PASS')).length;
  console.log(`\n${passes} passed, ${failures} failed`);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await fs.rm(torDir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  console.log(results.join('\n'));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
