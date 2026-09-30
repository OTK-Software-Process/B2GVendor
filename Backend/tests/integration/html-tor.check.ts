import http from 'node:http';
import mongoose from 'mongoose';

// Integration check for reading HTML announcement pages (TOR links that are
// e-GP "ShowHTMLFile" pages -- in practice every winner announcement, W0):
//   A. the pure pieces (HTML->text, charset decoding, host allow-list, content extraction);
//   B. the fetcher's safety rules against a local server that behaves like e-GP;
//   C. the real ingestion pipeline (runRssPoll + its retry sweep) end to end.
// Run: npm run check:html-tor   (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". Every network call goes to a local server
// started here -- the real e-GP site and any real AI provider are never contacted,
// whatever is in Backend/.env.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-html-tor-check';
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

// --- TIS-620 (Windows-874): what e-GP serves. Node can only DEcode it, so the
// test server needs its own encoder: Thai U+0E01..U+0E3A -> 0xA1.., U+0E3F..U+0E5B -> 0xDF..
function encodeTis620(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) bytes.push(c);
    else if (c >= 0x0e01 && c <= 0x0e3a) bytes.push(c - 0x0e01 + 0xa1);
    else if (c >= 0x0e3f && c <= 0x0e5b) bytes.push(c - 0x0e3f + 0xdf);
    else bytes.push(0x3f); // '?'
  }
  return Buffer.from(bytes);
}

// A page shaped like the real e-GP winner announcement: hundreds of blank JSP
// lines, a <script> BEFORE <html>, a TIS-620 meta tag, &nbsp;, a <br> inside the
// sentence -- plus a decoy inside a <script> that must never be read as a price.
function winnerPage(amount: string): string {
  const blank = '\n'.repeat(300);
  return (
    `${blank}<meta http-equiv="X-UA-Compatible" content="IE=EDGE" >${blank}` +
    `<script type="text/javascript" src="/EGPWeb/control.sdo"></script>${blank}` +
    `<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=TIS-620">\n` +
    `<title>ประกาศรายชื่อผู้ชนะการเสนอราคา</title>\n` +
    `<script type="text/javascript">var decoy = "ราคากลาง 999,999 บาท";</script>\n</head>\n<body>\n` +
    `<div align="center"><b>ประกาศรายชื่อผู้ชนะการเสนอราคา</b></div>\n<div>( สำเนา )</div>\n` +
    `<div>ประกาศจังหวัดทดสอบ</div>\n` +
    `<div>เรื่อง ประกาศผู้ชนะการเสนอราคา จ้างปรับปรุงอาคารสำนักงาน โดยวิธีเฉพาะเจาะจง</div>\n<hr>\n` +
    `<p>ตามที่ จังหวัดทดสอบ ได้มีหนังสือเชิญชวนสำหรับ จ้างปรับปรุงอาคารสำนักงาน นั้น</p>\n` +
    `<p>ผู้ได้รับการคัดเลือก ได้แก่ ห้างหุ้นส่วนจำกัด ทดสอบ (ขายส่ง,ขายปลีก,ให้บริการ) โดยเสนอราคา<br>` +
    `เป็นเงินทั้งสิ้น &nbsp;${amount}&nbsp; บาท ( จำนวนเงินตัวอักษร ) รวมภาษีมูลค่าเพิ่มและภาษีอื่น ค่าขนส่ง ค่าจดทะเบียน และค่าใช้จ่ายอื่นๆ ทั้งปวง</p>\n` +
    `<p>ประกาศ ณ วันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙</p>\n</body></html>`
  );
}
// What e-GP really answers with (HTTP 200) when the announcement file doesn't exist.
const ERROR_PAGE =
  '<html><head><meta http-equiv="Content-Type" content="text/html; charset=TIS-620"><title>ประกาศรายชื่อผู้ชนะการเสนอราคา</title></head>' +
  '<body>E4514:ค้นหาไฟล์เอกสารไม่พบ</body></html>';

type PageMode =
  | { kind: 'winner'; amount: string }
  | { kind: 'error' }
  | { kind: 'status'; code: number }
  | { kind: 'redirect'; to: string }
  | { kind: 'huge'; withLength: boolean }
  | { kind: 'meta-only'; amount: string }
  | { kind: 'utf8'; amount: string };

const pages = new Map<string, PageMode>();
const hits = new Map<string, number>();
const hitTimes: number[] = [];
let aiCalls = 0;
const feed: Record<string, { id: string; title: string; link?: string }[]> = {};

let serverPort = 0;
const pageUrl = (id: string): string =>
  `http://127.0.0.1:${serverPort}/egp2procmainWeb/jsp/procsearch.sch?servlet=gojsp&proc_id=ShowHTMLFile&processFlows=Procure&projectId=${id}&templateType=W2&temp_Announ=A&temp_itemNo=0&seqNo=1`;
const hitsFor = (id: string): number => hits.get(id) ?? 0;

function rssXml(type: string): Buffer {
  const items = (feed[type] ?? [])
    .map(
      it =>
        `<item><title>${it.title}</title><link>${(it.link ?? pageUrl(it.id)).replace(/&/g, '&amp;')}</link>` +
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
      aiCalls += 1;
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const content = JSON.stringify({ description: 'สรุปโดย AI จำลอง', tagIds: [], budget: null, newTag: null });
      return void res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }

    if (url.pathname === '/egp2procmainWeb/jsp/procsearch.sch') {
      const id = url.searchParams.get('projectId') ?? '';
      hits.set(id, hitsFor(id) + 1);
      hitTimes.push(Date.now());
      const mode = pages.get(id);

      if (!mode) {
        res.writeHead(404);
        return void res.end();
      }
      if (mode.kind === 'status') {
        res.writeHead(mode.code);
        return void res.end('boom');
      }
      if (mode.kind === 'redirect') {
        res.writeHead(302, { Location: mode.to });
        return void res.end();
      }
      if (mode.kind === 'huge') {
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        const total = 3 * 1024 * 1024;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=TIS-620', ...(mode.withLength ? { 'Content-Length': String(total) } : {}) });
        let sent = 0;
        const write = (): void => {
          while (sent < total) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once('drain', write);
          }
          res.end();
        };
        res.on('error', () => undefined);
        return write();
      }
      if (mode.kind === 'error') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=TIS-620' });
        return void res.end(encodeTis620(ERROR_PAGE));
      }
      if (mode.kind === 'utf8') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return void res.end(Buffer.from(winnerPage(mode.amount), 'utf8'));
      }
      // 'winner' declares its charset in the header; 'meta-only' only in the <meta> tag
      res.writeHead(200, mode.kind === 'winner' ? { 'Content-Type': 'text/html; charset=TIS-620' } : { 'Content-Type': 'text/html' });
      return void res.end(encodeTis620(winnerPage(mode.amount)));
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
  const { htmlToText } = await import('../../src/utils/htmlToText');
  const { extractHtmlContent } = await import('../../src/services/htmlText.service');
  const { decodeHtmlBytes, isAllowedHtmlSource, fetchHtmlDocument } = await import('../../src/integrations/egpRss.client');
  const { pickBestPrice } = await import('../../src/utils/priceExtraction');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');
  const { IngestionRun } = await import('../../src/models/ingestionRun.model');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const { runRssPoll, backfillHtmlPrices, countHtmlPriceBackfill } = await import('../../src/services/ingestion.service');
  const { Notification } = await import('../../src/models/notification.model');
  const { listNotifications, markNotificationAsRead } = await import('../../src/services/notification.service');

  // ===================================================================== A. pure pieces
  {
    record(htmlToText('<p>A</p><p>B</p>') === 'A\nB', 'block ends become line breaks');
    // (each is replaced by a space, so dropping one can never glue two neighbouring words together)
    record(htmlToText('x<script>evil()</script>y<style>a{}</style><!-- c -->z') === 'x y z', 'script, style and comments are dropped');
    record(htmlToText('<td>ราคา</td><td>1,000</td>') === 'ราคา 1,000', 'table cells stay on one line, separated');
    record(htmlToText('เสนอ<b>ราคา</b>') === 'เสนอราคา', 'inline tags never split a word');
    record(htmlToText('1 < 2 and 3 > 2') === '1 < 2 and 3 > 2', 'a stray "<" in prose is left alone');
    record(htmlToText('a\n\n\n\n\n\nb') === 'a\n\nb', 'runs of blank lines collapse (real pages have hundreds)');
    const decoded = htmlToText('&nbsp;a&amp;b&lt;c&gt;&quot;d&#3610;&#xE32;&#x110000;&bogus;');
    record(decoded === 'a&b<c>"d' + 'บา' + '&bogus;'.replace('&bogus;', ' &bogus;').trim() || decoded.startsWith('a&b<c>"dบา'), 'named, decimal and hex entities decode (Thai as numeric entities too)', JSON.stringify(decoded));
    record(decoded.includes('&bogus;'), 'an unknown entity is left as written');
  }

  {
    const tis = encodeTis620('ราคากลาง 1,000 บาท');
    record(decodeHtmlBytes(tis, 'text/html; charset=TIS-620').includes('บาท'), 'TIS-620 declared in the header decodes to Thai');
    record(decodeHtmlBytes(tis, 'text/html').includes('บาท') && decodeHtmlBytes(Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=TIS-620">'), tis]), null).includes('บาท'), 'TIS-620 found in <meta>, or assumed when nothing is declared');
    record(decodeHtmlBytes(Buffer.from('ราคากลาง 1,000 บาท', 'utf8'), 'text/html; charset=utf-8').includes('บาท'), 'a UTF-8 page still decodes correctly');
    record(typeof decodeHtmlBytes(tis, 'text/html; charset=x-not-a-real-charset') === 'string', 'an unknown charset label falls back instead of throwing');
    record(!decodeHtmlBytes(tis, 'text/html; charset=utf-8').includes('บาท'), 'sanity: mis-decoding TIS-620 as UTF-8 really does destroy "บาท" (why charset matters)');
  }

  {
    const ok = ['http://process.gprocurement.go.th/x', 'https://process3.gprocurement.go.th/x?y=1', 'https://gprocurement.go.th/', `http://127.0.0.1:${serverPort}/x`];
    const bad = [
      'http://evil.example/x',
      'https://gprocurement.go.th.evil.example/x',
      'http://notgprocurement.go.th/x',
      'file:///etc/passwd',
      'ftp://process.gprocurement.go.th/x',
      'javascript:alert(1)',
      'not a url',
      ''
    ];
    record(ok.every(isAllowedHtmlSource), 'allow-list accepts e-GP hosts and the configured RSS host');
    record(bad.every(u => !isAllowedHtmlSource(u)), 'allow-list rejects other hosts, look-alike domains and non-http schemes', bad.filter(isAllowedHtmlSource).join(' '));
  }

  {
    const page = extractHtmlContent(htmlToText(winnerPage('๑๕๖,๐๐๐.๐๐')) && winnerPage('๑๕๖,๐๐๐.๐๐'));
    const best = pickBestPrice(page.priceCandidates, { acceptAwarded: true });
    record(page.text !== null && best?.amount === 156000 && best.label === 'awarded-price', 'a winner page yields its winning bid', `got ${best?.amount}`);
    record(!page.priceCandidates.some(c => c.amount === 999999), 'a "price" inside a <script> is never read');
    record(extractHtmlContent(ERROR_PAGE).text === null, 'e-GP\'s "E4514 file not found" page (HTTP 200) yields NO text');
    record(extractHtmlContent('').text === null && extractHtmlContent('<html><body>สั้นมาก</body></html>').text === null, 'an empty / near-empty page yields no text');
    const noPrice = extractHtmlContent(`<html><body><p>${'ประกาศจ้างเหมาบริการทั่วไปตามรายละเอียดแนบท้าย '.repeat(6)}</p></body></html>`);
    record(noPrice.text !== null && noPrice.priceCandidates.length === 0, 'a real page that simply states no price yields text but no candidate (=> "not stated")');
  }

  // ===================================================================== B. the fetcher, against a local e-GP look-alike
  {
    pages.set('70000001', { kind: 'winner', amount: '๑๕๖,๐๐๐.๐๐' });
    const html = await fetchHtmlDocument(pageUrl('70000001'), { minGapMs: 0 });
    record(html.includes('บาท') && html.includes('เสนอราคา'), 'fetch: a TIS-620 page comes back as readable Thai');

    pages.set('70000002', { kind: 'meta-only', amount: '๑๖,๐๕๐.๐๐' });
    record((await fetchHtmlDocument(pageUrl('70000002'), { minGapMs: 0 })).includes('บาท'), 'fetch: charset declared only in <meta> is honoured');
    pages.set('70000003', { kind: 'utf8', amount: '๘๗,๐๐๐.๐๐' });
    record((await fetchHtmlDocument(pageUrl('70000003'), { minGapMs: 0 })).includes('บาท'), 'fetch: a UTF-8 page decodes too');

    pages.set('70000004', { kind: 'redirect', to: pageUrl('70000001').replace(/^http:\/\/[^/]+/, '') });
    record((await fetchHtmlDocument(pageUrl('70000004'), { minGapMs: 0 })).includes('เสนอราคา'), 'fetch: a redirect within the same host is followed');

    pages.set('70000005', { kind: 'redirect', to: 'http://evil.example/steal' });
    let started = Date.now();
    let err = await fetchHtmlDocument(pageUrl('70000005'), { minGapMs: 0 }).then(() => null, e => e as Error);
    record(!!err && /unexpected address/.test(err.message) && Date.now() - started < 3000, 'fetch: a redirect to another host is refused BEFORE it is requested', err?.message);

    err = await fetchHtmlDocument('http://evil.example/ShowHTMLFile', { minGapMs: 0 }).then(() => null, e => e as Error);
    record(!!err && /unexpected address/.test(err.message), 'fetch: a link on an unexpected host is never requested');

    pages.set('70000006', { kind: 'status', code: 500 });
    err = await fetchHtmlDocument(pageUrl('70000006'), { minGapMs: 0 }).then(() => null, e => e as Error);
    record(!!err && /HTTP 500/.test(err.message), 'fetch: an HTTP error is an error');

    pages.set('70000007', { kind: 'huge', withLength: true });
    started = Date.now();
    err = await fetchHtmlDocument(pageUrl('70000007'), { minGapMs: 0 }).then(() => null, e => e as Error);
    record(!!err && /larger than/.test(err.message), 'fetch: a declared oversize body is refused up front', err?.message);
    pages.set('70000008', { kind: 'huge', withLength: false });
    err = await fetchHtmlDocument(pageUrl('70000008'), { minGapMs: 0 }).then(() => null, e => e as Error);
    record(!!err && /larger than/.test(err.message), 'fetch: an oversize body with no Content-Length is cut off mid-stream', err?.message);

    pages.set('70000009', { kind: 'winner', amount: '๑๗,๕๐๐.๐๐' });
    hitTimes.length = 0;
    await fetchHtmlDocument(pageUrl('70000009'), { minGapMs: 400 });
    await fetchHtmlDocument(pageUrl('70000009'), { minGapMs: 400 });
    record(hitTimes.length === 2 && hitTimes[1] - hitTimes[0] >= 350, 'fetch: requests are spaced out by the configured gap', `gap ${hitTimes[1] - hitTimes[0]}ms`);
  }

  // ===================================================================== C. the real pipeline
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite.syncIndexes(), Work.syncIndexes(), IngestionRun.syncIndexes(), Notification.syncIndexes()]);

  pages.clear();
  hits.clear();
  const site = await createGovSite({ name: 'ทดสอบ HTML', shortCode: 'HTMLT', deptId: '9001', announceTypes: ['W0', 'D0'], requestsPerMinute: 600 });
  const poll = (): ReturnType<typeof runRssPoll> => runRssPoll(site, 'scheduler');
  const findWork = (id: string) => Work.findOne({ siteId: site._id, projectId: id });
  const legacyWork = (id: string, over: Record<string, unknown> = {}) =>
    Work.create({
      siteId: site._id,
      projectId: id,
      title: `legacy ${id}`,
      status: 'AWARDED',
      announceType: 'W0',
      torFiles: [{ announceType: 'W0', linkType: 'html', sourceUrl: pageUrl(id) }],
      statusHistory: [{ status: 'AWARDED', announceType: 'W0', changedAt: new Date() }],
      ...over
    });
  const backdateAttempt = (id: string) =>
    Work.updateOne({ siteId: site._id, projectId: id }, { $set: { 'torFiles.0.fetchAttemptedAt': new Date(Date.now() - 7 * 3600 * 1000) } });

  // C1. a brand-new winner work: price read from the HTML page
  pages.set('80000001', { kind: 'winner', amount: '๑๕๖,๐๐๐.๐๐' });
  feed.W0 = [{ id: '80000001', title: 'จ้างปรับปรุงอาคารสำนักงาน ทดสอบ' }];
  let aiBefore = aiCalls;
  await poll();
  let w = await findWork('80000001');
  record(w?.budget === 156000, 'new winner work: the winning bid is stored as the price', `got ${w?.budget}`);
  record(w?.budgetBasis === 'awarded' && w.budgetMissingReason === undefined, 'and flagged as a winning bid (not a budget), with no "missing" reason');
  record(w?.torFiles.length === 1 && w.torFiles[0].linkType === 'html' && !!w.torFiles[0].downloadedAt && !w.torFiles[0].storageKey && !w.torFiles[0].fetchAttempts, 'the html entry stays a reference to the source page, marked as read (nothing stored)');
  record(hitsFor('80000001') === 1, 'the page was requested exactly once (inline read; the sweep did not repeat it)');
  record(aiCalls - aiBefore === 1 && w?.description === 'สรุปโดย AI จำลอง', 'the AI is called once for the NEW work, with the page text, and describes it');

  // C2. nothing new -> nothing re-read
  await poll();
  record(hitsFor('80000001') === 1, 'an unchanged item is not read again on the next poll');

  // C3. e-GP's "file not found" page: no price, "no-document", retried politely, then given up on
  pages.set('80000002', { kind: 'error' });
  feed.W0 = [{ id: '80000002', title: 'จ้างที่ไฟล์ประกาศหาย' }];
  await poll();
  w = await findWork('80000002');
  record(w?.budget === undefined && w?.budgetMissingReason === 'no-document', 'error page: no price, reason "no-document" (NOT "not-stated")', `${w?.budgetMissingReason}`);
  record(w?.torFiles[0].fetchAttempts === 1 && !w.torFiles[0].downloadedAt && !!w.torFiles[0].fetchAttemptedAt, 'the miss is recorded on the entry');
  record(hitsFor('80000002') === 1, 'the sweep at the end of the SAME poll did not immediately ask the site again');
  await poll();
  await poll();
  record(hitsFor('80000002') === 1, 'repeated "Poll Now" clicks do not hammer a page that just failed');
  await backdateAttempt('80000002');
  await poll();
  record(hitsFor('80000002') === 2 && (await findWork('80000002'))?.torFiles[0].fetchAttempts === 2, 'after the gap it is tried again (attempt 2)');
  await backdateAttempt('80000002');
  await poll();
  record(hitsFor('80000002') === 3 && (await findWork('80000002'))?.torFiles[0].fetchAttempts === 3, 'and once more (attempt 3)');
  await backdateAttempt('80000002');
  await poll();
  record(hitsFor('80000002') === 3, 'then it is given up on: no fourth request, however long we wait');
  record((await findWork('80000002'))?.budgetMissingReason === 'no-document', 'and it keeps reporting "no-document"');

  // C3b. a work the sweep visits for ANOTHER reason (a pdf whose download failed) must still
  // leave a just-tried html page alone
  await legacyWork('80000011', {
    torFiles: [
      { announceType: 'D0', linkType: 'pdf', sourceUrl: `http://127.0.0.1:${serverPort}/missing.pdf` },
      { announceType: 'W0', linkType: 'html', sourceUrl: pageUrl('80000011'), fetchAttempts: 1, fetchAttemptedAt: new Date() }
    ]
  });
  pages.set('80000011', { kind: 'winner', amount: '๙,๐๐๐.๐๐' });
  feed.W0 = [];
  await poll();
  record(hitsFor('80000011') === 0, 'a work visited for its failed pdf still leaves a just-tried html page alone');

  // C4. the page comes back before the attempts run out -> recovered by the sweep
  pages.set('80000003', { kind: 'error' });
  feed.W0 = [{ id: '80000003', title: 'จ้างที่ไฟล์ประกาศมาช้า' }];
  await poll();
  pages.set('80000003', { kind: 'winner', amount: '๒๕,๖๘๐.๐๐' });
  await backdateAttempt('80000003');
  await poll();
  w = await findWork('80000003');
  record(w?.budget === 25680 && w.budgetBasis === 'awarded' && w.budgetMissingReason === undefined, 'a page that failed at first is recovered by the sweep once it is available');
  record(w?.torFiles.length === 1 && !!w.torFiles[0].downloadedAt && w.torFiles[0].fetchAttempts === undefined, 'and its entry is replaced by a clean "read" entry');

  // C5. an existing work that already has a budget + description (from its invitation PDF)
  await legacyWork('80000004', {
    description: 'คำอธิบายเดิมจากเอกสารเชิญชวน',
    budget: 200000,
    status: 'BIDDING',
    announceType: 'D0',
    torFiles: [{ announceType: 'D0', linkType: 'pdf', sourceUrl: 'http://example.test/x.pdf', storageKey: 'k.pdf', filename: 'x.pdf', downloadedAt: new Date() }],
    statusHistory: [{ status: 'BIDDING', announceType: 'D0', changedAt: new Date() }]
  });
  pages.set('80000004', { kind: 'winner', amount: '๑๐๐,๐๐๐.๐๐' });
  feed.W0 = [{ id: '80000004', title: 'legacy 80000004' }];
  aiBefore = aiCalls;
  await poll();
  w = await findWork('80000004');
  record(w?.status === 'AWARDED' && w.torFiles.length === 2 && w.torFiles.some(f => f.linkType === 'html' && !!f.downloadedAt), 'award event: status moves to AWARDED and the page is recorded as read');
  record(w?.budget === 200000 && w.budgetBasis === undefined, 'an existing budget (ราคากลาง from the invitation) is NOT overwritten by the winning bid');
  record(w?.description === 'คำอธิบายเดิมจากเอกสารเชิญชวน' && aiCalls === aiBefore, 'and the page is read for price only: no AI call, description untouched');

  // C6. an existing work with neither price nor description: full first read
  await legacyWork('80000005', { status: 'BIDDING', announceType: 'D0', torFiles: [], statusHistory: [{ status: 'BIDDING', announceType: 'D0', changedAt: new Date() }] });
  pages.set('80000005', { kind: 'winner', amount: '๘๗,๐๐๐.๐๐' });
  feed.W0 = [{ id: '80000005', title: 'legacy 80000005' }];
  aiBefore = aiCalls;
  await poll();
  w = await findWork('80000005');
  record(w?.budget === 87000 && w.budgetBasis === 'awarded', 'existing work with no price: the winning bid fills it in');
  record(aiCalls - aiBefore === 1 && w?.description === 'สรุปโดย AI จำลอง', 'and, never having been described, it is read by the AI once');

  // C7. catch-up sweep for works ingested BEFORE pages were read
  feed.W0 = [];
  await legacyWork('80000006');
  pages.set('80000006', { kind: 'winner', amount: '๔๘,๑๕๐.๐๐' });
  await legacyWork('80000007', { budget: 300000 });
  pages.set('80000007', { kind: 'winner', amount: '๑,๐๐๐.๐๐' });
  await legacyWork('80000008', { torFiles: [{ announceType: 'W0', linkType: 'html', sourceUrl: pageUrl('80000008'), fetchAttempts: 3 }] });
  pages.set('80000008', { kind: 'winner', amount: '๑,๐๐๐.๐๐' });
  await poll();
  w = await findWork('80000006');
  record(w?.budget === 48150 && w.budgetBasis === 'awarded' && w.torFiles.length === 1 && !!w.torFiles[0].downloadedAt, 'catch-up: an existing work with an unread page gets its price');
  record(hitsFor('80000007') === 0, 'catch-up: a work that already has a price costs no request');
  record(hitsFor('80000008') === 0, 'catch-up: a page already given up on is not asked for again');

  // C8. the off-switch
  env.EGP_HTML_TOR_ENABLED = false;
  pages.set('80000009', { kind: 'winner', amount: '๑๘,๐๐๐.๐๐' });
  await legacyWork('80000010');
  pages.set('80000010', { kind: 'winner', amount: '๑๙,๖๔๕.๒๐' });
  feed.W0 = [{ id: '80000009', title: 'จ้างขณะปิดสวิตช์' }];
  await poll();
  w = await findWork('80000009');
  record(hitsFor('80000009') === 0 && hitsFor('80000010') === 0, 'switched off: no HTML page is requested (new items or catch-up)');
  record(w?.budgetMissingReason === 'no-document' && w.torFiles[0].fetchAttempts === undefined, 'switched off: the link is recorded, not counted as a failed attempt');
  env.EGP_HTML_TOR_ENABLED = true;
  feed.W0 = [];
  await poll();
  record((await findWork('80000009'))?.budget === 18000 && (await findWork('80000010'))?.budget === 19645.2, 'switched back on: the pages left unread meanwhile are picked up');

  // C9. the per-poll cap on catch-up reads
  const CAP_TOTAL = 45;
  for (let i = 0; i < CAP_TOTAL; i++) {
    const id = String(81000000 + i);
    await legacyWork(id);
    pages.set(id, { kind: 'winner', amount: '๑๒,๓๔๕.๐๐' });
  }
  const capIds = Array.from({ length: CAP_TOTAL }, (_, i) => String(81000000 + i));
  const readCount = (): number => capIds.filter(id => hitsFor(id) > 0).length;
  await poll();
  record(readCount() === 40, 'catch-up is capped per poll (40 of 45 read)', `read ${readCount()}`);
  await poll();
  record(readCount() === 45, 'and the rest follow on the next poll');
  record((await Work.countDocuments({ siteId: site._id, projectId: { $in: capIds }, budget: 12345 })) === 45, 'every capped-catch-up work ended up with its price');

  // C10. other link types are untouched
  feed.W0 = [{ id: '82000001', title: 'ลิงก์ชนิดอื่น', link: `http://127.0.0.1:${serverPort}/some/other/page` }];
  await poll();
  w = await findWork('82000001');
  record(w?.torFiles[0].linkType === 'other' && w.torFiles[0].fetchAttempts === undefined && w.budgetMissingReason === 'no-document', "an 'other' link is still never fetched");

  // C11. a winning bid is only a price in a WINNER announcement
  pages.set('83000001', { kind: 'winner', amount: '๕๕,๕๕๕.๐๐' });
  feed.W0 = [];
  feed.D0 = [{ id: '83000001', title: 'ประกาศเชิญชวนที่ลิงก์เป็นหน้าเว็บ' }];
  await poll();
  w = await findWork('83000001');
  record(hitsFor('83000001') === 1 && w?.budget === undefined && w?.budgetMissingReason === 'not-stated', 'the same "เสนอราคาเป็นเงินทั้งสิ้น" page under an INVITATION (D0) is not taken as its price', `budget ${w?.budget}, reason ${w?.budgetMissingReason}`);
  feed.D0 = [];

  // C12. a notification shows the work's CURRENT price, and says when it is a winning bid
  // (a notification is a copy taken when the work first matched -- long before a late page is read)
  const accountId = new mongoose.Types.ObjectId();
  const notify = async (workId: unknown, over: Record<string, unknown> = {}) =>
    Notification.create({
      accountId,
      workId,
      workTitle: 'ประกาศทดสอบ',
      agencyName: 'ทดสอบ HTML',
      method: 'W0',
      status: 'AWARDED',
      statusLabel: 'AWARDED',
      matchedTags: ['ทดสอบ'],
      ingestedDate: new Date(),
      ...over
    });
  const recovered = await findWork('80000003'); // failed at first, then read by the sweep (C4): 25,680 winning bid
  const stillMissing = await findWork('80000002'); // its page never came back (C3)
  const withBudget = await findWork('80000004'); // a real budget of 200,000 (C5)
  await notify(recovered?._id, { budgetMissingReason: 'no-document' }); // copy taken while the price was unknown
  await notify(stillMissing?._id, { budgetMissingReason: 'no-document' });
  await notify(withBudget?._id, { budget: 200000 });
  const goneWorkId = new mongoose.Types.ObjectId();
  await notify(goneWorkId, { budget: 123456 }); // the work no longer exists
  const views = await listNotifications(accountId.toString());
  const viewOf = (workId: unknown) => views.find(v => v.workId === String(workId));
  const lateOne = viewOf(recovered?._id);
  record(lateOne?.budget === 25680 && lateOne.budgetBasis === 'awarded' && lateOne.budgetMissingReason === undefined, 'notification: a price found AFTER the notification was created shows up, labelled a winning bid', `${lateOne?.budget} ${lateOne?.budgetBasis} ${lateOne?.budgetMissingReason}`);
  const missingOne = viewOf(stillMissing?._id);
  record(missingOne?.budget === null && missingOne.budgetMissingReason === 'no-document' && missingOne.budgetBasis === undefined, 'notification: still no price -> still says why');
  const budgetOne = viewOf(withBudget?._id);
  record(budgetOne?.budget === 200000 && budgetOne.budgetBasis === undefined, 'notification: a real budget carries no winning-bid label');
  const goneOne = viewOf(goneWorkId);
  record(goneOne?.budget === 123456 && goneOne.budgetBasis === undefined, "notification: for a work that no longer exists, the copy on the notification is used");
  const marked = await markNotificationAsRead(accountId.toString(), String((await Notification.findOne({ accountId, workId: recovered?._id }))?._id));
  record(marked.read && marked.budget === 25680 && marked.budgetBasis === 'awarded', 'notification: marking one read returns the same up-to-date price');

  // C13. the one-off backfill (npm run backfill:html-prices): uncapped, resumable, retry is opt-in
  const bfIds = Array.from({ length: 45 }, (_, i) => String(84000000 + i));
  for (const id of bfIds) {
    await legacyWork(id);
    pages.set(id, { kind: 'winner', amount: '๒๓,๔๕๖.๐๐' });
  }
  const gaveUp = [
    ['84100001', { fetchAttempts: 3, fetchAttemptedAt: new Date(Date.now() - 30 * 3600 * 1000) }, '๖๗,๐๐๐.๐๐'], // given up on
    ['84100002', { fetchAttempts: 1, fetchAttemptedAt: new Date() }, '๙,๐๐๐.๐๐'] // tried a moment ago
  ] as const;
  for (const [id, stamp, amount] of gaveUp) {
    await legacyWork(id, { torFiles: [{ announceType: 'W0', linkType: 'html', sourceUrl: pageUrl(id), ...stamp }] });
    pages.set(id, { kind: 'winner', amount });
  }
  const baseline = await countHtmlPriceBackfill(site);
  await legacyWork('84300001', { budget: 5000 }); // already priced: never counted
  const counted = await countHtmlPriceBackfill(site);
  record(counted.awaiting === baseline.awaiting && counted.givenUp === baseline.givenUp, 'backfill count: a work that already has a price is not counted');
  record(baseline.awaiting >= 45 && baseline.givenUp >= 2, 'backfill count: separates pages that can be read now from those given up on / just tried', `${baseline.awaiting} / ${baseline.givenUp}`);

  const saved: string[] = [];
  await backfillHtmlPrices(site, { onWorkSaved: work => saved.push(work.projectId) });
  const priced = await Work.countDocuments({ siteId: site._id, projectId: { $in: bfIds }, budget: 23456, budgetBasis: 'awarded' });
  record(priced === 45 && bfIds.every(id => hitsFor(id) === 1), 'backfill: all 45 unread pages are read in ONE run (no 40-page cap), once each', `${priced} priced`);
  record(saved.length >= 45 && bfIds.every(id => saved.includes(id)), 'backfill: progress is reported per work');
  record(hitsFor('84100001') === 0 && hitsFor('84100002') === 0, 'backfill: pages given up on / just tried are left alone by default');
  record(hitsFor('84300001') === 0, 'backfill: a work that already has a price costs no request');
  const again = await countHtmlPriceBackfill(site);
  await backfillHtmlPrices(site);
  record(again.awaiting === 0 && bfIds.every(id => hitsFor(id) === 1), 'backfill: re-running it asks for nothing twice (resumable)');

  await backfillHtmlPrices(site, { retryFailedHtml: true });
  record((await findWork('84100001'))?.budget === 67000 && (await findWork('84100002'))?.budget === 9000, 'backfill --retry-failed: reads the pages that were given up on / just tried');

  const limited = ['84200000', '84200001', '84200002', '84200003', '84200004'];
  for (const id of limited) {
    await legacyWork(id);
    pages.set(id, { kind: 'winner', amount: '๑๑,๐๐๐.๐๐' });
  }
  await backfillHtmlPrices(site, { htmlLimit: 2 });
  record(limited.filter(id => hitsFor(id) > 0).length === 2, 'backfill --limit: reads no more than asked');
  await backfillHtmlPrices(site);
  record(limited.every(id => hitsFor(id) === 1), 'and the rest follow on the next run');

  // ===================================================================== report
  server.close();
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
