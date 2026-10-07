import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';

// Integration check for the Thai typo-tolerant search (feature/search-system)
// working TOGETHER with the procurement-method tags, fiscal year and deadline
// sort (feature/data-polling):
//   A. ingestion saves a method tag AND the normalized searchText on a new work;
//   B. the method / category / fiscal-year / deadline filters combine with a
//      typo-tolerant Thai query (the two features share one query);
//   C. saving tags from the admin screen, and a later poll, never damage
//      searchText or undo a tag an admin removed;
//   D. works that predate both features are brought up by the two backfills.
// A local server stands in for e-GP and the AI provider -- nothing real is called.
// Run: npm run check:search-tags   (needs a MongoDB; see MONGODB_URI)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check".
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-search-tags-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI; // set BEFORE the app modules read env

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

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

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
// "27 ตุลาคม 2569" (Buddhist year, Thailand's calendar day) for a date.
function thaiDate(date: Date): string {
  const t = new Date(date.getTime() + 7 * 3600_000);
  return `${t.getUTCDate()} ${TH_MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear() + 543}`;
}
const UPCOMING = new Date(Date.now() + 20 * 24 * 3600_000);

const invitationPage = (title: string, withDate: boolean): string =>
  `${'\n'.repeat(200)}<html><head><meta http-equiv="Content-Type" content="text/html; charset=TIS-620"></head><body>` +
  `<div>ประกาศจังหวัดทดสอบ</div><div>เรื่อง ${title}</div><hr>` +
  `<p>จังหวัดทดสอบ มีความประสงค์จะประกวดราคาตามรายการดังนี้ ราคากลางของงานในการประกวดราคาครั้งนี้ เป็นเงินทั้งสิ้น ๑,๒๕๐,๐๐๐.๐๐ บาท</p>` +
  `<p>๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ${withDate ? `${thaiDate(UPCOMING)} ระหว่างเวลา 09.00 น. ถึง 12.00 น.` : ''} ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา</p>` +
  `<p>๓. ผู้สนใจสามารถดูรายละเอียดและดาวน์โหลดเอกสาร</p></body></html>`;

const winnerPage = (title: string): string =>
  `${'\n'.repeat(200)}<html><head><meta http-equiv="Content-Type" content="text/html; charset=TIS-620"></head><body>` +
  `<div>เรื่อง ประกาศผู้ชนะการเสนอราคา ${title}</div><hr>` +
  `<p>ผู้ได้รับการคัดเลือก ได้แก่ ห้างหุ้นส่วนจำกัด ทดสอบ โดยเสนอราคาเป็นเงินทั้งสิ้น ๙๖,๐๐๐.๐๐ บาท ( เก้าหมื่นหกพันบาทถ้วน ) รวมภาษีมูลค่าเพิ่ม</p></body></html>`;

const pages = new Map<string, string>();
const feed: Record<string, { id: string; title: string }[]> = {};
let serverPort = 0;
const pageUrl = (id: string): string =>
  `http://127.0.0.1:${serverPort}/egp2procmainWeb/jsp/procsearch.sch?servlet=gojsp&proc_id=ShowHTMLFile&processFlows=Procure&projectId=${id}&templateType=W2&temp_Announ=A&temp_itemNo=0&seqNo=1`;

function rssXml(type: string): Buffer {
  const items = (feed[type] ?? [])
    .map(
      it =>
        `<item><title>${it.title}</title><link>${pageUrl(it.id).replace(/&/g, '&amp;')}</link>` +
        `<description>${it.id}, ${it.title}</description><pubDate>Tue, 30 Sep 2025 10:00:00 +0700</pubDate></item>`
    )
    .join('');
  return encodeTis620(`<?xml version="1.0" encoding="windows-874"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>${items}</channel></rss>`);
}

function startServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return void res.end(rssXml(url.searchParams.get('anounceType') ?? ''));
    }
    if (url.pathname === '/ai/v1/chat/completions') {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ description: 'สรุปโครงการโดย AI จำลอง', tagIds: [], budget: null, newTag: null }) } }] }));
    }
    if (url.pathname === '/egp2procmainWeb/jsp/procsearch.sch') {
      const html = pages.get(url.searchParams.get('projectId') ?? '');
      if (html === undefined) {
        res.writeHead(404);
        return void res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=TIS-620' });
      return void res.end(encodeTis620(html));
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Runs a backend script the way an operator would (a separate process, the real entry point).
function runScript(script: string): string {
  const backendDir = path.resolve(__dirname, '..', '..');
  const tsxCli = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return execFileSync(process.execPath, [tsxCli, script], { cwd: backendDir, env: { ...process.env, MONGODB_URI }, encoding: 'utf8' });
}

async function main(): Promise<void> {
  const egp = await startServer();
  serverPort = (egp.address() as { port: number }).port;
  process.env.EGP_RSS_BASE_URL = `http://127.0.0.1:${serverPort}/EPROCRssFeedWeb/egpannouncerss.xml`;
  process.env.AI_TAGGING_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${serverPort}/ai/v1`;

  const { env } = await import('../../src/config/env');
  const { createApp } = await import('../../src/app');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');
  const { Tag } = await import('../../src/models/tag.model');
  const { Account } = await import('../../src/models/account.model');
  const { SESSION_COOKIE_NAME } = await import('../../src/config/cookie');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const { runRssPoll } = await import('../../src/services/ingestion.service');
  const { normalizeThaiSearchText } = await import('../../src/utils/thaiSearch');
  env.EGP_HTML_TOR_ENABLED = true;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite.syncIndexes(), Work.syncIndexes(), Tag.syncIndexes()]);

  const app = createApp();
  const api = app.listen(0);
  await new Promise<void>(resolve => api.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(api.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: any; setCookie: string | null }> {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') };
  }
  const q = (text: string): string => encodeURIComponent(text);

  const site = await createGovSite({ name: 'ทดสอบค้นหา', shortCode: 'SRCH', deptId: '9200', announceTypes: ['D0', 'W0'], requestsPerMinute: 600 });
  const construction = await Tag.create({ name: 'งานก่อสร้างและโยธา', facet: 'category', aliases: ['ก่อสร้าง'] });
  await Account.create({ email: 'tagadmin@example.com', passwordHash: 'Password123', name: 'Tag Admin', type: 'individual', status: 'active', role: 'admin', permissions: ['tag:manage'] });
  const login = await call('POST', '/auth/login', undefined, { email: 'tagadmin@example.com', password: 'Password123' });
  const cookie = login.setCookie?.split(';')[0] ?? '';
  record(cookie.startsWith(`${SESSION_COOKIE_NAME}=`), 'a tag admin can sign in');

  // ============================================================ A. ingestion saves the tag AND the search text
  const A = { id: '69099500001', title: 'ประกวดราคาจ้างก่อสร้างถนนคอนกรีตเสริมเหล็ก ปีงบประมาณ พ.ศ. ๒๕๖๙ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' };
  const B = { id: '69109500002', title: 'จ้างก่อสร้างสะพานคนเดินข้ามคลอง โดยวิธีเฉพาะเจาะจง' }; // registered in Oct => FY2570 estimated
  const C = { id: '69099500003', title: 'ซื้อวัสดุสำนักงานสำหรับกองคลัง โดยวิธีเฉพาะเจาะจง' };
  pages.set(A.id, invitationPage(A.title, true));
  pages.set(B.id, invitationPage(B.title, false));
  pages.set(C.id, winnerPage(C.title));
  feed.D0 = [A, B];
  feed.W0 = [C];
  const run = await runRssPoll(site, 'scheduler');
  record(run.status === 'success' && run.newCount === 3, 'the poll creates the 3 works', `${run.status} new=${run.newCount} ${run.errorLog.join('|')}`);

  const loadWork = (projectId: string) => Work.findOne({ projectId }).select('+searchText').populate('tags', 'name facet');
  const methodOf = (w: Awaited<ReturnType<typeof loadWork>>): string[] => (w?.tags as unknown as { name: string; facet: string }[]).filter(t => t.facet === 'method').map(t => t.name);
  const wA = await loadWork(A.id);
  const wB = await loadWork(B.id);
  const wC = await loadWork(C.id);

  record(methodOf(wA).join() === 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' && methodOf(wB).join() === 'วิธีเฉพาะเจาะจง' && methodOf(wC).join() === 'วิธีเฉพาะเจาะจง', 'ingestion saves the method tag on each new work', [wA, wB, wC].map(w => methodOf(w).join()).join(' | '));
  record(
    !!wA?.searchText && wA.searchText === normalizeThaiSearchText(`${wA.title}\n${wA.description ?? ''}`),
    'the same new work also has its normalized searchText saved (from title + the AI description)',
    JSON.stringify(wA?.searchText?.slice(0, 40))
  );
  record(wA?.fiscalYear === 2569 && wA?.fiscalYearSource === 'document' && wB?.fiscalYear === 2570 && wB?.fiscalYearSource === 'estimated', 'fiscal years: stated 2569 for A, estimated 2570 for B', `${wA?.fiscalYear}/${wA?.fiscalYearSource} ${wB?.fiscalYear}/${wB?.fiscalYearSource}`);
  record(!!wA?.deadlineAt && wA.deadlineAt.getTime() > Date.now() && !wB?.deadlineAt, 'A has an upcoming deadline; B (blank form) has none');

  const ebid = (await Tag.findOne({ facet: 'method', name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' }))!;
  const specific = (await Tag.findOne({ facet: 'method', name: 'วิธีเฉพาะเจาะจง' }))!;
  const ids = (json: any): string[] => json.data.items.map((i: any) => i.projectId).sort();

  // ============================================================ B. one query: typo-tolerant search + the new filters
  const TYPO_ROAD = 'ก่อส้างถนน'; // "ก่อสร้างถนน" with the ร missing
  const TYPO_BRIDGE = 'ก่อส้างสะพาน';
  let r = await call('GET', `/works?q=${q('ก่อสร้างถนน')}&pageSize=50`);
  record(ids(r.json).join() === A.id, 'exact Thai search finds the work', ids(r.json).join());
  r = await call('GET', `/works?q=${q(TYPO_ROAD)}&pageSize=50`);
  record(ids(r.json).join() === A.id, 'a typo ("ก่อส้างถนน") is still found through searchText', ids(r.json).join());
  r = await call('GET', `/works?q=${q('ก่อสร้าง')}&pageSize=50`);
  record(ids(r.json).join() === [A.id, B.id].sort().join(), 'a broad term finds both construction works', ids(r.json).join());

  r = await call('GET', `/works?tag=${specific._id}&pageSize=50`);
  record(ids(r.json).join() === [B.id, C.id].sort().join(), 'the method filter alone: the two เฉพาะเจาะจง works', ids(r.json).join());
  r = await call('GET', `/works?q=${q(TYPO_BRIDGE)}&tag=${specific._id}&pageSize=50`);
  record(ids(r.json).join() === B.id, 'typo search + method filter: the matching work', ids(r.json).join());
  r = await call('GET', `/works?q=${q(TYPO_BRIDGE)}&tag=${ebid._id}&pageSize=50`);
  record(r.json.data.total === 0, 'typo search + the OTHER method: nothing (the method filter really narrows)');
  r = await call('GET', `/works?q=${q('ก่อสร้าง')}&fiscalYear=2570&pageSize=50`);
  record(ids(r.json).join() === B.id, 'search + fiscal year (the estimated one): only B', ids(r.json).join());
  r = await call('GET', `/works?q=${q('ก่อสร้าง')}&fiscalYear=2569&pageSize=50`);
  record(ids(r.json).join() === A.id, 'search + fiscal year (the stated one): only A', ids(r.json).join());
  r = await call('GET', `/works?q=${q('ก่อสร้าง')}&sort=deadline&pageSize=50`);
  record(r.json.data.items.map((i: any) => i.projectId).join() === [A.id, B.id].join(), 'search + sort=deadline: the work with the upcoming deadline first, then the rest', r.json.data.items.map((i: any) => i.projectId).join());
  const detail = await call('GET', `/works/${wA!._id}`);
  record(detail.json.data.searchText === undefined && detail.json.data.deadlineAt && detail.json.data.fiscalYear === 2569, 'the API never leaks searchText, and still returns the new fields');

  // ============================================================ C. saving tags from the admin screen
  const siteTag = (await Tag.findOne({ facet: 'site', siteId: site._id }))!;
  const searchTextBefore = wA!.searchText;
  let put = await call('PUT', `/admin/works/${wA!._id}/tags`, cookie, { tagIds: [siteTag._id, ebid._id, construction._id] });
  record(put.status === 200, 'admin saves a category tag on a work (PUT /admin/works/:id/tags)', String(put.status));
  const afterTag = await loadWork(A.id);
  record(afterTag?.searchText === searchTextBefore, "saving tags leaves the work's searchText exactly as it was", JSON.stringify(afterTag?.searchText?.slice(0, 30)));
  r = await call('GET', `/works?q=${q(TYPO_ROAD)}&tag=${construction._id},${ebid._id}&pageSize=50`);
  record(ids(r.json).join() === A.id, 'the admin-saved category + the method + a typo query: found (facet AND)', ids(r.json).join());
  r = await call('GET', `/works?tag=${construction._id}&pageSize=50`);
  record(ids(r.json).join() === A.id, 'the freshly-saved tag is immediately filterable', ids(r.json).join());

  // The natural way to write a tag edit is "load only the tag fields, change them, save()". The searchText
  // hook must not rebuild the text from the title/description it never loaded ("undefined\n").
  const partial = await Work.findById(wA!._id).select('tags excludedTags ingestionRelevance');
  partial!.ingestionRelevance = 'shown';
  await partial!.save();
  const afterPartial = await loadWork(A.id);
  record(afterPartial?.searchText === searchTextBefore, 'saving a work loaded with only its tag fields does NOT clobber searchText', JSON.stringify(afterPartial?.searchText?.slice(0, 30)));
  r = await call('GET', `/works?q=${q(TYPO_ROAD)}&pageSize=50`);
  record(ids(r.json).join() === A.id, '...and the work is still found by the typo query afterwards', ids(r.json).join());

  // the admin removes the method tag; a later lifecycle update must not put it back
  put = await call('PUT', `/admin/works/${wA!._id}/tags`, cookie, { tagIds: [siteTag._id, construction._id] });
  r = await call('GET', `/works?tag=${ebid._id}&pageSize=50`);
  record(put.status === 200 && r.json.data.total === 0, 'admin removes the method tag: the method filter no longer returns the work');
  pages.set(A.id, winnerPage(A.title));
  feed.W0 = [C, A];
  await runRssPoll(site, 'scheduler');
  const afterPoll = await loadWork(A.id);
  record(afterPoll?.status === 'AWARDED', 'a later poll moves A to AWARDED (a lifecycle update ran)', afterPoll?.status);
  record(methodOf(afterPoll).length === 0, 'the removed method tag is NOT re-added by that update (excludedTags honoured)', methodOf(afterPoll).join());
  record(
    !!afterPoll?.searchText && afterPoll.searchText === normalizeThaiSearchText(`${afterPoll.title}\n${afterPoll.description ?? ''}`),
    'searchText is still the correct normalized text after the update save'
  );
  r = await call('GET', `/works?q=${q(TYPO_ROAD)}&pageSize=50`);
  record(ids(r.json).join() === A.id, 'the typo search still finds A after everything', ids(r.json).join());

  // put it back by hand
  put = await call('PUT', `/admin/works/${wA!._id}/tags`, cookie, { tagIds: [siteTag._id, construction._id, ebid._id] });
  r = await call('GET', `/works?tag=${ebid._id},${construction._id}&pageSize=50`);
  record(put.status === 200 && ids(r.json).join() === A.id, 'admin puts the method tag back: filterable again');

  // ============================================================ D. works that predate both features
  // Inserted RAW (no hook, no searchText, no method tag, no fiscal year), like the rows already in a live database.
  const legacyTitle = 'ประกวดราคาจ้างก่อสร้างอาคารเรียนหลังเก่า ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)';
  const now = new Date();
  await Work.collection.insertOne({
    siteId: site._id,
    projectId: '69099500099',
    title: legacyTitle,
    status: 'BIDDING',
    announceType: 'D0',
    pubDate: now,
    torFiles: [],
    statusHistory: [],
    tags: [],
    excludedTags: [],
    createdAt: now,
    updatedAt: now
  });
  r = await call('GET', `/works?q=${q('ก่อสร้างอาคารเรียน')}&pageSize=50`);
  record(ids(r.json).includes('69099500099'), 'before the backfill, a legacy work is still found by an exact query (title fallback)');
  r = await call('GET', `/works?q=${q('ก่อส้างอาคารเรียน')}&pageSize=50`);
  record(!ids(r.json).includes('69099500099'), 'before the backfill, a TYPO does not reach it (no searchText yet)');
  r = await call('GET', `/works?tag=${ebid._id}&pageSize=50`);
  record(!ids(r.json).includes('69099500099'), 'before the facts backfill, it has no method tag, so the method filter misses it');

  runScript('src/scripts/backfillSearchText.ts');
  runScript('src/scripts/backfillProcurementFacts.ts');
  r = await call('GET', `/works?q=${q('ก่อส้างอาคารเรียน')}&pageSize=50`);
  record(ids(r.json).includes('69099500099'), 'after backfill:search-text, the typo query reaches it');
  r = await call('GET', `/works?q=${q('ก่อส้างอาคารเรียน')}&tag=${ebid._id}&fiscalYear=2569&pageSize=50`);
  record(ids(r.json).join() === '69099500099', 'after backfill:facts too: typo search + method + fiscal year all match the legacy work', ids(r.json).join());
  const legacyAfter = await Work.findOne({ projectId: '69099500099' }).select('+searchText');
  record(legacyAfter?.searchText === normalizeThaiSearchText(legacyTitle + '\n'), 'the facts backfill (updateOne) did not disturb the searchText the other backfill wrote');
  const sweepAgain = await call('GET', `/works?q=${q('ก่อสร้างถนน')}&pageSize=50`);
  record(ids(sweepAgain.json).join() === A.id, 'the other works are unaffected by the backfills', ids(sweepAgain.json).join());

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  api.close();
  egp.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
