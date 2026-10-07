import http from 'node:http';
import mongoose from 'mongoose';

// End-to-end check of the procurement method / fiscal year / bid deadline
// through the REAL ingestion pipeline (runRssPoll): a local server stands in
// for the e-GP RSS feed and its announcement pages, the AI provider is a stub.
// Run: npm run check:facts-ingestion   (needs a MongoDB; see MONGODB_URI)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". Every network call goes to the local
// server started here -- the real e-GP site and any real AI provider are never
// contacted, whatever is in Backend/.env.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-ingestion-facts-check';
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

// e-GP serves Windows-874 (TIS-620); Node can only decode it, so the test server encodes by hand.
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

const BID_SENTENCE =
  'ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๕ ตุลาคม ๒๕๖๘ ' +
  'ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา';

// An invitation announcement as an e-GP HTML page (TIS-620, lots of blank lines first).
const invitationPage = (title: string, withDate: boolean): string =>
  `${'\n'.repeat(200)}<html><head><meta http-equiv="Content-Type" content="text/html; charset=TIS-620"><title>ประกาศเชิญชวน</title></head><body>` +
  `<div>ประกาศจังหวัดทดสอบ</div><div>เรื่อง ${title}</div><hr>` +
  `<p>จังหวัดทดสอบ มีความประสงค์จะประกวดราคาซื้อครุภัณฑ์สำนักงาน ตามรายการดังนี้ ราคากลางของงานในการประกวดราคาครั้งนี้ เป็นเงินทั้งสิ้น ๑,๒๕๐,๐๐๐.๐๐ บาท</p>` +
  `<p>๑. ผู้ยื่นข้อเสนอจะต้องมีคุณสมบัติให้เป็นไปตามเอกสารประกวดราคาอิเล็กทรอนิกส์กำหนด</p>` +
  `<p>๒. ${withDate ? BID_SENTENCE : 'ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ระหว่างเวลา น. ถึง น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา'}</p>` +
  `<p>๓. ผู้สนใจสามารถดูรายละเอียดและดาวน์โหลดเอกสาร ผ่านทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ ได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา</p>` +
  `<p>ประกาศ ณ วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๘</p></body></html>`;

const winnerPage = (title: string): string =>
  `${'\n'.repeat(200)}<html><head><meta http-equiv="Content-Type" content="text/html; charset=TIS-620"></head><body>` +
  `<div>ประกาศจังหวัดทดสอบ</div><div>เรื่อง ประกาศผู้ชนะการเสนอราคา ${title}</div><hr>` +
  `<p>ผู้ได้รับการคัดเลือก ได้แก่ ห้างหุ้นส่วนจำกัด ทดสอบ โดยเสนอราคาเป็นเงินทั้งสิ้น ๙๖,๐๐๐.๐๐ บาท ( เก้าหมื่นหกพันบาทถ้วน ) รวมภาษีมูลค่าเพิ่มและภาษีอื่นทั้งปวง</p>` +
  `<p>ประกาศ ณ วันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๘</p></body></html>`;

const pages = new Map<string, string>(); // projectId -> html
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
      return void res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ description: 'สรุปโดย AI จำลอง', tagIds: [], budget: null, newTag: null }) } }] }));
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

async function main(): Promise<void> {
  const server = await startServer();
  serverPort = (server.address() as { port: number }).port;
  process.env.EGP_RSS_BASE_URL = `http://127.0.0.1:${serverPort}/EPROCRssFeedWeb/egpannouncerss.xml`;
  process.env.AI_TAGGING_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${serverPort}/ai/v1`;

  const { env } = await import('../../src/config/env');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');
  const { Tag } = await import('../../src/models/tag.model');
  const { Account } = await import('../../src/models/account.model');
  const { Follow } = await import('../../src/models/follow.model');
  const { Notification } = await import('../../src/models/notification.model');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const { runRssPoll } = await import('../../src/services/ingestion.service');
  env.EGP_HTML_TOR_ENABLED = true;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite.syncIndexes(), Work.syncIndexes(), Tag.syncIndexes(), Notification.syncIndexes(), Follow.syncIndexes()]);

  const site = await createGovSite({ name: 'ทดสอบข้อเท็จจริง', shortCode: 'FACTS', deptId: '9100', announceTypes: ['D0', 'W0'], requestsPerMinute: 600 });
  const poll = (): ReturnType<typeof runRssPoll> => runRssPoll(site, 'scheduler');

  // A vendor who follows the e-bidding METHOD (the tag exists before any work does, as seeded).
  const ebidTag = await Tag.create({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method', aliases: ['e-bidding'] });
  const vendor = await Account.create({ email: 'vendor@example.com', passwordHash: 'Password123', name: 'Vendor', type: 'individual', status: 'active', role: 'user' });
  await Follow.create({ accountId: vendor._id, tagId: ebidTag._id });

  // 1. an invitation (D0) with a real bid window, a fiscal year in the title, an e-bidding title
  const TITLE_A = 'ประกวดราคาซื้อครุภัณฑ์สำนักงาน ปีงบประมาณ พ.ศ. ๒๕๖๙ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)';
  pages.set('69099400001', invitationPage(TITLE_A, true));
  // 2. an invitation whose form is blank (a draft) -- no deadline, but method + year still come from the title
  const TITLE_B = 'ประกวดราคาซื้อวัสดุ ปีงบประมาณ พ.ศ. ๒๕๗๐ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)';
  pages.set('69099400002', invitationPage(TITLE_B, false));
  feed.D0 = [
    { id: '69099400001', title: TITLE_A },
    { id: '69099400002', title: TITLE_B }
  ];
  // 3. a winner announcement (W0): the method is in its title, no deadline applies
  const TITLE_C = 'จ้างซ่อมแซมอาคารสำนักงาน โดยวิธีเฉพาะเจาะจง';
  pages.set('69099400003', winnerPage(TITLE_C));
  feed.W0 = [{ id: '69099400003', title: TITLE_C }];

  const run = await poll();
  record(run.status === 'success' && run.newCount === 3, 'the poll creates the 3 works', `${run.status} new=${run.newCount} failed=${run.failedCount} ${run.errorLog.join('|')}`);

  const a = await Work.findOne({ projectId: '69099400001' }).populate('tags', 'name facet');
  const tagNames = (w: typeof a): string[] => (w?.tags as unknown as { name: string; facet: string }[]).filter(t => t.facet === 'method').map(t => t.name);
  record(!!a && !!a.deadlineAt && a.deadlineHasTime === true, 'D0 with a filled bid sentence: the deadline is stored on the work', String(a?.deadlineAt));
  record(
    a?.deadlineAt?.toISOString() === '2025-10-25T05:00:00.000Z' && a?.deadlineStartAt?.toISOString() === '2025-10-25T02:00:00.000Z',
    '...as real Dates: window 09:00-12:00 Thailand time = 02:00-05:00 UTC',
    `${a?.deadlineStartAt?.toISOString()} -> ${a?.deadlineAt?.toISOString()}`
  );
  record(a?.fiscalYear === 2569 && a?.fiscalYearSource === 'document', 'the fiscal year in the title is stored as a document-sourced year', `${a?.fiscalYear}/${a?.fiscalYearSource}`);
  record(
    tagNames(a).join() === 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' &&
      (await Tag.countDocuments({ facet: 'method', name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' })) === 1 &&
      String((a?.tags as unknown as { _id: unknown; facet: string }[]).find(t => t.facet === 'method')?._id) === String(ebidTag._id),
    'the e-bidding method tag is assigned (the pre-existing tag is reused, not duplicated)',
    tagNames(a).join()
  );
  record(a?.budget === 1250000, 'the price extraction still works alongside', String(a?.budget));

  const b = await Work.findOne({ projectId: '69099400002' }).populate('tags', 'name facet');
  record(b?.deadlineAt === undefined, 'D0 with a BLANK form: no deadline (never guessed)');
  record(b?.fiscalYear === 2570 && b?.fiscalYearSource === 'document' && tagNames(b).length === 1, 'blank form: year (2570, from the title) and method still come through', `${b?.fiscalYear}`);

  const c = await Work.findOne({ projectId: '69099400003' }).populate('tags', 'name facet');
  record(tagNames(c).join() === 'วิธีเฉพาะเจาะจง', 'W0 winner: the method comes from its title (and the tag is created on demand)', tagNames(c).join());
  record(c?.fiscalYear === 2569 && c?.fiscalYearSource === 'estimated', 'W0 with no year stated: estimated from the project number, flagged as an estimate', `${c?.fiscalYear}/${c?.fiscalYearSource}`);
  record(c?.deadlineAt === undefined, 'a winner announcement carries no deadline');

  // the follower of the e-bidding method hears about the two e-bidding works (and not the specific-method one)
  const notes = await Notification.find({ accountId: vendor._id });
  const notedTitles = notes.map(n => n.workTitle).sort();
  record(notes.length === 2 && notedTitles.join() === [TITLE_A, TITLE_B].sort().join(), 'a vendor following the method tag is notified of works with that method', notedTitles.join(' | '));

  // a second poll: nothing changes, nothing duplicates
  const run2 = await poll();
  const a2 = await Work.findOne({ projectId: '69099400001' });
  record(run2.newCount === 0 && a2?.deadlineAt?.getTime() === a?.deadlineAt?.getTime() && (await Tag.countDocuments({ facet: 'method' })) === 2, 'a second poll changes nothing and creates no tag');

  // 4. a LEGACY work (ingested before this feature): no method/year. A lifecycle event catches it up.
  const legacyId = '69099400004';
  const TITLE_D = 'จ้างทำป้าย โดยวิธีคัดเลือก';
  await Work.create({ siteId: site._id, projectId: legacyId, title: TITLE_D, status: 'BIDDING', announceType: 'D0', pubDate: new Date('2025-09-30'), tags: [], torFiles: [] });
  pages.set(legacyId, winnerPage(TITLE_D));
  feed.D0 = [];
  feed.W0 = [{ id: legacyId, title: TITLE_D }];
  await poll();
  const d = await Work.findOne({ projectId: legacyId }).populate('tags', 'name facet');
  record(d?.status === 'AWARDED' && tagNames(d).join() === 'วิธีคัดเลือก' && d?.fiscalYear === 2569, 'a legacy work is caught up by its next lifecycle event (method + year filled in)', `${d?.status} ${tagNames(d).join()} ${d?.fiscalYear}`);

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
