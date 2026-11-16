// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import http from 'http';
import mongoose from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { MOF_PAYMENT_UNIT_DATASET } from '../../src/integrations/govAgencyDirectory.client';
import { Account, AccountRole } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { AnnounceType, GovSite } from '../../src/models/govSite.model';
import { IngestionRun } from '../../src/models/ingestionRun.model';
import { PollJob } from '../../src/models/pollJob.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { resetDeptIdDirectoryCache } from '../../src/services/deptIdSuggestion.service';
import { createGovSite } from '../../src/services/govSite.service';
import { claimNextPollJob, executePollJob } from '../../src/services/pollJob.service';
import { enqueueDueSitePolls } from '../../src/services/scheduler.service';
import { createSession } from '../../src/services/session.service';

// Manage Source Configuration (Use Case 6.2.8; SRS US-2.4, US-2.5, FR-2.8, FR-2.11,
// FR-2.3). The Super Admin adds, edits, enables and disables government sites; what
// is refused before it is saved; the live deptId check and the deptId suggestions;
// the server-side Super Admin gate; and that every change reaches the very next
// poll. Polls run for real against a local mock of the e-GP feed (and of data.go.th),
// so the ingestion code itself decides what is fetched. Uses its own throwaway
// database (dropped at the start and end) -- never the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-source-config-check';

// Nothing real may be called: no mail, no AI provider, no HTML pages.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;
(env as { AI_TAGGING_ENABLED: boolean }).AI_TAGGING_ENABLED = false;
(env as { EGP_HTML_TOR_ENABLED: boolean }).EGP_HTML_TOR_ENABLED = false;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ------------------------------------------------------------- the e-GP feed (a mock)
interface FeedItem { id: string; title: string; at: string }
const feeds: Record<string, Partial<Record<AnnounceType, FeedItem[]>>> = {};
const hits: { dept: string; type: string; at: number }[] = [];
const feedFails = new Set<string>(); // "dept:type" answers HTTP 500
const feedHangs = new Set<string>(); // "dept:type" never answers
let origin = '';

// The real feed is Windows-874; encode Thai the same way so the client's decoding is exercised.
function win874(text: string): Buffer {
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

// ------------------------------------------------------ data.go.th (a mock, the MoF department list)
let ckanDown = false;
const ckanRequests: string[] = [];
const DATA_CSV = 'aaaaaaaa-0000-0000-0000-000000000001';
const departments: [number, string, string][] = [
  [21002, 'สำนักงานปลัดกระทรวงสาธารณสุข', 'กระทรวงสาธารณสุข'],
  [8006, 'กรมทางหลวง', 'กระทรวงคมนาคม'],
  [3004, 'กรมบัญชีกลาง', 'กระทรวงการคลัง'],
  [1002, 'กรมประชาสัมพันธ์', 'สำนักนายกรัฐมนตรี']
];

const mock = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
    const dept = url.searchParams.get('deptId') ?? '';
    const type = url.searchParams.get('anounceType') ?? '';
    hits.push({ dept, type, at: Date.now() });
    if (feedHangs.has(`${dept}:${type}`)) return; // never answers
    if (feedFails.has(`${dept}:${type}`)) {
      res.writeHead(500);
      return void res.end('boom');
    }
    const items = (feeds[dept]?.[type as AnnounceType] ?? [])
      .map(i => `<item><title>${i.title}</title><link>${origin}/doc/${i.id}/${type}</link><description>${i.id}, ${i.title}</description><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`)
      .join('');
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return void res.end(Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-874"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>'), win874(items), Buffer.from('</channel></rss>')]));
  }
  if (url.pathname.startsWith('/api/3/action/')) {
    const action = url.pathname.split('/').pop() ?? '';
    ckanRequests.push(action);
    const send = (result: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: status === 200, result }));
    };
    if (ckanDown) return send({ message: 'boom' }, 500);
    if (action === 'package_show') {
      if (url.searchParams.get('id') !== MOF_PAYMENT_UNIT_DATASET) return send({ message: 'not found' }, 404);
      return send({ id: 'pkg', name: MOF_PAYMENT_UNIT_DATASET, title: 'x', resources: [{ id: DATA_CSV, name: 'ข้อมูลหน่วยเบิกจ่าย', format: 'CSV', datastore_active: true }] });
    }
    if (action === 'datastore_search') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const records = departments.slice(offset).map(([code, name, ministry]) => ({ 'รหัสกรม': code, 'กรม': name, 'กระทรวง': ministry }));
      return send({ total: departments.length, fields: ['รหัสกรม', 'กรม', 'กระทรวง'].map(id => ({ id, type: 'text' })), records });
    }
    return send({ message: 'unknown action' }, 404);
  }
  res.writeHead(404);
  res.end();
});

interface Res { status: number; json: any; text: string }

async function main(): Promise<void> {
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  (env as { EGP_RSS_BASE_URL: string }).EGP_RSS_BASE_URL = `${origin}/EPROCRssFeedWeb/egpannouncerss.xml`;
  (env as { DATA_GO_TH_BASE_URL: string }).DATA_GO_TH_BASE_URL = origin;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite.init(), Tag.init(), Work.init(), Account.init(), PollJob.init(), AuditLog.init()]);

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, opts: { cookie?: string; body?: unknown; raw?: string } = {}): Promise<Res> {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  const code = (r: Res) => r.json?.error?.code;
  const fields = (r: Res): Record<string, string> => r.json?.error?.fields ?? {};
  // a message for the field itself, or for one of its items ("announceTypes.0")
  const names = (r: Res, field: string) => Object.keys(fields(r)).some(key => key === field || key.startsWith(`${field}.`));

  // ---------------------------------------------------------------- the people
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const cookieFor = async (a: { _id: unknown }) => `${SESSION_COOKIE_NAME}=${(await createSession(a._id as never, {})).rawToken}`;
  const superAdmin = await mk('super@example.com', 'superadmin');
  const superC = await cookieFor(superAdmin);
  const roles: [string, string | undefined][] = [
    ['visitor (signed out)', undefined],
    ['vendor', await cookieFor(await mk('vendor@example.com', 'user'))],
    ['Admin with no area', await cookieFor(await mk('admin0@example.com', 'admin', { permissions: [] }))],
    ['Poll Admin', await cookieFor(await mk('poll@example.com', 'admin', { permissions: ['poll:manage'] }))],
    ['Tag Admin', await cookieFor(await mk('tag@example.com', 'admin', { permissions: ['tag:manage'] }))],
    ['Poll and Tag Admin', await cookieFor(await mk('both@example.com', 'admin', { permissions: ['poll&tag:manage'] }))]
  ];
  const pollAdminC = roles[3][1];

  const snapshot = async () => JSON.stringify([await GovSite.find({}).sort({ _id: 1 }).lean(), await Tag.find({ facet: 'site' }).sort({ _id: 1 }).lean()]);
  const wipe = async () => {
    await Promise.all([GovSite.deleteMany({}), Tag.deleteMany({}), Work.deleteMany({}), PollJob.deleteMany({}), IngestionRun.deleteMany({})]);
    hits.length = 0;
    Object.keys(feeds).forEach(k => delete feeds[k]);
  };
  // Run every queued poll job the way the ingestion worker does.
  const drain = async (): Promise<{ done: number; failed: string[] }> => {
    let done = 0;
    const failed: string[] = [];
    for (;;) {
      const job = await claimNextPollJob();
      if (!job) break;
      await executePollJob(job);
      const after = await PollJob.findById(job._id).lean();
      if (after?.status === 'done') done += 1;
      else failed.push(after?.error ?? 'failed');
    }
    return { done, failed };
  };
  const hitsOf = (dept: string) => hits.filter(h => h.dept === dept).map(h => h.type).sort();

  // =================================================== 1. the Super Admin gate (US-2.4/2.5, FR-2.8, "blocked server-side, not just hidden")
  const seed = await createGovSite({ name: 'ไซต์ตั้งต้น', nameEn: 'Seed Site', shortCode: 'SEED', deptId: '9001' });
  const sid = String(seed._id);
  const writes: [string, string, string, unknown][] = [
    ['add a site', 'POST', '/admin/gov-sites', { name: 'ไซต์ใหม่', shortCode: 'GATEA', deptId: '9101' }],
    ['edit a site', 'PATCH', `/admin/gov-sites/${sid}`, { name: 'ชื่อใหม่' }],
    ['disable a site', 'PATCH', `/admin/gov-sites/${sid}`, { enabled: false }],
    ['enable a site', 'PATCH', `/admin/gov-sites/${sid}`, { enabled: true }],
    ['repoint a site\'s deptId', 'PATCH', `/admin/gov-sites/${sid}`, { deptId: '9102' }],
    ['change which announcements are polled', 'PATCH', `/admin/gov-sites/${sid}`, { announceTypes: ['P0', 'W0'] }],
    ['change the request rate', 'PATCH', `/admin/gov-sites/${sid}`, { requestsPerMinute: 5 }],
    ['verify a deptId live', 'POST', '/admin/gov-sites/verify-dept-id', { deptId: '9001' }],
    ['ask for deptId suggestions', 'GET', '/admin/gov-sites/dept-id-suggestions?q=2102', undefined]
  ];
  const sitesBefore = await snapshot();
  const hitsBefore = hits.length;
  const ckanBefore = ckanRequests.length;
  const gateBad: string[] = [];
  let gateCount = 0;
  for (const [roleName, cookie] of roles) {
    for (const [what, method, p, body] of writes) {
      gateCount += 1;
      const r = await call(method, p, { cookie, body });
      const expected = cookie === undefined ? [401, 'NOT_AUTHENTICATED'] : [403, 'FORBIDDEN'];
      if (r.status !== expected[0] || code(r) !== expected[1]) gateBad.push(`${roleName}: ${what} -> ${r.status} ${code(r)}`);
    }
  }
  record(gateBad.length === 0, `gate: ${gateCount} attempts (every source-configuration write and both Super Admin helpers x visitor, vendor and four kinds of Admin) are 401 for a visitor and 403 for everyone else`, gateBad.slice(0, 3).join(' | '));
  record((await snapshot()) === sitesBefore && hits.length === hitsBefore && ckanRequests.length === ckanBefore, 'gate: ...and not one of them changed a site or tag, probed the e-GP feed, or loaded the agency directory');
  const invalidAsAdmin = await call('POST', '/admin/gov-sites', { cookie: roles[3][1], body: { rogue: true } });
  const invalidAsVisitor = await call('POST', '/admin/gov-sites', { body: { rogue: true } });
  record(invalidAsAdmin.status === 403 && invalidAsVisitor.status === 401, 'gate: the role is checked before the body, so an Admin or visitor learns nothing about validation (403 / 401 even for a bad body)', `${invalidAsAdmin.status} ${invalidAsVisitor.status}`);
  const badIdAsAdmin = await call('PATCH', '/admin/gov-sites/not-an-id', { cookie: roles[3][1], body: { enabled: false } });
  record(badIdAsAdmin.status === 403, 'gate: ...nor about ids (an Admin patching a malformed id is still 403)', String(badIdAsAdmin.status));
  for (const [roleName, cookie] of roles.slice(2)) {
    const r = await call('GET', '/admin/gov-sites', { cookie });
    if (r.status !== 200 || !Array.isArray(r.json?.data)) gateBad.push(`list as ${roleName} -> ${r.status}`);
  }
  record(!gateBad.some(line => line.startsWith('list')), 'gate: every Admin can still VIEW the site list (FR-2.8: "may view but not edit")');
  record((await call('GET', '/admin/gov-sites', { cookie: roles[1][1] })).status === 403 && (await call('GET', '/admin/gov-sites')).status === 401, 'gate: ...but a vendor gets 403 and a visitor 401 on the admin list');
  record((await call('GET', '/gov-sites')).status === 200, 'gate: the public directory stays open to visitors');
  for (const [roleName, cookie] of [roles[0], roles[1]]) {
    const one = await call('POST', `/admin/gov-sites/${sid}/poll`, { cookie, body: { source: 'rss' } });
    const all = await call('POST', '/admin/gov-sites/poll-all', { cookie });
    if (one.status !== (cookie ? 403 : 401) || all.status !== (cookie ? 403 : 401)) gateBad.push(`poll as ${roleName} -> ${one.status}/${all.status}`);
  }
  record(!gateBad.some(line => line.startsWith('poll')) && (await PollJob.countDocuments()) === 0, 'gate: a visitor and a vendor cannot start a poll either (401 / 403) and no job is queued');

  // the gate follows the account, not the session: it is re-read from the database on every request
  const temp = await mk('temp-super@example.com', 'superadmin');
  const tempC = await cookieFor(temp);
  record((await call('PATCH', `/admin/gov-sites/${sid}`, { cookie: tempC, body: { nameEn: 'Seed Site' } })).status === 200, 'gate: a Super Admin session works (setup)');
  await Account.updateOne({ _id: temp._id }, { role: 'admin' });
  const demoted = await call('PATCH', `/admin/gov-sites/${sid}`, { cookie: tempC, body: { nameEn: 'Seed Site' } });
  record(demoted.status === 403, 'gate: demoting the account takes effect on its very next request, with the same session (403)', String(demoted.status));
  await Account.updateOne({ _id: temp._id }, { role: 'superadmin', status: 'suspended' });
  const suspended = await call('PATCH', `/admin/gov-sites/${sid}`, { cookie: tempC, body: { nameEn: 'Seed Site' } });
  record(suspended.status === 403 && code(suspended) === 'ACCOUNT_SUSPENDED', 'gate: a suspended Super Admin is refused (403 ACCOUNT_SUSPENDED)', `${suspended.status} ${code(suspended)}`);
  await Account.deleteOne({ _id: temp._id });
  record((await call('PATCH', `/admin/gov-sites/${sid}`, { cookie: tempC, body: { nameEn: 'Seed Site' } })).status === 401, 'gate: a deleted account\'s session is 401');

  // removing a site is not offered at all: disabling is how a source is taken out of use
  const removeTries: [string, string][] = [['DELETE', `/admin/gov-sites/${sid}`], ['PUT', `/admin/gov-sites/${sid}`], ['DELETE', '/admin/gov-sites'], ['POST', `/admin/gov-sites/${sid}`], ['GET', `/admin/gov-sites/${sid}`]];
  const removeBad: string[] = [];
  for (const [m, p] of removeTries) {
    const r = await call(m, p, { cookie: superC, body: m === 'GET' ? undefined : {} });
    if (r.status !== 404 && r.status !== 405) removeBad.push(`${m} ${p} -> ${r.status}`);
  }
  record(removeBad.length === 0 && (await GovSite.countDocuments()) === 1, 'routes: there is no way to delete or replace a site over HTTP (even for the Super Admin); disabling is the way', removeBad.join(' | '));

  // and the Super Admin gets through all of it
  const superOk: [string, number][] = [];
  for (const [what, method, p, body] of writes.slice(1)) {
    const r = await call(method, p, { cookie: superC, body });
    superOk.push([what, r.status]);
  }
  record(superOk.every(([, status]) => status === 200), 'gate: the Super Admin can do every one of those (all 200)', superOk.filter(([, s]) => s !== 200).map(([w, s]) => `${w} -> ${s}`).join(' | '));
  await wipe();

  // =================================================== 2. add a site (US-2.4, FR-2.3)
  const added = await call('POST', '/admin/gov-sites', {
    cookie: superC,
    body: { name: '  กรมทางหลวงทดสอบ  ', nameEn: ' Test Highways ', shortCode: ' dohx ', deptId: ' 8101 ', dataGoThOrgSlug: 'cgd', requestsPerMinute: 120 }
  });
  const site = added.json?.data;
  record(
    added.status === 201 && added.json?.success === true && site?.name === 'กรมทางหลวงทดสอบ' && site?.nameEn === 'Test Highways' && site?.shortCode === 'DOHX' && site?.deptId === '8101' && site?.dataGoThOrgSlug === 'cgd' && site?.requestsPerMinute === 120,
    'add: 201, and the saved site is what was typed, trimmed (short code upper-cased)',
    added.text.slice(0, 200)
  );
  record(
    JSON.stringify(site?.announceTypes) === '["B0","D0"]' && site?.enabled === true && site?.pollIntervalMinutes === undefined,
    'add: a new site polls draft TORs and invitations (B0, D0) by default, is enabled, and has no schedule override of its own'
  );
  const stored = await GovSite.findById(site?._id).lean();
  record(!!stored && stored.deptId === '8101' && stored.name === 'กรมทางหลวงทดสอบ' && stored.enabled === true, 'add: it is stored');
  const tag = await Tag.findOne({ facet: 'site', siteId: site?._id }).lean();
  record(!!tag && tag.name === 'กรมทางหลวงทดสอบ' && tag.aliases.includes('DOHX') && tag.retired === false, 'add: the site\'s followable tag is created with it (named after the site, the short code as an alias)', JSON.stringify(tag));
  const adminList = await call('GET', '/admin/gov-sites', { cookie: superC });
  const listed = (adminList.json?.data ?? []).find((s: any) => s._id === site?._id);
  record(!!listed && listed.worksCount === 0 && listed.lastRun === null && typeof listed.effectiveIntervalMinutes === 'number' && listed.nextRunAt !== null, 'add: the admin list shows it at once, with its stats and a next-run time (no restart)');
  const publicList = await call('GET', '/gov-sites');
  record((publicList.json?.data ?? []).some((s: any) => s._id === site?._id), 'add: ...and so does the public directory');
  const dupDept = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'อีกแห่ง', shortCode: 'OTHER', deptId: '8101' } });
  const dupCode = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'อีกแห่ง', shortCode: 'dohx', deptId: '8102' } });
  record(dupDept.status === 409 && dupCode.status === 409, 'add: a deptId or short code already in use is 409 (short codes compare case-insensitively)', `${dupDept.status} ${dupCode.status}`);
  record(!!fields(dupDept).deptId && !!fields(dupCode).shortCode, 'add: ...and the answer says WHICH field is taken', `${JSON.stringify(dupDept.json?.error)} ${JSON.stringify(dupCode.json?.error)}`);
  record((await GovSite.countDocuments()) === 1 && (await Tag.countDocuments({ facet: 'site' })) === 1, 'add: ...and neither left a second site or tag behind');
  const dupName = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'กรมทางหลวงทดสอบ', shortCode: 'SAME', deptId: '8190' } });
  record(dupName.status === 409 && /DOHX/.test(fields(dupName).name ?? '') && (await GovSite.countDocuments()) === 1 && (await Tag.countDocuments({ facet: 'site' })) === 1, 'add: a second site with the same name is 409 naming the field and the site that has the name (the site tag is named after the site), and no half-made site is left behind', `${dupName.status} ${JSON.stringify(dupName.json?.error)} sites=${await GovSite.countDocuments()} tags=${await Tag.countDocuments({ facet: 'site' })}`);
  await Tag.create({ name: 'ชื่อที่ซ้ำกับแท็กเดิม', facet: 'site' });
  const dupTag = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'ชื่อที่ซ้ำกับแท็กเดิม', shortCode: 'TAGCLASH', deptId: '8191' } });
  record(dupTag.status === 409 && !!fields(dupTag).name && !(await GovSite.exists({ shortCode: 'TAGCLASH' })), 'add: if a tag with that name already exists in the site group, the add is 409 and the site is taken back out (never saved without its tag)', `${dupTag.status} ${JSON.stringify(dupTag.json?.error)}`);
  await Tag.deleteOne({ name: 'ชื่อที่ซ้ำกับแท็กเดิม', facet: 'site' });
  const rogueCount = await GovSite.countDocuments();
  const full = await call('POST', '/admin/gov-sites', {
    cookie: superC,
    body: {
      name: 'ไซต์ครบทุกช่อง', nameEn: 'Full Site', shortCode: 'FULL1', deptId: '8103',
      announceTypes: ['P0', '15', 'B0', 'D0', 'W0', 'D1', 'W1', 'D2', 'W2'], dataGoThOrgSlug: 'org-1', dataGoThResourceId: 'a1b2c3d4-0000-4000-8000-000000000001',
      dataGoThPackageId: 'pkg-1', dataGoThSearchQuery: 'organization:cgd title:สัญญา', requestsPerMinute: 600, pollIntervalMinutes: 120
    }
  });
  record(full.status === 201 && full.json.data.announceTypes.length === 9 && full.json.data.pollIntervalMinutes === 120 && full.json.data.dataGoThResourceId === 'a1b2c3d4-0000-4000-8000-000000000001', 'add: every optional field can be set at creation (all nine announcement types, data.go.th ids, search query, rate, own interval)', full.text.slice(0, 200));

  // =================================================== 3. what is refused before saving (alternative flow "Invalid Identifier")
  const good = { name: 'หน่วยงานทดสอบ', nameEn: 'Test Agency', shortCode: 'TST1', deptId: '8201' };
  type Bad = [label: string, body: unknown, field?: string];
  const long = (n: number) => 'a'.repeat(n);
  const badCreate: Bad[] = [
    ['an empty object', {}],
    ['no deptId', { ...good, deptId: undefined }, 'deptId'],
    ['no name', { ...good, name: undefined }, 'name'],
    ['no shortCode', { ...good, shortCode: undefined }, 'shortCode'],
    ['deptId empty', { ...good, deptId: '' }, 'deptId'],
    ['deptId only spaces', { ...good, deptId: '   ' }, 'deptId'],
    ['deptId letters', { ...good, deptId: 'abc' }, 'deptId'],
    ['deptId with a space inside', { ...good, deptId: '21 02' }, 'deptId'],
    ['deptId with a trailing letter', { ...good, deptId: '2102x' }, 'deptId'],
    ['deptId carrying a second query parameter', { ...good, deptId: '2102&anounceType=W0' }, 'deptId'],
    ['deptId with a semicolon', { ...good, deptId: '2102;' }, 'deptId'],
    ['deptId a path', { ...good, deptId: '../1' }, 'deptId'],
    ['deptId a tag', { ...good, deptId: '<script>' }, 'deptId'],
    ['deptId in full-width digits', { ...good, deptId: '２１０２' }, 'deptId'],
    ['deptId hex', { ...good, deptId: '0x10' }, 'deptId'],
    ['deptId negative', { ...good, deptId: '-1' }, 'deptId'],
    ['deptId with a decimal point', { ...good, deptId: '1.5' }, 'deptId'],
    ['deptId in exponent form', { ...good, deptId: '1e3' }, 'deptId'],
    ['deptId with a line break', { ...good, deptId: '21\n02' }, 'deptId'],
    ['deptId 11 digits', { ...good, deptId: '12345678901' }, 'deptId'],
    ['deptId 5,000 characters', { ...good, deptId: long(5000) }, 'deptId'],
    ['deptId null', { ...good, deptId: null }, 'deptId'],
    ['deptId a number', { ...good, deptId: 2102 }, 'deptId'],
    ['deptId a list', { ...good, deptId: ['2102'] }, 'deptId'],
    ['deptId an operator object', { ...good, deptId: { $ne: '' } }, 'deptId'],
    ['name empty', { ...good, name: '' }, 'name'],
    ['name only spaces', { ...good, name: '   ' }, 'name'],
    ['name 201 characters', { ...good, name: long(201) }, 'name'],
    ['name a number', { ...good, name: 123 }, 'name'],
    ['name null', { ...good, name: null }, 'name'],
    ['name a list', { ...good, name: ['x'] }, 'name'],
    ['name with a control character', { ...good, name: 'ชื่อ\u0000ผิด' }, 'name'],
    ['name with a line break', { ...good, name: 'ชื่อ\nผิด' }, 'name'],
    ['nameEn 201 characters', { ...good, nameEn: long(201) }, 'nameEn'],
    ['nameEn a number', { ...good, nameEn: 5 }, 'nameEn'],
    ['shortCode empty', { ...good, shortCode: '' }, 'shortCode'],
    ['shortCode 21 characters', { ...good, shortCode: long(21) }, 'shortCode'],
    ['shortCode with a space', { ...good, shortCode: 'has space' }, 'shortCode'],
    ['shortCode with a slash', { ...good, shortCode: 'bad/slash' }, 'shortCode'],
    ['shortCode a tag', { ...good, shortCode: '<b>' }, 'shortCode'],
    ['shortCode symbols', { ...good, shortCode: '@@' }, 'shortCode'],
    ['shortCode starting with a dash', { ...good, shortCode: '-X' }, 'shortCode'],
    ['shortCode a number', { ...good, shortCode: 5 }, 'shortCode'],
    ['announceTypes empty (a site that polls nothing)', { ...good, announceTypes: [] }, 'announceTypes'],
    ['announceTypes an unknown code', { ...good, announceTypes: ['X0'] }, 'announceTypes'],
    ['announceTypes in lower case', { ...good, announceTypes: ['b0'] }, 'announceTypes'],
    ['announceTypes with a repeat', { ...good, announceTypes: ['B0', 'B0'] }, 'announceTypes'],
    ['announceTypes a string', { ...good, announceTypes: 'B0' }, 'announceTypes'],
    ['announceTypes null', { ...good, announceTypes: null }, 'announceTypes'],
    ['announceTypes numbers', { ...good, announceTypes: [1] }, 'announceTypes'],
    ['requestsPerMinute 0', { ...good, requestsPerMinute: 0 }, 'requestsPerMinute'],
    ['requestsPerMinute 601', { ...good, requestsPerMinute: 601 }, 'requestsPerMinute'],
    ['requestsPerMinute negative', { ...good, requestsPerMinute: -5 }, 'requestsPerMinute'],
    ['requestsPerMinute 1.5', { ...good, requestsPerMinute: 1.5 }, 'requestsPerMinute'],
    ['requestsPerMinute text', { ...good, requestsPerMinute: 'abc' }, 'requestsPerMinute'],
    ['requestsPerMinute blank', { ...good, requestsPerMinute: '' }, 'requestsPerMinute'],
    ['requestsPerMinute true', { ...good, requestsPerMinute: true }, 'requestsPerMinute'],
    ['requestsPerMinute null', { ...good, requestsPerMinute: null }, 'requestsPerMinute'],
    ['requestsPerMinute "12abc"', { ...good, requestsPerMinute: '12abc' }, 'requestsPerMinute'],
    ['requestsPerMinute a million', { ...good, requestsPerMinute: 1e6 }, 'requestsPerMinute'],
    ['pollIntervalMinutes 0', { ...good, pollIntervalMinutes: 0 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes 60 (under the 2-hour floor)', { ...good, pollIntervalMinutes: 60 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes 119', { ...good, pollIntervalMinutes: 119 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes over 30 days', { ...good, pollIntervalMinutes: 43201 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes 150.5', { ...good, pollIntervalMinutes: 150.5 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes text', { ...good, pollIntervalMinutes: 'abc' }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes blank', { ...good, pollIntervalMinutes: '' }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes true', { ...good, pollIntervalMinutes: true }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes null (only an edit can drop an override)', { ...good, pollIntervalMinutes: null }, 'pollIntervalMinutes'],
    ['dataGoThOrgSlug empty', { ...good, dataGoThOrgSlug: '' }, 'dataGoThOrgSlug'],
    ['dataGoThOrgSlug with a space', { ...good, dataGoThOrgSlug: 'has space' }, 'dataGoThOrgSlug'],
    ['dataGoThOrgSlug 101 characters', { ...good, dataGoThOrgSlug: long(101) }, 'dataGoThOrgSlug'],
    ['dataGoThOrgSlug with a semicolon', { ...good, dataGoThOrgSlug: 'x;y' }, 'dataGoThOrgSlug'],
    ['dataGoThOrgSlug a number', { ...good, dataGoThOrgSlug: 7 }, 'dataGoThOrgSlug'],
    ['dataGoThResourceId with a space', { ...good, dataGoThResourceId: 'a b' }, 'dataGoThResourceId'],
    ['dataGoThResourceId a URL', { ...good, dataGoThResourceId: 'http://evil.example/x' }, 'dataGoThResourceId'],
    ['dataGoThResourceId 101 characters', { ...good, dataGoThResourceId: long(101) }, 'dataGoThResourceId'],
    ['dataGoThPackageId with an ampersand', { ...good, dataGoThPackageId: 'a&b=c' }, 'dataGoThPackageId'],
    ['dataGoThPackageId empty', { ...good, dataGoThPackageId: '' }, 'dataGoThPackageId'],
    ['dataGoThSearchQuery 201 characters', { ...good, dataGoThSearchQuery: long(201) }, 'dataGoThSearchQuery'],
    ['dataGoThSearchQuery empty', { ...good, dataGoThSearchQuery: '' }, 'dataGoThSearchQuery'],
    ['dataGoThSearchQuery with a null byte', { ...good, dataGoThSearchQuery: 'a\u0000b' }, 'dataGoThSearchQuery'],
    ['an unknown field', { ...good, rogue: 1 }],
    ['enabled (a new site cannot be created switched off)', { ...good, enabled: false }],
    ['an _id', { ...good, _id: '000000000000000000000001' }],
    ['createdAt', { ...good, createdAt: '2020-01-01' }],
    ['nextPollAt (the scheduler\'s own field)', { ...good, nextPollAt: '2020-01-01' }],
    ['worksCount', { ...good, worksCount: 99 }],
    ['a nested unknown field', { ...good, extra: { deep: 1 } }]
  ];
  const sitesBeforeBad = await snapshot();
  const badFails: string[] = [];
  for (const [label, body, field] of badCreate) {
    const r = await call('POST', '/admin/gov-sites', { cookie: superC, body });
    if (r.status !== 400 || code(r) !== 'VALIDATION_ERROR') badFails.push(`${label} -> ${r.status} ${code(r) ?? ''}`);
    else if (field && !names(r, field)) badFails.push(`${label} -> 400 but no "${field}" message (${Object.keys(fields(r)).join(',')})`);
  }
  record(badFails.length === 0, `validation: ${badCreate.length} bad ways to add a site are all 400 VALIDATION_ERROR, each naming the field at fault`, badFails.slice(0, 6).join(' | '));
  // `$` and dotted keys are dropped by the global input sanitiser (they never reach the code), so they
  // are not an error -- they just have no effect
  const withOperator = await call('POST', '/admin/gov-sites', { cookie: superC, body: { ...good, shortCode: 'OPKEY', deptId: '8299', $set: { enabled: false }, 'enabled.x': false } });
  const operatorSite = await GovSite.findOne({ shortCode: 'OPKEY' }).lean();
  record(withOperator.status === 201 && operatorSite?.enabled === true, 'validation: a "$set" or dotted key in the body is stripped and has no effect (the site is created enabled)', `${withOperator.status} enabled=${operatorSite?.enabled}`);
  await GovSite.deleteMany({ shortCode: 'OPKEY' });
  await Tag.deleteMany({ facet: 'site', siteId: operatorSite?._id });
  const shapes: [string, string][] = [['null', 'null'], ['a list', '[]'], ['a string', '"text"'], ['a number', '42'], ['true', 'true'], ['broken JSON', '{"name": "x"']];
  const shapeBad: string[] = [];
  for (const [label, raw] of shapes) {
    const r = await call('POST', '/admin/gov-sites', { cookie: superC, raw });
    if (r.status !== 400) shapeBad.push(`${label} -> ${r.status}`);
  }
  record(shapeBad.length === 0, 'validation: a body that is not an object (null, list, string, number, broken JSON) is 400', shapeBad.join(' | '));
  record((await snapshot()) === sitesBeforeBad && (await GovSite.countDocuments()) === rogueCount + 1, 'validation: nothing that was refused was saved (no site, no tag, nothing changed)');

  const okCreates: [string, Record<string, unknown>][] = [
    ['deptId "1" (shortest)', { shortCode: 'B1', deptId: '1' }],
    ['deptId of 10 digits with leading zeros', { shortCode: 'B2', deptId: '0000000001' }],
    ['deptId of 7 digits, like the live agency 4520101', { shortCode: 'B3', deptId: '4520101' }],
    ['a 200-character name', { shortCode: 'B4', deptId: '8301', name: 'ก'.repeat(200) }],
    ['a short code with a dash, dot and underscore', { shortCode: 'a-b_c.d', deptId: '8302' }],
    ['a Thai short code', { shortCode: 'สธ', deptId: '8303' }],
    ['a 20-character short code', { shortCode: 'X'.repeat(20), deptId: '8304' }],
    ['requestsPerMinute 1 and 600', { shortCode: 'B5', deptId: '8305', requestsPerMinute: 1 }],
    ['requestsPerMinute 600', { shortCode: 'B6', deptId: '8306', requestsPerMinute: 600 }],
    ['pollIntervalMinutes at the 2-hour floor', { shortCode: 'B7', deptId: '8307', pollIntervalMinutes: 120 }],
    ['pollIntervalMinutes at the 30-day cap', { shortCode: 'B8', deptId: '8308', pollIntervalMinutes: 43200 }],
    ['a single announcement type', { shortCode: 'B9', deptId: '8309', announceTypes: ['W2'] }],
    ['numbers sent as digit strings (older clients)', { shortCode: 'C1', deptId: '8310', requestsPerMinute: '30', pollIntervalMinutes: '180' }],
    ['a data.go.th search query with CKAN syntax', { shortCode: 'C2', deptId: '8311', dataGoThSearchQuery: 'organization:cgd title:สัญญา' }]
  ];
  const okBad: string[] = [];
  for (const [label, over] of okCreates) {
    const r = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: `ขอบเขต ${over.shortCode}`, ...over } });
    if (r.status !== 201) okBad.push(`${label} -> ${r.status} ${JSON.stringify(r.json?.error?.fields ?? r.json?.error?.message)}`);
  }
  record(okBad.length === 0, `validation: ${okCreates.length} legitimate edge values are accepted (shortest/longest codes, boundary numbers, the 7-digit live code, digit strings from older clients)`, okBad.slice(0, 4).join(' | '));
  await GovSite.deleteMany({ shortCode: { $nin: ['DOHX', 'FULL1'] } });
  await Tag.deleteMany({ facet: 'site', siteId: { $nin: (await GovSite.find({}, '_id').lean()).map(s => s._id) } });

  // =================================================== 4. edit, enable, disable (US-2.5)
  const sitePath = `/admin/gov-sites/${site._id}`;
  const edit = async (body: unknown) => call('PATCH', sitePath, { cookie: superC, body });
  const now = async () => (await GovSite.findById(site._id).lean())!;
  let r = await edit({ nameEn: 'Test Highways Dept' });
  record(r.status === 200 && r.json?.data?.nameEn === 'Test Highways Dept' && (await now()).nameEn === 'Test Highways Dept' && (await now()).deptId === '8101', 'edit: one field changes and nothing else does');
  r = await edit({ name: 'กรมทางหลวงใหม่', shortCode: 'dohy', deptId: '8199', announceTypes: ['D0', 'W0'], requestsPerMinute: 300, pollIntervalMinutes: 240, dataGoThOrgSlug: 'dla', dataGoThResourceId: 'res-2', dataGoThPackageId: 'pkg-2', dataGoThSearchQuery: 'organization:dla' });
  const e1 = await now();
  record(r.status === 200 && e1.name === 'กรมทางหลวงใหม่' && e1.shortCode === 'DOHY' && e1.deptId === '8199' && JSON.stringify(e1.announceTypes) === '["D0","W0"]' && e1.requestsPerMinute === 300 && e1.pollIntervalMinutes === 240 && e1.dataGoThOrgSlug === 'dla' && e1.dataGoThResourceId === 'res-2' && e1.dataGoThPackageId === 'pkg-2' && e1.dataGoThSearchQuery === 'organization:dla', 'edit: every editable field can be changed (name, short code, deptId, announcement types, rate, own interval, all four data.go.th fields)', r.text.slice(0, 160));
  const listedAfter = ((await call('GET', '/admin/gov-sites', { cookie: superC })).json?.data ?? []).find((s: any) => s._id === site._id);
  record(listedAfter?.deptId === '8199' && listedAfter?.effectiveIntervalMinutes === 240, 'edit: the admin list shows the change at once (and the interval it will really use)');
  r = await edit({ pollIntervalMinutes: null });
  record(r.status === 200 && (await now()).pollIntervalMinutes === undefined, 'edit: pollIntervalMinutes null drops the site\'s own interval, so it follows the global schedule again');
  r = await edit({ dataGoThOrgSlug: null, dataGoThResourceId: null, dataGoThPackageId: null, dataGoThSearchQuery: null });
  const e2 = await now();
  record(r.status === 200 && e2.dataGoThOrgSlug === undefined && e2.dataGoThResourceId === undefined && e2.dataGoThPackageId === undefined && e2.dataGoThSearchQuery === undefined, 'edit: null clears a data.go.th setting (a site can be pointed away from it again)', r.text.slice(0, 160));
  r = await edit({ enabled: false });
  record(r.status === 200 && r.json?.data?.enabled === false && (await now()).enabled === false, 'disable: PATCH {enabled:false}');
  r = await edit({ enabled: false });
  record(r.status === 200 && (await now()).enabled === false, 'disable: disabling again is harmless');
  r = await edit({ enabled: true });
  record(r.status === 200 && r.json?.data?.enabled === true && (await now()).enabled === true, 'enable: PATCH {enabled:true}');
  r = await edit({ enabled: true, requestsPerMinute: 200 });
  record(r.status === 200 && (await now()).requestsPerMinute === 200, 'enable: the flag and other fields can change in one request');
  r = await call('PATCH', '/admin/gov-sites/000000000000000000000000', { cookie: superC, body: { enabled: false } });
  record(r.status === 404 && code(r) === 'NOT_FOUND', 'edit: a well-formed id that is no site is 404', `${r.status} ${code(r)}`);
  const badIds = ['abc', '123', 'null', '0123456789abcdef0123456', '0123456789abcdef012345678', '0123456789abcdef0123456g', '%24ne', '%7B%22%24ne%22%3Anull%7D', '..%2F..'];
  const badIdFails: string[] = [];
  for (const id of badIds) {
    const rr = await call('PATCH', `/admin/gov-sites/${id}`, { cookie: superC, body: { enabled: false } });
    if (rr.status !== 400 || code(rr) !== 'VALIDATION_ERROR') badIdFails.push(`${id} -> ${rr.status}`);
  }
  record(badIdFails.length === 0, `edit: ${badIds.length} malformed site ids are 400 (not a 404 or 500)`, badIdFails.slice(0, 4).join(' | '));
  const publicBad = await call('GET', '/gov-sites/not-an-id');
  const publicGhost = await call('GET', '/gov-sites/000000000000000000000000');
  record(publicBad.status === 400 && publicGhost.status === 404, 'public: GET /gov-sites/:id is 400 for a malformed id and 404 for an unknown one', `${publicBad.status} ${publicGhost.status}`);

  const badUpdates: Bad[] = [
    ['an empty body', {}],
    ['deptId letters', { deptId: 'abc' }, 'deptId'],
    ['deptId empty', { deptId: '' }, 'deptId'],
    ['deptId 11 digits', { deptId: '12345678901' }, 'deptId'],
    ['deptId with a second parameter', { deptId: '8101&anounceType=W0' }, 'deptId'],
    ['name empty', { name: '' }, 'name'],
    ['name 201 characters', { name: long(201) }, 'name'],
    ['name null', { name: null }, 'name'],
    ['nameEn null', { nameEn: null }, 'nameEn'],
    ['shortCode with a space', { shortCode: 'a b' }, 'shortCode'],
    ['shortCode 21 characters', { shortCode: long(21) }, 'shortCode'],
    ['announceTypes empty', { announceTypes: [] }, 'announceTypes'],
    ['announceTypes unknown', { announceTypes: ['Z9'] }, 'announceTypes'],
    ['announceTypes with a repeat', { announceTypes: ['D0', 'D0'] }, 'announceTypes'],
    ['announceTypes null', { announceTypes: null }, 'announceTypes'],
    ['enabled as text', { enabled: 'true' }, 'enabled'],
    ['enabled as a number', { enabled: 1 }, 'enabled'],
    ['enabled null', { enabled: null }, 'enabled'],
    ['requestsPerMinute 0', { requestsPerMinute: 0 }, 'requestsPerMinute'],
    ['requestsPerMinute 601', { requestsPerMinute: 601 }, 'requestsPerMinute'],
    ['requestsPerMinute true', { requestsPerMinute: true }, 'requestsPerMinute'],
    ['requestsPerMinute null', { requestsPerMinute: null }, 'requestsPerMinute'],
    ['pollIntervalMinutes 60', { pollIntervalMinutes: 60 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes over 30 days', { pollIntervalMinutes: 43201 }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes true', { pollIntervalMinutes: true }, 'pollIntervalMinutes'],
    ['pollIntervalMinutes blank', { pollIntervalMinutes: '' }, 'pollIntervalMinutes'],
    ['dataGoThOrgSlug empty (use null to clear)', { dataGoThOrgSlug: '' }, 'dataGoThOrgSlug'],
    ['dataGoThOrgSlug with a space', { dataGoThOrgSlug: 'a b' }, 'dataGoThOrgSlug'],
    ['dataGoThResourceId a URL', { dataGoThResourceId: 'http://evil.example' }, 'dataGoThResourceId'],
    ['dataGoThSearchQuery 201 characters', { dataGoThSearchQuery: long(201) }, 'dataGoThSearchQuery'],
    ['an unknown field', { rogue: 1 }],
    ['the id', { _id: '000000000000000000000001' }],
    ['createdAt', { createdAt: '2020-01-01' }],
    ['nextPollAt', { nextPollAt: '2020-01-01' }],
    ['worksCount', { worksCount: 5 }],
    ['one good field with one bad one', { nameEn: 'Should Not Be Saved', requestsPerMinute: 0 }, 'requestsPerMinute'],
    ['one good field with an unknown one', { nameEn: 'Should Not Be Saved', rogue: 1 }]
  ];
  const beforeBadEdit = JSON.stringify(await now());
  const badEditFails: string[] = [];
  for (const [label, body, field] of badUpdates) {
    const rr = await edit(body);
    if (rr.status !== 400 || code(rr) !== 'VALIDATION_ERROR') badEditFails.push(`${label} -> ${rr.status} ${code(rr) ?? ''}`);
    else if (field && !names(rr, field)) badEditFails.push(`${label} -> 400 but no "${field}" message`);
  }
  record(badEditFails.length === 0, `edit: ${badUpdates.length} bad edits are all 400 VALIDATION_ERROR, each naming the field at fault`, badEditFails.slice(0, 6).join(' | '));
  record(JSON.stringify(await now()) === beforeBadEdit, 'edit: ...and none of them changed the site, not even the valid field sent beside a bad one');
  const taken = await edit({ deptId: '8103' });
  const takenCode = await edit({ shortCode: 'full1' });
  record(taken.status === 409 && !!fields(taken).deptId && takenCode.status === 409 && !!fields(takenCode).shortCode && (await now()).deptId === '8199', 'edit: repointing to another site\'s deptId, or taking its short code, is 409 naming the field, and changes nothing', `${taken.status} ${takenCode.status}`);
  const nameTaken = await edit({ name: 'ไซต์ครบทุกช่อง' });
  record(nameTaken.status === 409 && !!fields(nameTaken).name && (await now()).name === 'กรมทางหลวงใหม่', 'edit: renaming to another site\'s name is 409 naming the field, and changes nothing', `${nameTaken.status} ${JSON.stringify(nameTaken.json?.error)}`);
  const sameValues = await edit({ deptId: '8199', shortCode: 'DOHY' });
  record(sameValues.status === 200, 'edit: saving the site\'s own deptId and short code again is fine (not a clash with itself)', String(sameValues.status));

  // the site's tag follows its name
  const siteTag = async () => (await Tag.findOne({ facet: 'site', siteId: site._id }).lean())!;
  const tagBefore = await siteTag();
  r = await edit({ name: 'กรมทางหลวง (ชื่อใหม่)', shortCode: 'dohz' });
  const tagAfter = await siteTag();
  record(r.status === 200 && tagAfter.name === 'กรมทางหลวง (ชื่อใหม่)' && tagAfter.aliases.includes('DOHZ') && !tagAfter.aliases.includes('DOHY') && String(tagAfter._id) === String(tagBefore._id), 'edit: renaming a site renames its followable tag (same tag, so followers stay) and updates the short-code alias', JSON.stringify(tagAfter));
  const tagList = await call('GET', '/tags');
  record(JSON.stringify(tagList.json?.data ?? []).includes('กรมทางหลวง (ชื่อใหม่)') && !JSON.stringify(tagList.json?.data ?? []).includes('กรมทางหลวงใหม่"'), 'edit: ...so the public tag list shows the new name');
  await Tag.create({ name: 'ชื่อที่ถูกใช้แล้ว', facet: 'site' });
  r = await edit({ name: 'ชื่อที่ถูกใช้แล้ว' });
  record(r.status === 200 && (await now()).name === 'ชื่อที่ถูกใช้แล้ว', 'edit: a rename still succeeds if some other site tag already has that name (the site is what the Super Admin asked for)', `${r.status}`);
  await Tag.deleteOne({ name: 'ชื่อที่ถูกใช้แล้ว', siteId: { $exists: false } });
  await edit({ name: 'กรมทางหลวง (ชื่อใหม่)' });

  // each change is in the audit trail
  const trail = await AuditLog.find({ entityType: 'gov_site', entityId: String(site._id) }).sort({ createdAt: 1 }).lean();
  const actions = trail.map(t => t.action);
  record(actions.includes('gov_site.create'), 'audit: adding a site is recorded', actions.join(','));
  record(actions.includes('gov_site.disable') && actions.includes('gov_site.enable') && actions.includes('gov_site.dept_id_change'), 'audit: ...with disable, enable and "deptId change" each recognised as such', actions.join(','));
  record(trail.every(t => t.actor && String((t.actor as { id?: unknown }).id) === String(superAdmin._id)), 'audit: ...each attributed to the Super Admin who did it');

  // =================================================== 5. verify a deptId against the live feed (mock)
  await wipe();
  feeds['6001'] = { B0: [{ id: '69010001', title: 'จัดซื้อระบบคอมพิวเตอร์', at: '2026-04-01T03:00:00Z' }, { id: '69010002', title: 'จ้างพัฒนาซอฟต์แวร์', at: '2026-04-02T03:00:00Z' }, { id: '69010003', title: 'งานที่สาม', at: '2026-04-03T03:00:00Z' }, { id: '69010004', title: 'งานที่สี่', at: '2026-04-04T03:00:00Z' }], D0: [{ id: '69010005', title: 'Invitation to bid', at: '2026-04-05T03:00:00Z' }] };
  feeds['6002'] = {};
  const verify = (body: unknown) => call('POST', '/admin/gov-sites/verify-dept-id', { cookie: superC, body });
  hits.length = 0;
  let v = await verify({ deptId: '6001' });
  record(v.status === 200 && v.json?.data?.verified === true && v.json.data.deptId === '6001' && v.json.data.totalItems === 5, 'verify: a code whose feed has announcements is "verified" with the item count', v.text.slice(0, 200));
  record(JSON.stringify(hitsOf('6001')) === '["B0","D0"]', 'verify: with no types given it probes the essential ones, draft TOR and invitation (B0, D0), once each', JSON.stringify(hits));
  const b0 = v.json?.data?.results?.find((x: any) => x.announceType === 'B0');
  record(b0?.itemCount === 4 && b0.sample.length === 3 && b0.sample[0] === 'จัดซื้อระบบคอมพิวเตอร์' && b0.sample[1] === 'จ้างพัฒนาซอฟต์แวร์', 'verify: it shows up to three real titles so a person can recognise the agency (Thai read correctly from the Windows-874 feed)', JSON.stringify(b0));
  v = await verify({ deptId: '6002' });
  record(v.status === 200 && v.json?.data?.verified === false && v.json.data.totalItems === 0 && v.json.data.results.every((x: any) => x.itemCount === 0 && !x.error), 'verify: a code whose feed is empty is NOT verified (200, zero items, no error)', v.text.slice(0, 200));
  hits.length = 0;
  v = await verify({ deptId: '6001', announceTypes: ['P0', 'W0', 'D1'] });
  record(v.status === 200 && JSON.stringify(hitsOf('6001')) === '["D1","P0","W0"]' && v.json.data.results.length === 3, 'verify: the types asked for (up to three) are the ones probed');
  feedFails.add('6001:B0');
  v = await verify({ deptId: '6001' });
  const failedType = v.json?.data?.results?.find((x: any) => x.announceType === 'B0');
  record(v.status === 200 && v.json.data.verified === true && !!failedType?.error && failedType.itemCount === 0 && v.json.data.totalItems === 1, 'verify: one type failing (HTTP 500) is reported against that type; the others still count', JSON.stringify(failedType));
  feedFails.add('6001:D0');
  v = await verify({ deptId: '6001' });
  record(v.status === 200 && v.json?.data?.verified === false && v.json.data.results.every((x: any) => !!x.error), 'verify: when every probe fails it is "not verified" with the errors, still a 200 (not a 500)', v.text.slice(0, 200));
  feedFails.clear();
  const verifyBad: [string, unknown][] = [
    ['no deptId', {}], ['deptId empty', { deptId: '' }], ['deptId letters', { deptId: 'abc' }], ['deptId with a second parameter', { deptId: '6001&anounceType=W0' }], ['deptId 11 digits', { deptId: '12345678901' }],
    ['deptId a number', { deptId: 6001 }], ['deptId null', { deptId: null }], ['no types (empty list)', { deptId: '6001', announceTypes: [] }], ['four types', { deptId: '6001', announceTypes: ['P0', '15', 'B0', 'D0'] }],
    ['an unknown type', { deptId: '6001', announceTypes: ['Q1'] }], ['the same type twice', { deptId: '6001', announceTypes: ['B0', 'B0'] }], ['an unknown field', { deptId: '6001', rogue: 1 }], ['types as text', { deptId: '6001', announceTypes: 'B0' }]
  ];
  hits.length = 0;
  const verifyBadFails: string[] = [];
  for (const [label, body] of verifyBad) {
    const rr = await verify(body);
    if (rr.status !== 400 || code(rr) !== 'VALIDATION_ERROR') verifyBadFails.push(`${label} -> ${rr.status}`);
  }
  record(verifyBadFails.length === 0 && hits.length === 0, `verify: ${verifyBad.length} bad requests are 400 and the e-GP feed is never contacted for them`, verifyBadFails.join(' | '));
  const before = [await GovSite.countDocuments(), await Work.countDocuments(), await IngestionRun.countDocuments(), await Tag.countDocuments()].join();
  await verify({ deptId: '6001' });
  record([await GovSite.countDocuments(), await Work.countDocuments(), await IngestionRun.countDocuments(), await Tag.countDocuments()].join() === before, 'verify: it is read-only (no site, work, run or tag is created)');
  feedHangs.add('6001:B0');
  const started = Date.now();
  v = await verify({ deptId: '6001', announceTypes: ['B0', 'D0'] });
  const waited = Date.now() - started;
  const hung = v.json?.data?.results?.find((x: any) => x.announceType === 'B0');
  const fine = v.json?.data?.results?.find((x: any) => x.announceType === 'D0');
  record(v.status === 200 && waited < 20_000 && /timed out/i.test(hung?.error ?? '') && fine?.itemCount === 1, 'verify: a feed that never answers is cut off after about 15 seconds and reported as a timeout, the other type is unaffected', `${waited} ms ${JSON.stringify(hung)}`);
  feedHangs.clear();

  // =================================================== 6. deptId suggestions over HTTP (FR-2.11)
  resetDeptIdDirectoryCache();
  const suggest = (qs: string) => call('GET', `/admin/gov-sites/dept-id-suggestions?q=${encodeURIComponent(qs)}`, { cookie: superC });
  const ids = (res: Res) => ((res.json?.data?.suggestions ?? []) as { deptId: string }[]).map(s => s.deptId);
  let sg = await suggest('กรมบัญชีกลาง');
  const cgd = sg.json?.data?.suggestions?.[0];
  record(sg.status === 200 && cgd?.deptId === '0304' && cgd.confidence === 'derived' && cgd.alreadyAdded === undefined && sg.json.data.directory.status === 'ok', 'suggest: a name finds its code from the agency list (marked derived, not yet added)', JSON.stringify(sg.json?.data).slice(0, 220));
  sg = await suggest('ทางหลวง');
  record(sg.json?.data?.suggestions?.[0]?.deptId === '0806' && sg.json.data.suggestions[0].confidence === 'confirmed', 'suggest: a verified agency is marked confirmed');
  const dohSite = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'กรมบัญชีกลาง', shortCode: 'CGD', deptId: '0304' } });
  const doh2 = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'กรมทางหลวง', shortCode: 'DOH', deptId: '0806' } });
  sg = await suggest('กรมบัญชีกลาง');
  record(dohSite.status === 201 && sg.json?.data?.suggestions?.[0]?.alreadyAdded?.siteId === dohSite.json?.data?._id && sg.json.data.suggestions[0].alreadyAdded.shortCode === 'CGD', 'suggest: once a site uses a code, the suggestion says "already added" and points at that site', JSON.stringify(sg.json?.data?.suggestions?.[0]));
  sg = await suggest('0806');
  record(sg.json?.data?.suggestions?.[0]?.alreadyAdded?.name === 'กรมทางหลวง' && doh2.status === 201, 'suggest: ...also when searching by the code itself');
  sg = await suggest('ไม่มีหน่วยงานนี้เลย');
  record(sg.status === 200 && ids(sg).length === 0, 'suggest: no match is an empty list, not an error');
  ckanDown = true;
  resetDeptIdDirectoryCache();
  sg = await suggest('กรมบัญชีกลาง');
  record(sg.status === 200 && sg.json.data.directory.status === 'unavailable' && ids(sg).length === 0 && !!sg.json.data.directory.error, 'suggest: with the agency directory down, the answer is still 200 and says it is unavailable (nothing invented)', JSON.stringify(sg.json?.data?.directory));
  sg = await suggest('ทางหลวง');
  record(sg.status === 200 && sg.json.data.directory.status === 'unavailable' && ids(sg).join() === '0806' && sg.json.data.suggestions[0].confidence === 'confirmed', 'suggest: ...but the verified agencies are still offered');
  record(sg.json?.data?.suggestions?.[0]?.alreadyAdded?.shortCode === 'DOH', 'suggest: ...and the "already added" flag still works while the directory is down');
  sg = await suggest('2102');
  record(ids(sg).join() === '2102', 'suggest: a verified code is found by number with the directory down');
  const lastRequests = ckanRequests.length;
  await suggest('กรมบัญชีกลาง');
  record(ckanRequests.length === lastRequests, 'suggest: while it is down it does not hit data.go.th again on every keystroke (it backs off)');
  ckanDown = false;
  resetDeptIdDirectoryCache();
  const suggestBad: [string, string][] = [['no q', ''], ['blank q', '?q='], ['q 101 characters', `?q=${long(101)}`], ['limit 0', '?q=2102&limit=0'], ['limit 21', '?q=2102&limit=21'], ['limit text', '?q=2102&limit=abc'], ['an unknown parameter', '?q=2102&x=1']];
  const suggestBadFails: string[] = [];
  for (const [label, qs] of suggestBad) {
    const rr = await call('GET', `/admin/gov-sites/dept-id-suggestions${qs}`, { cookie: superC });
    if (rr.status !== 400) suggestBadFails.push(`${label} -> ${rr.status}`);
  }
  record(suggestBadFails.length === 0, `suggest: ${suggestBad.length} bad queries are 400`, suggestBadFails.join(' | '));
  await wipe();

  // =================================================== 7. every change reaches the very next poll (alternative to "redeploy")
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}T03:00:00Z`;
  feeds['7001'] = {
    B0: [{ id: '69020001', title: 'ร่างขอบเขตงานระบบหนึ่ง', at: day(1) }],
    D0: [{ id: '69020002', title: 'ประกาศเชิญชวนระบบสอง', at: day(2) }],
    W0: [{ id: '69020003', title: 'ประกาศผู้ชนะระบบสาม', at: day(3) }]
  };
  feeds['7002'] = { D0: [{ id: '69020004', title: 'ประกาศเชิญชวนที่หน่วยงานย้ายรหัส', at: day(4) }] };
  const addP = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'หน่วยงานที่เก็บข้อมูล', shortCode: 'POLLP', deptId: '7001', requestsPerMinute: 600 } });
  const P = addP.json?.data;
  const worksOf = async (id: string) => (await Work.find({ siteId: id }).lean()).map(w => ({ id: w.projectId, status: w.status }));
  const pollNow = async (source = 'rss') => {
    hits.length = 0;
    const queued = await call('POST', `/admin/gov-sites/${P._id}/poll`, { cookie: pollAdminC, body: { source } });
    const ran = await drain();
    return { queued, ran };
  };
  // a brand-new site is picked up by the scheduler's next pass, with no restart
  hits.length = 0;
  const enqueued = await enqueueDueSitePolls();
  const sched = await drain();
  record(addP.status === 201 && enqueued === 1 && sched.done === 1, 'next poll: a site added a moment ago is picked up by the very next scheduler pass', `${addP.status} enqueued=${enqueued} done=${sched.done} ${sched.failed.join('|')}`);
  record(JSON.stringify(hitsOf('7001')) === '["B0","D0"]', 'next poll: ...and polls exactly its announcement types (B0, D0), at the deptId it was given', JSON.stringify(hits.map(h => `${h.dept}:${h.type}`)));
  const w1 = await worksOf(P._id);
  record(w1.length === 2 && w1.some(w => w.status === 'DRAFT_TOR') && w1.some(w => w.status === 'BIDDING'), 'next poll: ...so its works appear (the Thai titles intact)', JSON.stringify(w1));
  const w1Title = (await Work.findOne({ siteId: P._id, projectId: '69020001' }).lean())?.title;
  record(w1Title === 'ร่างขอบเขตงานระบบหนึ่ง', 'next poll: ...with the title read correctly from the Windows-874 feed', w1Title);
  const siteTagP = await Tag.findOne({ facet: 'site', siteId: P._id }).lean();
  record(!!siteTagP && (await Work.find({ siteId: P._id }).lean()).every(w => w.tags.some(t => String(t) === String(siteTagP._id))), 'next poll: ...each carrying the site\'s tag, which was created when the site was added');

  // announcement types
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { announceTypes: ['B0', 'D0', 'W0'] } });
  let p = await pollNow();
  record(p.queued.status === 201 && p.ran.done === 1 && JSON.stringify(hitsOf('7001')) === '["B0","D0","W0"]', 'next poll: adding the winner type (W0) to the site makes the next poll fetch it', JSON.stringify(hits.map(h => h.type)));
  record((await worksOf(P._id)).some(w => w.id === '69020003' && w.status === 'AWARDED'), 'next poll: ...and the winner announcement is ingested');
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { announceTypes: ['D0'] } });
  p = await pollNow();
  record(JSON.stringify(hitsOf('7001')) === '["D0"]', 'next poll: narrowing the types to D0 stops the other types being fetched', JSON.stringify(hits.map(h => h.type)));

  // deptId
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { deptId: '7002' } });
  p = await pollNow();
  const afterRepoint = await worksOf(P._id);
  record(hitsOf('7001').length === 0 && JSON.stringify(hitsOf('7002')) === '["D0"]', 'next poll: repointing the site to a new deptId polls the new code and never the old one', JSON.stringify(hits.map(h => `${h.dept}:${h.type}`)));
  record(afterRepoint.length === 4 && afterRepoint.some(w => w.id === '69020004'), 'next poll: ...the new code\'s work is added to the same site, and what was ingested before stays', JSON.stringify(afterRepoint));

  // request rate: the gap between two requests of one poll follows the setting
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { announceTypes: ['B0', 'D0', 'W0'], requestsPerMinute: 120 } });
  await pollNow();
  const gapsSlow = hits.slice(1).map((h, i) => h.at - hits[i].at);
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { requestsPerMinute: 600 } });
  await pollNow();
  const gapsFast = hits.slice(1).map((h, i) => h.at - hits[i].at);
  record(gapsSlow.length === 2 && gapsSlow.every(g => g >= 450) && gapsFast.length === 2 && gapsFast.every(g => g < 450), 'next poll: the request rate takes effect (120 per minute spaces requests about 500 ms apart; 600 per minute, 100 ms)', `${gapsSlow.join(',')} / ${gapsFast.join(',')}`);

  // disabling
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { enabled: false } });
  await GovSite.updateOne({ _id: P._id }, { $set: { nextPollAt: new Date(Date.now() - 60_000) } }); // overdue, so only "disabled" can be what stops it
  hits.length = 0;
  const dueWhileOff = await enqueueDueSitePolls();
  record(dueWhileOff === 0 && (await PollJob.countDocuments({ status: 'queued' })) === 0, 'next poll: a disabled site is skipped by the scheduler even when it is overdue');
  const manualOff = await call('POST', `/admin/gov-sites/${P._id}/poll`, { cookie: pollAdminC, body: { source: 'rss' } });
  record(manualOff.status === 400 && /disabled/i.test(manualOff.json?.error?.message ?? ''), 'next poll: ...and a manual poll of it is refused with a clear message (400)', `${manualOff.status} ${manualOff.json?.error?.message}`);
  const allOff = await call('POST', '/admin/gov-sites/poll-all', { cookie: pollAdminC });
  record(allOff.status === 400 && /no government site is enabled/i.test(allOff.json?.error?.message ?? ''), 'next poll: "Poll Now - all sites" with nothing enabled is refused (400)', `${allOff.status} ${allOff.json?.error?.message}`);
  feeds['7101'] = { B0: [{ id: '69020010', title: 'งานของหน่วยงานที่สอง', at: day(10) }] };
  const addQ = await call('POST', '/admin/gov-sites', { cookie: superC, body: { name: 'หน่วยงานที่สอง', shortCode: 'POLLQ', deptId: '7101', requestsPerMinute: 600 } });
  const allOn = await call('POST', '/admin/gov-sites/poll-all', { cookie: pollAdminC });
  const allRan = await drain();
  record(addQ.status === 201 && allOn.status === 201 && allRan.done === 1 && hitsOf('7101').length === 2 && hits.every(h => h.dept !== '7002' && h.dept !== '7001'), 'next poll: "Poll Now - all sites" polls the enabled site and leaves the disabled one alone', JSON.stringify(hits.map(h => `${h.dept}:${h.type}`)));
  // a job queued while the site was on, but run after it was switched off
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { enabled: true } });
  const queuedJob = await call('POST', `/admin/gov-sites/${P._id}/poll`, { cookie: pollAdminC, body: { source: 'rss' } });
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { enabled: false } });
  hits.length = 0;
  const lateRun = await drain();
  record(queuedJob.status === 201 && lateRun.done === 0 && lateRun.failed.length === 1 && /disabled/i.test(lateRun.failed[0]) && hitsOf('7002').length === 0, 'next poll: a poll queued just before a site was switched off does not fetch anything when it comes to run (it is failed with a message)', `${queuedJob.status} ${JSON.stringify(lateRun)}`);

  // enabling again
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { enabled: true, announceTypes: ['D0'] } });
  await GovSite.updateOne({ _id: P._id }, { $set: { nextPollAt: new Date(Date.now() - 60_000) } });
  hits.length = 0;
  const dueAgain = await enqueueDueSitePolls();
  const ranAgain = await drain();
  record(dueAgain >= 1 && ranAgain.done >= 1 && JSON.stringify(hitsOf('7002')) === '["D0"]', 'next poll: switching the site back on makes the next scheduler pass poll it again, with its current settings', `${dueAgain} ${JSON.stringify(hits.map(h => `${h.dept}:${h.type}`))}`);

  // rename shows in the works' agency straight away
  await call('PATCH', `/admin/gov-sites/${P._id}`, { cookie: superC, body: { name: 'ชื่อหน่วยงานหลังเปลี่ยน' } });
  const listWorks = await call('GET', `/works?siteId=${P._id}`);
  const item = (listWorks.json?.data?.items ?? listWorks.json?.data ?? [])[0];
  record(listWorks.status === 200 && JSON.stringify(listWorks.json).includes('ชื่อหน่วยงานหลังเปลี่ยน'), 'next poll: a rename shows on the site\'s works straight away (no re-poll needed)', JSON.stringify(item).slice(0, 160));

  // =================================================== 8. invariants over everything this check created
  const sites = await GovSite.find({}).lean();
  const siteTags = await Tag.find({ facet: 'site' }).lean();
  const bad = sites.filter(s => !/^\d{1,10}$/.test(s.deptId) || s.announceTypes.length === 0 || new Set(s.announceTypes).size !== s.announceTypes.length || s.shortCode !== s.shortCode.toUpperCase() || s.requestsPerMinute < 1 || s.requestsPerMinute > 600 || !siteTags.some(t => String(t.siteId) === String(s._id)));
  record(sites.length >= 2 && bad.length === 0 && new Set(sites.map(s => s.deptId)).size === sites.length, `integrity: all ${sites.length} sites left have a digits-only deptId, at least one distinct announcement type, an upper-case short code, a rate in range and a site tag, and no two share a deptId`, bad.map(s => s.shortCode).join(','));

  server.close();
  mock.closeAllConnections();
  mock.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
