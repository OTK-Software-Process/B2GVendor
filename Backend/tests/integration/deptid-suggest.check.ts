// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import fs from 'fs';
import http from 'http';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../../src/config/env';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { cleanThaiName, fetchMofDepartments, gfmisToDeptId, MOF_PAYMENT_UNIT_DATASET } from '../../src/integrations/govAgencyDirectory.client';
import { Account, AccountRole } from '../../src/models/account.model';
import { GovSite } from '../../src/models/govSite.model';
import {
  DIRECTORY_RETRY_AFTER_MS,
  DIRECTORY_TTL_MS,
  KNOWN_AGENCIES,
  resetDeptIdDirectoryCache,
  suggestDeptIds
} from '../../src/services/deptIdSuggestion.service';
import { createSession } from '../../src/services/session.service';

// deptId suggestions for the Add Government Site form. Everything external is
// faked on local ports (data.go.th's CKAN API and the e-GP RSS feed), so this
// needs no network. Uses its own throwaway database (dropped at the start and
// end) -- never touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-deptid-suggest-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ---------------------------------------------------------------- fake data.go.th
type Mode = 'ok' | 'down' | 'no-column' | 'empty' | 'no-queryable-resource';
let mode: Mode = 'ok';
const requests: { action: string; params: URLSearchParams }[] = [];
const count = (action: string) => requests.filter(r => r.action === action).length;

const PAGE_SIZE = 5000;
const DATA_CSV = 'aaaaaaaa-0000-0000-0000-000000000001';
const DATA_XLSX = 'aaaaaaaa-0000-0000-0000-000000000002';
const DICTIONARY = 'aaaaaaaa-0000-0000-0000-000000000003';

// Modelled on the real dataset: one row per payment unit, the code a number with
// its leading zero dropped, Thai text with extraction typos.
type Row = { 'รหัสกรม': number | string; 'กรม': string; 'กระทรวง': string; [k: string]: unknown };
const row = (code: number | string, name: string, ministry: string): Row => ({ 'รหัสกรม': code, 'กรม': name, 'กระทรวง': ministry });
const MOPH = 'กระทรวงสาธารณสุข';
const rows: Row[] = [
  // 5,100 rows for one department: forces a second page of 5,000
  ...Array.from({ length: 5100 }, () => row(21002, 'สำนักงานปลัดกระทรวงสาธารณสุข', MOPH)),
  row(21002, 'สำนักงานปลัดกระทรวงสาธารณสุขX', MOPH), // a rare variant spelling: the common one wins
  row(21009, 'กรมอนามัย', MOPH),
  row(8006, 'กรมทางหลวง', 'กระทรวงคมนาคม'), // 08006 stored as a number
  row('08006', 'กรมทางหลวง', 'กระทรวงคมนาคม'), // ...and as text: still the same department
  row(8007, 'กรมทางหลวงชนบท', 'กระทรวงคมนาคม'),
  row(3004, 'กรมบัญชีกลาง', 'กระทรวงการคลัง'),
  row(3003, 'กรมธนารีักษ์', 'กระทรวงการคลัง'), // typo: stray ี
  row(2001, 'สำนักงานปลัดกระทรวงกลำโหม', 'กระทรวงกลำโหม'), // typo: ำ for า
  row(1002, 'กรมประชาสัมพันธ์', 'สำนักนายกรัฐมนตรี'),
  row(21100, 'หน่วยงานรหัสแปลก', MOPH), // 3rd digit is not 0: never converted
  row('abc', 'รหัสไม่ใช่ตัวเลข', MOPH),
  row(21050, '', MOPH), // no name: ignored
  // enough "กรม" agencies that a search for it overflows the default limit of 8
  ...['หนึ่ง', 'สอง', 'สาม', 'สี่'].map((n, i) => row(9001 + i, `กรมทดสอบ${n}`, 'กระทรวงทดสอบ'))
];

function ckan(res: http.ServerResponse, result: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: status === 200, result }));
}

const ckanServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const action = url.pathname.split('/').pop() ?? '';
  requests.push({ action, params: url.searchParams });
  if (mode === 'down') return ckan(res, { message: 'boom' }, 500);

  if (action === 'package_show') {
    if (url.searchParams.get('id') !== MOF_PAYMENT_UNIT_DATASET) return ckan(res, { message: 'not found' }, 404);
    const active = mode !== 'no-queryable-resource';
    // the dictionary is listed FIRST on purpose: the real one is
    return ckan(res, {
      id: 'pkg',
      name: MOF_PAYMENT_UNIT_DATASET,
      title: 'x',
      resources: [
        { id: DICTIONARY, name: 'datadic_budget', format: 'XLSX', datastore_active: active },
        { id: DATA_XLSX, name: 'ข้อมูลหน่วยเบิกจ่าย', format: 'XLSX', datastore_active: active },
        { id: DATA_CSV, name: 'ข้อมูลหน่วยเบิกจ่าย', format: 'CSV', datastore_active: active }
      ]
    });
  }

  if (action === 'datastore_search') {
    const resource = url.searchParams.get('resource_id');
    if (resource === DICTIONARY) {
      return ckan(res, { total: 1, fields: [{ id: 'no', type: 'int' }, { id: 'name', type: 'text' }], records: [{ no: 1, name: 'attribute_1' }] });
    }
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const wanted = (url.searchParams.get('fields') ?? '').split(',').filter(Boolean);
    const source = mode === 'empty' ? [] : rows;
    const columns = mode === 'no-column' ? ['รหัสกรม', 'กรม'] : ['รหัสกรม', 'กรม', 'กระทรวง'];
    const page = source.slice(offset, offset + limit).map(r => {
      const out: Record<string, unknown> = {};
      for (const key of wanted.length ? wanted : columns) if (columns.includes(key)) out[key] = r[key];
      return out;
    });
    return ckan(res, { total: source.length, fields: columns.map(id => ({ id, type: 'text' })), records: page });
  }
  return ckan(res, { message: 'unknown action' }, 404);
});

// ------------------------------------------------------------------- fake e-GP RSS
const rssHits: string[] = [];
const rssServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const deptId = url.searchParams.get('deptId');
  rssHits.push(`${deptId}:${url.searchParams.get('anounceType')}`);
  const items = deptId === '0304' ? '<item><title>Procurement of test servers</title><link>https://x/y?projectId=1</link><description>1, test</description></item>' : '';
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`);
});

const listen = (server: http.Server) =>
  new Promise<string>(resolve => server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));

async function main(): Promise<void> {
  const ckanBase = await listen(ckanServer);
  const rssBase = await listen(rssServer);
  (env as { DATA_GO_TH_BASE_URL: string }).DATA_GO_TH_BASE_URL = ckanBase;
  (env as { EGP_RSS_BASE_URL: string }).EGP_RSS_BASE_URL = rssBase + '/egpannouncerss.xml';

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await GovSite.init();

  // ===================================================== the code conversion (pure)
  const conv = (c: unknown) => gfmisToDeptId(c);
  record(conv(21002) === '2102' && conv('21002') === '2102', 'code: 21002 (สป.สธ.) -> 2102, number or text');
  record(conv(21009) === '2109', 'code: 21009 (กรมอนามัย) -> 2109');
  record(conv(8006) === '0806' && conv('8006') === '0806' && conv('08006') === '0806', 'code: 8006 / "8006" / "08006" (กรมทางหลวง; the leading 0 is lost in the data) -> 0806');
  record(conv(3004) === '0304', 'code: 3004 (กรมบัญชีกลาง) -> 0304 (the team\'s [TEST] deptId)');
  record(conv(1002) === '0102' && conv(11006) === '1106', 'code: 1002 -> 0102, 11006 -> 1106');
  record(conv(21100) === null && conv(100) === null, 'code: a department part that does not start with 0 is not converted (never guessed)');
  record(conv('abc') === null && conv('') === null && conv(null) === null && conv(undefined) === null && conv(1234567) === null && conv(12) === null && conv('21 002') === null, 'code: non-numbers, empty, too long/short are refused');
  record(conv(' 21002 ') === '2102', 'code: surrounding spaces are ignored');
  record(cleanThaiName('กรมธนารีักษ์') === 'กรมธนารักษ์' && cleanThaiName('กรมวิทยาศาสตรี์การแพทย์') === 'กรมวิทยาศาสตร์การแพทย์' && cleanThaiName('เศรีษฐกิจ') === 'เศรษฐกิจ' && cleanThaiName('กระทรวงกลำโหม') === 'กระทรวงกลาโหม', 'names: the two systematic extraction typos are repaired');
  record(['สำนักงานปลัดกระทรวง', 'กรมประชาสัมพันธ์', 'กระทรวงศึกษาธิการ', 'กรมการปกครอง', 'กรมศุลกากร'].every(n => cleanThaiName(n) === n) && cleanThaiName('  a   b ') === 'a b' && cleanThaiName(5) === '', 'names: correct Thai is left alone; whitespace collapsed; non-text -> empty');

  // ==================================================================== the client
  requests.length = 0;
  const load = await fetchMofDepartments();
  const byId = new Map(load.departments.map(d => [d.deptId, d]));
  record(load.resourceId === DATA_CSV, 'client: picks the queryable CSV resource, not the data dictionary listed before it', load.resourceId);
  record(count('package_show') === 1 && requests.find(r => r.action === 'package_show')?.params.get('id') === MOF_PAYMENT_UNIT_DATASET, 'client: looks the resource up from the dataset name (a new resource id does not break it)');
  const dsCalls = requests.filter(r => r.action === 'datastore_search');
  record(dsCalls.length === 2 && (dsCalls[0].params.get('offset') ?? '0') === '0' && dsCalls[1].params.get('offset') === String(PAGE_SIZE), 'client: reads every page (5,000 rows each)', `${dsCalls.length} calls`);
  record(dsCalls.every(c => c.params.get('fields') === 'รหัสกรม,กรม,กระทรวง'), 'client: asks only for the three columns it needs');
  record(load.departments.length === 12, 'client: the right number of distinct departments', `${load.departments.length}`);
  record(load.skipped === 2, 'client: codes that do not fit (21100, "abc") are counted as skipped, not converted', `${load.skipped}`);
  record(byId.get('2102')?.name === 'สำนักงานปลัดกระทรวงสาธารณสุข', 'client: the most common spelling of a department wins', byId.get('2102')?.name);
  record(byId.get('0806')?.gfmisCode === '08006' && load.departments.filter(d => d.deptId === '0806').length === 1, 'client: 8006 and "08006" are one department');
  record(byId.get('0303')?.name === 'กรมธนารักษ์' && byId.get('0201')?.name === 'สำนักงานปลัดกระทรวงกลาโหม' && byId.get('0201')?.ministry === 'กระทรวงกลาโหม', 'client: typos in names and ministries are repaired');
  record(!byId.has('2150') && !load.departments.some(d => d.name === ''), 'client: a row with no name is ignored');

  for (const [broken, label] of [['no-column', 'a missing column'], ['no-queryable-resource', 'no queryable resource'], ['down', 'a server error']] as const) {
    mode = broken;
    let message = '';
    await fetchMofDepartments().catch(e => { message = String(e.message ?? e); });
    record(message.length > 0, `client: ${label} is reported as an error, not silently treated as an empty list`, message.slice(0, 90));
  }
  mode = 'ok';

  // ============================================================= the service (matching)
  resetDeptIdDirectoryCache();
  requests.length = 0;
  const T0 = Date.UTC(2026, 9, 28);
  const ask = (q: string, opts: { limit?: number; now?: number } = {}) => suggestDeptIds(q, { now: T0, ...opts });
  const ids = (r: Awaited<ReturnType<typeof ask>>) => r.suggestions.map(s => s.deptId);

  const byCode = await ask('2102');
  record(JSON.stringify(ids(byCode)) === '["2102"]' && byCode.suggestions[0].confidence === 'confirmed', 'match: a full code finds exactly that agency', JSON.stringify(ids(byCode)));
  record(byCode.directory.status === 'ok' && byCode.directory.agencies === 12, 'match: the directory state is reported (ok, 12 agencies)', JSON.stringify(byCode.directory));
  const prefix = await ask('21');
  record(JSON.stringify(ids(prefix)) === '["2102","2109"]', 'match: a code prefix lists the matching codes in ascending order', JSON.stringify(ids(prefix)));
  const byName = await ask('กรมทางหลวง');
  record(ids(byName)[0] === '0806' && ids(byName).includes('0807'), 'match: a Thai name finds the agency (and its look-alikes, best first)', JSON.stringify(ids(byName)));
  record(ids(await ask('ทางหลวง'))[0] === '0806' || ids(await ask('ทางหลวง')).includes('0806'), 'match: part of a name is enough');
  const ministry = await ask('สาธารณสุข');
  record(ids(ministry).includes('2102') && ids(ministry).includes('2109'), 'match: a ministry word finds its agencies', JSON.stringify(ids(ministry)));
  record(ids(await ask('ธนารักษ์')).includes('0303'), 'match: the repaired spelling of กรมธนารักษ์ is findable');
  record(ids(await ask('ธนารีักษ์')).includes('0303'), 'match: ...and so is the typo\'d spelling a person might copy from the dataset');
  record(ids(await ask('กรมประชาสัมพันธ')).includes('0102'), 'match: a Thai near-miss (one missing letter) still finds it');
  record(ids(await ask('กลาโหม')).includes('0201'), 'match: กลาโหม finds the agency whose source spelling was "กลำโหม"');
  record(ids(await ask('กรมบัญชีกลาง')).join() === '0304', 'match: กรมบัญชีกลาง -> 0304 (derived)');
  record((await ask('กรมบัญชีกลาง')).suggestions[0].confidence === 'derived', 'match: ...and it is marked derived, not confirmed');
  record(ids(await ask('highwayz')).length === 0 && ids(await ask('depb')).length === 0, 'match: a typo in a Latin query is NOT forgiven (a one-letter slip in "depa" is just another word)');
  record(ids(await ask('ทางหลวงง')).includes('0806'), 'match: a typo in a Thai query IS forgiven (the directory\'s own Thai has typos)');
  record(ids(await ask('ไม่มีหน่วยงานนี้')).length === 0, 'match: no match -> an empty list, not an error');
  record(ids(await ask('highways')).join() === '0806' && ids(await ask('MOPH')).join() === '2102', 'match: English name / short code of a verified agency (case-insensitive)', JSON.stringify(ids(await ask('MOPH'))));

  // verified agencies
  const known2109 = byId.get('2109') && (await ask('2109')).suggestions[0];
  record(known2109?.confidence === 'confirmed' && known2109.shortCode === 'DOH-health' && !!known2109.nameEn, 'known: a code that is both verified and in the directory is ONE suggestion, marked confirmed, with its clean details');
  const depa = await ask('depa');
  record(depa.suggestions[0]?.deptId === '1106' && depa.suggestions[0].confidence === 'confirmed', 'known: depa (1106) is suggested although the directory does not list it');
  record(KNOWN_AGENCIES.map(k => k.deptId).join() === '2102,0806,2109,1106' && ['MOPH', 'DOH-highway', 'DOH-health', 'depa'].every(code => fs.readFileSync(path.join(__dirname, '../../src/scripts/seedGovSites.ts'), 'utf8').includes(`shortCode: '${code}'`)), 'known: the built-in list is the same four agencies as the seed script');
  const confirmedFirst = await ask('กรม');
  record(confirmedFirst.suggestions.length === 8 && confirmedFirst.suggestions.every(s => s.name.length > 0), 'match: the default limit is 8 results', `${confirmedFirst.suggestions.length}`);
  record((await ask('กรม', { limit: 3 })).suggestions.length === 3, 'match: a smaller limit is respected');
  record(!JSON.stringify(byName).includes('haystack'), 'match: internal search text is not leaked in the result');

  // nothing to search on
  const before = requests.length;
  const tiny = await ask('ก');
  const blank = await ask('   ');
  record(tiny.suggestions.length === 0 && blank.suggestions.length === 0 && requests.length === before, 'match: a one-letter or blank query returns nothing and costs no request');

  // already added
  await GovSite.create({ name: 'กรมทางหลวง', shortCode: 'DOH', deptId: '0806' });
  await GovSite.create({ name: 'บัญชีกลาง', shortCode: 'CGD', deptId: '0304' });
  const added = await ask('กรมทางหลวง');
  const doh = added.suggestions.find(s => s.deptId === '0806');
  record(doh?.alreadyAdded?.shortCode === 'DOH' && doh.alreadyAdded.name === 'กรมทางหลวง' && !!doh.alreadyAdded.siteId, 'added: an agency that already has a site is flagged, with that site');
  record(added.suggestions.find(s => s.deptId === '0807')?.alreadyAdded === undefined, 'added: ...and one that does not is not');
  record((await ask('0304')).suggestions[0]?.alreadyAdded?.shortCode === 'CGD', 'added: a derived suggestion is flagged too');

  // ================================================================ cache & failures
  resetDeptIdDirectoryCache();
  requests.length = 0;
  await Promise.all([ask('21'), ask('กรม'), ask('0806'), ask('สาธารณสุข'), ask('2109')]);
  record(count('package_show') === 1, 'cache: five searches at once load the directory once', `${count('package_show')} package_show`);
  const afterFirst = requests.length;
  await ask('กรมอนามัย');
  await ask('0102');
  record(requests.length === afterFirst, 'cache: later searches are answered from memory (no request)');
  await ask('21', { now: T0 + DIRECTORY_TTL_MS - 1000 });
  record(requests.length === afterFirst, 'cache: still used just before the day is up');
  await ask('21', { now: T0 + DIRECTORY_TTL_MS + 1000 });
  record(count('package_show') === 2, 'cache: refreshed once it is a day old');

  // refresh fails -> keep serving the last good copy
  mode = 'down';
  const later = T0 + 3 * DIRECTORY_TTL_MS;
  const stale = await ask('กรมประชาสัมพันธ์', { now: later });
  record(stale.directory.status === 'stale' && ids(stale).join() === '0102' && !!stale.directory.error, 'failure: a failed refresh keeps serving the last good copy, marked stale', JSON.stringify(stale.directory));
  const callsAfterFailure = requests.length;
  await ask('21', { now: later + 1000 });
  record(requests.length === callsAfterFailure, 'failure: it does not retry on every keystroke (backs off)');
  mode = 'ok';
  const recovered = await ask('21', { now: later + DIRECTORY_RETRY_AFTER_MS + 1000 });
  record(recovered.directory.status === 'ok' && ids(recovered).length === 2, 'failure: after the back-off it loads again and recovers');

  // never loaded and down -> the verified agencies still work
  resetDeptIdDirectoryCache();
  mode = 'down';
  const down = await ask('กรมอนามัย');
  record(down.directory.status === 'unavailable' && ids(down).join() === '2109' && down.suggestions[0].confidence === 'confirmed', 'failure: with the directory unreachable, the verified agencies are still suggested', JSON.stringify(down.directory));
  record(ids(await ask('กรมบัญชีกลาง')).length === 0 && (await ask('กรมบัญชีกลาง')).directory.status === 'unavailable', 'failure: ...and the rest is honestly reported as unavailable, not as "no such agency"');
  for (const broken of ['no-column', 'empty', 'no-queryable-resource'] as const) {
    resetDeptIdDirectoryCache();
    mode = broken;
    const r = await ask('2102');
    record(r.directory.status === 'unavailable' && ids(r).join() === '2102', `failure: ${broken} -> unavailable, verified agencies still work, no crash`, r.directory.error?.slice(0, 80));
  }
  mode = 'ok';
  resetDeptIdDirectoryCache();

  // ===================================================================== HTTP
  const mkAccount = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const superAdmin = await mkAccount('super@example.com', 'superadmin');
  const admin = await mkAccount('admin@example.com', 'admin', { permissions: ['poll&tag:manage'] });
  const user = await mkAccount('user@example.com', 'user');
  const cookie = async (a: { _id: unknown }) => `${SESSION_COOKIE_NAME}=${(await createSession(a._id as never, {})).rawToken}`;
  const [superCookie, adminCookie, userCookie] = [await cookie(superAdmin), await cookie(admin), await cookie(user)];

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/admin/gov-sites`;
  async function call(method: string, p: string, opts: { cookie?: string; body?: unknown } = {}) {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  const q = (text: string, extra = '') => `/dept-id-suggestions?q=${encodeURIComponent(text)}${extra}`;

  record((await call('GET', q('2102'))).status === 401, 'HTTP: not signed in -> 401');
  record((await call('GET', q('2102'), { cookie: userCookie })).status === 403, 'HTTP: a regular user -> 403');
  const asAdmin = await call('GET', q('2102'), { cookie: adminCookie });
  record(asAdmin.status === 403, 'HTTP: a plain Admin -> 403 (source configuration is Super Admin only, like the form)', `${asAdmin.status}`);
  const ok = await call('GET', q('กรมทางหลวง'), { cookie: superCookie });
  record(ok.status === 200 && ok.json.success === true && Array.isArray(ok.json.data.suggestions) && ok.json.data.query === 'กรมทางหลวง' && ok.json.data.directory.status === 'ok', 'HTTP: Super Admin gets suggestions in the standard envelope', `${ok.status}`);
  const first = ok.json.data.suggestions[0];
  record(first.deptId === '0806' && first.name === 'กรมทางหลวง' && first.confidence === 'confirmed' && first.alreadyAdded.shortCode === 'DOH', 'HTTP: each suggestion carries deptId, name, confidence and the already-added site');
  record((await call('GET', q('2102', '&limit=1'), { cookie: superCookie })).json.data.suggestions.length === 1, 'HTTP: limit works as a query parameter (coerced from text)');
  for (const [bad, label] of [['/dept-id-suggestions', 'no q'], ['/dept-id-suggestions?q=', 'empty q'], [q('x'.repeat(101)), 'q over 100 characters'], [q('21', '&limit=0'), 'limit 0'], [q('21', '&limit=21'), 'limit 21'], [q('21', '&limit=abc'), 'limit not a number'], [q('21', '&evil=1'), 'an unknown parameter']] as const) {
    const r = await call('GET', bad, { cookie: superCookie });
    record(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', `HTTP: ${label} -> 400 VALIDATION_ERROR`, `${r.status}`);
  }
  record((await call('GET', q('ก'), { cookie: superCookie })).json.data.suggestions.length === 0, 'HTTP: a one-letter query is accepted and simply returns nothing');
  const route = await call('GET', '', { cookie: superCookie });
  record(route.status === 200 && Array.isArray(route.json.data), 'HTTP: the site list route next to it is unaffected');

  // The full flow an admin goes through: type -> pick -> verify live -> add.
  const typed = await call('GET', q('บัญชี'), { cookie: superCookie });
  const picked = typed.json.data.suggestions.find((s: any) => s.deptId === '0304');
  record(!!picked && picked.alreadyAdded?.shortCode === 'CGD', 'flow: typing "บัญชี" offers กรมบัญชีกลาง (0304)', JSON.stringify(typed.json.data.suggestions.map((s: any) => s.deptId)));
  await GovSite.deleteOne({ deptId: '0304' });
  const pickedFresh = (await call('GET', q('บัญชี'), { cookie: superCookie })).json.data.suggestions.find((s: any) => s.deptId === '0304');
  record(pickedFresh && pickedFresh.alreadyAdded === undefined, 'flow: once not added, the same suggestion is offered as addable');
  const verify = await call('POST', '/verify-dept-id', { cookie: superCookie, body: { deptId: pickedFresh.deptId } });
  record(verify.status === 200 && verify.json.data.verified === true && rssHits.some(h => h.startsWith('0304:')), 'flow: the suggested code goes to the existing live e-GP check, which confirms it', JSON.stringify(verify.json.data?.results?.map((r: any) => r.itemCount)));
  const wrong = await call('POST', '/verify-dept-id', { cookie: superCookie, body: { deptId: '9999' } });
  record(wrong.status === 200 && wrong.json.data.verified === false, 'flow: a code the live feed does not know is reported as not verified (suggestions never replace this check)');
  const create = await call('POST', '', { cookie: superCookie, body: { name: pickedFresh.name, shortCode: 'CGD2', deptId: pickedFresh.deptId } });
  record(create.status === 201 && create.json.data.deptId === '0304', 'flow: the site is created with the suggested deptId', `${create.status}`);
  const again = await call('GET', q('บัญชีกลาง'), { cookie: superCookie });
  record(again.json.data.suggestions.find((s: any) => s.deptId === '0304')?.alreadyAdded?.shortCode === 'CGD2', 'flow: afterwards the suggestion shows as already added');
  const dupe = await call('POST', '', { cookie: superCookie, body: { name: 'x', shortCode: 'CGD3', deptId: '0304' } });
  record(dupe.status === 409, 'flow: adding the same deptId again is still refused by the server (the flag is a convenience, not the guard)', `${dupe.status}`);

  // ===================================================================== wiring
  const routes = fs.readFileSync(path.join(__dirname, '../../src/routes/govSite.routes.ts'), 'utf8');
  const line = routes.split('\n').find(l => l.includes('/dept-id-suggestions')) ?? '';
  record(line.includes('requireSuperAdmin') && line.includes("'query'"), 'source: the route is Super-Admin-only and validates its query');

  server.close();
  ckanServer.close();
  rssServer.close();
  console.log(results.join('\n'));
  const failures = results.filter(l => l.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
