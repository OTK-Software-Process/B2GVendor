import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account, AccountRole } from '../../src/models/account.model';
import { GovSite } from '../../src/models/govSite.model';
import { IngestionRun } from '../../src/models/ingestionRun.model';
import { PollJob } from '../../src/models/pollJob.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-dashboard-check';

const PASSWORD = 'Password123';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function call(method: string, path: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
  }

  // The Account model bcrypt-hashes passwordHash on save, so pass the plain value.
  async function makeAccount(email: string, role: AccountRole, status: 'active' | 'suspended' = 'active') {
    return Account.create({ email, passwordHash: PASSWORD, name: `Name of ${email}`, type: 'individual', status, role });
  }
  async function loginCookie(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    const first = res.setCookie?.split(';')[0] ?? '';
    if (!first.startsWith(`${SESSION_COOKIE_NAME}=`)) throw new Error(`login failed for ${email}: ${res.status}`);
    return first;
  }

  await makeAccount('vendor-a@example.com', 'user');
  await makeAccount('admin-a@example.com', 'admin');
  await makeAccount('super-a@example.com', 'superadmin');
  const vendorCookie = await loginCookie('vendor-a@example.com');
  const adminCookie = await loginCookie('admin-a@example.com');
  const superCookie = await loginCookie('super-a@example.com');

  // --- Access control ---
  const anon = await call('GET', '/admin/dashboard');
  record(anon.status === 401 && anon.json?.error?.code === 'NOT_AUTHENTICATED', 'visitor gets 401', String(anon.status));
  const asVendor = await call('GET', '/admin/dashboard', vendorCookie);
  record(asVendor.status === 403 && asVendor.json?.error?.code === 'FORBIDDEN', 'vendor gets 403', String(asVendor.status));
  const asAdmin = await call('GET', '/admin/dashboard', adminCookie);
  record(asAdmin.status === 200 && asAdmin.json?.success === true, 'admin gets 200', String(asAdmin.status));
  const asSuper = await call('GET', '/admin/dashboard', superCookie);
  record(asSuper.status === 200, 'super admin gets 200', String(asSuper.status));
  const postAttempt = await call('POST', '/admin/dashboard', adminCookie, {});
  record(postAttempt.status === 404, 'dashboard is read-only (POST is not routed)', String(postAttempt.status));

  // --- Empty system: no sites, tags, runs, jobs ---
  const empty = asAdmin.json.data;
  record(empty.sites.total === 0 && empty.sites.enabled === 0, 'empty: 0 sites');
  record(empty.tags.active === 0 && empty.tags.retired === 0, 'empty: 0 tags');
  record(empty.ingestion.lastRun === null, 'empty: lastRun is null (no runs yet)');
  record(empty.ingestion.nextScheduledAt === null, 'empty: nextScheduledAt is null');
  record(empty.ingestion.sites.length === 0, 'empty: no per-site rows');
  record(empty.works.total === 0, 'empty: 0 works');
  record(empty.accounts.vendors.total === 1 && empty.accounts.admins.total === 2, 'empty: counts the seeded accounts', JSON.stringify(empty.accounts));

  // --- Seed realistic data ---
  await makeAccount('vendor-b@example.com', 'user');
  await makeAccount('vendor-c@example.com', 'user', 'suspended');
  await makeAccount('admin-b@example.com', 'admin', 'suspended');

  await Tag.create([
    { name: 'T site', facet: 'site' },
    { name: 'T cat 1', facet: 'category' },
    { name: 'T cat 2', facet: 'category' },
    { name: 'T kw', facet: 'keyword' },
    { name: 'T old', facet: 'keyword', retired: true }
  ]);

  const now = Date.now();
  const soon = new Date(now + 10 * 60 * 1000);
  const later = new Date(now + 60 * 60 * 1000);
  const earlier = new Date(now + 60 * 1000);
  const siteA = await GovSite.create({ name: 'Site A', shortCode: 'AAA', deptId: '1', enabled: true, nextPollAt: later });
  const siteB = await GovSite.create({ name: 'Site B', shortCode: 'BBB', deptId: '2', enabled: true, nextPollAt: soon });
  // Disabled site with the EARLIEST nextPollAt -- must not be reported as "next run".
  const siteC = await GovSite.create({ name: 'Site C', shortCode: 'CCC', deptId: '3', enabled: false, nextPollAt: earlier });

  // Two works the public site lists (one explicitly 'shown', one never evaluated) and one the
  // topic filter hid ('not-related') -- the search page would say 2, never 3.
  const mkWork = (projectId: string, over: Record<string, unknown> = {}) => ({
    siteId: siteA._id,
    projectId,
    title: `work ${projectId}`,
    status: 'BIDDING',
    announceType: 'D0',
    statusHistory: [{ status: 'BIDDING', announceType: 'D0', changedAt: new Date() }],
    ...over
  });
  await Work.insertMany([mkWork('W1', { ingestionRelevance: 'shown' }), mkWork('W2'), mkWork('W3', { ingestionRelevance: 'not-related' })]);

  const mkRun = (siteId: unknown, minutesAgo: number, status: string, extra: Record<string, unknown> = {}) => ({
    siteId,
    source: 'rss',
    triggeredBy: 'scheduler',
    status,
    startedAt: new Date(now - minutesAgo * 60 * 1000),
    ...extra
  });
  await IngestionRun.create([
    mkRun(siteA._id, 300, 'success', { fetchedCount: 5 }), // older run of site A
    mkRun(siteA._id, 30, 'partial', { fetchedCount: 40, newCount: 4, updatedCount: 6, failedCount: 2 }), // latest of A
    mkRun(siteB._id, 10, 'failed', { failedCount: 1 }), // overall latest, failed within 24h
    mkRun(siteB._id, 60 * 48, 'failed'), // failed but 48h ago -> not in the 24h count
    mkRun(siteC._id, 20, 'running')
  ]);
  await PollJob.create([
    { scope: 'all', source: 'both', requestedBy: 'scheduler', status: 'queued' },
    { scope: 'all', source: 'both', requestedBy: 'scheduler', status: 'done' }
  ]);

  const full = await call('GET', '/admin/dashboard', superCookie);
  const d = full.json.data;

  record(
    d.accounts.vendors.total === 3 && d.accounts.vendors.active === 2 && d.accounts.vendors.suspended === 1,
    'vendors: 3 total / 2 active / 1 suspended',
    JSON.stringify(d.accounts.vendors)
  );
  record(
    d.accounts.admins.total === 3 && d.accounts.admins.admin === 2 && d.accounts.admins.superadmin === 1 && d.accounts.admins.suspended === 1,
    'admins: 2 admin + 1 superadmin, 1 suspended',
    JSON.stringify(d.accounts.admins)
  );
  record(d.tags.active === 4 && d.tags.retired === 1, 'tags: 4 active, 1 retired (retired excluded from active)', JSON.stringify(d.tags));
  record(
    d.tags.byFacet.category === 2 && d.tags.byFacet.keyword === 1 && d.tags.byFacet.site === 1 && d.tags.byFacet.agency === 0,
    'tags: per-facet breakdown ignores retired and includes empty facets',
    JSON.stringify(d.tags.byFacet)
  );
  record(d.sites.total === 3 && d.sites.enabled === 2, 'sites: 3 total / 2 enabled', JSON.stringify(d.sites));
  record(
    d.works.visible === 2 && d.works.hidden === 1 && d.works.total === 3,
    'works: visible matches what the public search lists, hidden (not-related) is counted apart, total = both',
    JSON.stringify(d.works)
  );
  record(d.ingestion.lastRun?.site?.shortCode === 'BBB' && d.ingestion.lastRun?.status === 'failed', 'lastRun is the most recent run (Site B, failed)', JSON.stringify(d.ingestion.lastRun));
  record(d.ingestion.failedRuns24h === 1, 'failedRuns24h counts only runs from the last 24h', String(d.ingestion.failedRuns24h));
  record(d.ingestion.runningNow === 1, 'runningNow counts running runs', String(d.ingestion.runningNow));
  record(d.ingestion.queuedJobs === 1, 'queuedJobs counts only queued poll jobs', String(d.ingestion.queuedJobs));
  record(
    d.ingestion.nextScheduledAt === soon.toISOString(),
    'nextScheduledAt is the earliest nextPollAt of ENABLED sites only',
    `${d.ingestion.nextScheduledAt} vs ${soon.toISOString()}`
  );

  const rowA = d.ingestion.sites.find((s: any) => s.shortCode === 'AAA');
  record(
    rowA?.lastRun?.status === 'partial' && rowA.lastRun.newCount === 4 && rowA.lastRun.failedCount === 2,
    'per-site row uses that site\'s latest run (not an older one)',
    JSON.stringify(rowA?.lastRun)
  );
  const rowC = d.ingestion.sites.find((s: any) => s.shortCode === 'CCC');
  record(rowC?.enabled === false && rowC?.lastRun?.status === 'running', 'per-site row reports disabled sites too', JSON.stringify(rowC));
  record(d.ingestion.sites.length === 3, 'one row per site', String(d.ingestion.sites.length));

  // --- Privacy: aggregates only, no personal data or secrets ---
  const leaks = ['@example.com', 'passwordHash', 'Name of', PASSWORD].filter(s => full.text.includes(s));
  record(leaks.length === 0, 'response contains no emails, names or password data', leaks.join(', '));

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
