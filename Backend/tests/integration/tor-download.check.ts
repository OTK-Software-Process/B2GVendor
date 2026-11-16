import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';

// API checks for TOR document download (E3):
//   A. GET /works/:id/tor/:index serves application/pdf, nosniff,
//      Content-Disposition: attachment, and a safe file name
//   B. an out-of-range / malformed index, and old non-PDF files, are 404
//   C. an unchanged file isn't downloaded again on the next poll; identical
//      content is stored once (deduplicated by hash)
//   D. a dead source link is logged for admins (run history) and the API says
//      "temporarily unavailable" (503 + Retry-After) until a later poll gets it
//   E. links are HTTPS in production (e-GP links upgraded, HSTS, https APP_URL)
// Run: npm run check:tor-download   (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". Files go to a temp folder that is removed
// at the end; the e-GP feed and the TOR files come from a local mock server.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-tor-download-check';
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

const pdf = (body: string): Buffer => Buffer.from(`%PDF-1.4\n% ${body}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

// ---- mock e-GP: an RSS feed and the PDF files it links to
let port = 0;
const feedItems: { id: string; title: string; link: string }[] = [];
const pdfFiles = new Map<string, { status: number; body?: Buffer }>(); // templateId -> answer
const pdfHits = new Map<string, number>();
const pdfLink = (name: string): string => `http://127.0.0.1:${port}/egp-template-service/dwnt/view-pdf-file?templateId=${name}`;

function startMock(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
      const items = url.searchParams.get('anounceType') === 'D0' ? feedItems : [];
      const xml =
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>' +
        items.map(i => `<item><title>${i.title}</title><link>${i.link.replace(/&/g, '&amp;')}</link><description>${i.id}, ${i.title}</description></item>`).join('') +
        '</channel></rss>';
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return void res.end(xml);
    }
    if (url.pathname === '/egp-template-service/dwnt/view-pdf-file') {
      const name = url.searchParams.get('templateId') ?? '';
      pdfHits.set(name, (pdfHits.get(name) ?? 0) + 1);
      const file = pdfFiles.get(name);
      if (!file || file.status !== 200 || !file.body) {
        res.writeHead(file?.status ?? 404);
        return void res.end('gone');
      }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"` });
      return void res.end(file.body);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main(): Promise<void> {
  const mock = await startMock();
  port = (mock.address() as { port: number }).port;
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tor-download-check-'));

  Object.assign(process.env, {
    MONGODB_URI,
    TOR_STORAGE_DIR: storageDir, // BEFORE the app modules read env
    EGP_RSS_BASE_URL: `http://127.0.0.1:${port}/EPROCRssFeedWeb/egpannouncerss.xml`,
    EGP_HTML_TOR_ENABLED: 'false',
    AI_TAGGING_ENABLED: 'false',
    SMTP_HOST: ''
  });

  const { createApp } = await import('../../src/app');
  const { Work } = await import('../../src/models/work.model');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { IngestionRun } = await import('../../src/models/ingestionRun.model');
  const { Account } = await import('../../src/models/account.model');
  const { Session, issueSessionToken, SESSION_TTL_MS } = await import('../../src/models/session.model');
  const { SESSION_COOKIE_NAME } = await import('../../src/config/cookie');
  const { saveTorFile } = await import('../../src/services/fileStorage.service');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const { runRssPoll } = await import('../../src/services/ingestion.service');
  const { toHttpsLink } = await import('../../src/utils/httpsLinks');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Work.syncIndexes(), GovSite.syncIndexes(), Account.syncIndexes(), Session.syncIndexes()]);

  const server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const get = async (urlPath: string, cookie?: string) => {
    const res = await fetch(base + urlPath, { headers: cookie ? { Cookie: cookie } : {} });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body, json: (() => { try { return JSON.parse(body.toString('utf8')); } catch { return null; } })() };
  };

  const site = await createGovSite({ name: 'หน่วยงานทดสอบ TOR', shortCode: 'TORDL', deptId: '5001', announceTypes: ['D0'], requestsPerMinute: 600 });
  const workBase = { siteId: site._id, status: 'BIDDING', announceType: 'D0' as const, statusHistory: [{ status: 'BIDDING', announceType: 'D0' as const, changedAt: new Date() }] };

  // ===================================================================== A. serving a PDF
  section('A. GET /works/:id/tor/:index serves the PDF safely');
  const thaiPdf = pdf('thai name');
  const thai = await saveTorFile(thaiPdf, 'ร่างขอบเขตงาน TOR.pdf');
  const nasty = await saveTorFile(pdf('nasty name'), '../../etc/passwd"\r\nSet-Cookie: pwned=1;.html');
  const nameless = await saveTorFile(pdf('no name'), '');
  // A file stored before only PDFs were accepted: HTML bytes under a .html key.
  await fs.writeFile(path.join(storageDir, 'legacy0000000000000000000.html'), '<html><script>alert(document.cookie)</script></html>');
  const work = await Work.create({
    ...workBase,
    projectId: '68050000001',
    title: 'จ้างพัฒนาระบบ',
    torFiles: [
      { announceType: 'D0', linkType: 'pdf', sourceUrl: pdfLink('a'), storageKey: thai.storageKey, filename: thai.filename, downloadedAt: new Date() }, // 0
      { announceType: 'D0', linkType: 'zip', sourceUrl: pdfLink('z'), storageKey: nasty.storageKey, filename: nasty.filename, downloadedAt: new Date(), role: 'attachment' }, // 1
      { announceType: 'D0', linkType: 'pdf', sourceUrl: pdfLink('n'), storageKey: nameless.storageKey, downloadedAt: new Date() }, // 2
      { announceType: 'D0', linkType: 'pdf', sourceUrl: pdfLink('legacy'), storageKey: 'legacy0000000000000000000.html', filename: 'old.html', downloadedAt: new Date() }, // 3
      { announceType: 'D0', linkType: 'pdf', sourceUrl: pdfLink('lost'), storageKey: 'ffffffffffffffffffffffff.pdf', filename: 'lost.pdf', downloadedAt: new Date() }, // 4: missing on disk
      { announceType: 'W0', linkType: 'html', sourceUrl: 'http://process.gprocurement.go.th/egp2procmainWeb/jsp/procsearch.sch?proc_id=ShowHTMLFile&projectId=68050000001' }, // 5
      { announceType: 'D0', linkType: 'other', sourceUrl: 'https://process5.gprocurement.go.th/other' } // 6
    ]
  });
  const id = String(work._id);

  {
    const r = await get(`/works/${id}/tor/0`);
    const cd = r.headers.get('content-disposition') ?? '';
    record(r.status === 200 && r.body.equals(thaiPdf), 'serves the stored PDF, byte for byte');
    record(r.headers.get('content-type') === 'application/pdf', 'Content-Type: application/pdf', r.headers.get('content-type') ?? '');
    record(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
    record(/^attachment;/.test(cd), 'Content-Disposition: attachment (downloaded, never rendered inline)', cd);
    record(cd.includes(`filename*=UTF-8''${encodeURIComponent('ร่างขอบเขตงาน TOR.pdf')}`) && /filename="[^"]*\.pdf"/.test(cd), 'a Thai file name is sent RFC 5987-encoded, with an ASCII fallback, ending .pdf', cd);
  }
  {
    const r = await get(`/works/${id}/tor/1`);
    const cd = r.headers.get('content-disposition') ?? '';
    const shown = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? cd.match(/filename="([^"]+)"/)?.[1] ?? '');
    record(r.status === 200 && !/[\r\n]/.test(cd) && !r.headers.get('set-cookie'), 'a hostile name cannot break the header (no CR/LF, no injected Set-Cookie)', cd);
    record(!/[\\/"]/.test(shown) && !shown.includes('..') && shown.endsWith('.pdf') && !shown.endsWith('.html'), 'the offered name has no folders, quotes or "..", and always ends .pdf', shown);
  }
  {
    const r = await get(`/works/${id}/tor/2`);
    record(r.status === 200 && /filename="document\.pdf"/.test(r.headers.get('content-disposition') ?? ''), 'a file with no name is offered as document.pdf', r.headers.get('content-disposition') ?? '');
  }

  // ===================================================================== B. 404s
  section('B. out-of-range index and old non-PDF files -> 404');
  {
    for (const bad of ['7', '99', '-1', '1.5', '1e0', '0x0', 'abc', '%200', '00000000000001']) {
      const r = await get(`/works/${id}/tor/${bad}`);
      if (r.status !== 404 || r.headers.get('content-type')?.includes('pdf')) record(false, `index "${bad}" should be 404`, `${r.status} ${r.headers.get('content-type')}`);
    }
    record(true, 'an index past the end (7, 99) or not a plain position (-1, 1.5, 1e0, 0x0, abc, " 0", too long) -> 404, no file');
    const legacy = await get(`/works/${id}/tor/3`);
    record(legacy.status === 404 && !legacy.body.toString('utf8').includes('<script>'), 'an old stored file that is not a PDF -> 404, and its bytes never go out', `${legacy.status}`);
    const lost = await get(`/works/${id}/tor/4`);
    record(lost.status === 404, 'a file missing from storage -> 404', `${lost.status}`);
    const html = await get(`/works/${id}/tor/5`);
    record(html.status === 404 && /page on the government site/.test(html.json?.error?.message ?? ''), 'an HTML announcement page (no file by design) -> 404 that says where it lives', html.json?.error?.message);
    const other = await get(`/works/${id}/tor/6`);
    record(other.status === 404, 'a link that is never downloaded ("other") -> 404');
    record((await get(`/works/${new mongoose.Types.ObjectId()}/tor/0`)).status === 404, 'an unknown work -> 404');
    record((await get('/works/not-an-id/tor/0')).status === 404, 'a malformed work id -> 404');
    const hidden = await Work.create({ ...workBase, projectId: '68050000002', title: 'hidden', ingestionRelevance: 'not-related', torFiles: [{ announceType: 'D0', linkType: 'pdf', sourceUrl: pdfLink('h'), storageKey: thai.storageKey, filename: 'h.pdf' }] });
    record((await get(`/works/${hidden._id}/tor/0`)).status === 404, 'a work hidden from the public site -> its files are 404 too');
  }

  // ===================================================================== C. dedup by hash
  section('C. an unchanged file is not downloaded again; identical content is stored once');
  const filesOnDisk = async () => (await fs.readdir(storageDir)).filter(f => f.endsWith('.pdf')).length;
  {
    const torBytes = pdf('the real TOR');
    pdfFiles.set('tor-1', { status: 200, body: torBytes });
    feedItems.push({ id: '68050000010', title: 'ประกวดราคาจ้างก่อสร้าง', link: pdfLink('tor-1') });
    const disk0 = await filesOnDisk();
    await runRssPoll(site, 'scheduler');
    const first = await Work.findOne({ projectId: '68050000010' });
    record(pdfHits.get('tor-1') === 1 && !!first?.torFiles[0]?.storageKey && (await filesOnDisk()) === disk0 + 1, 'first poll: the TOR is downloaded once and stored');

    await runRssPoll(site, 'scheduler');
    await runRssPoll(site, 'scheduler');
    record(pdfHits.get('tor-1') === 1, 'two more polls with the same link: not downloaded again', `${pdfHits.get('tor-1')} download(s)`);

    // The agency re-issues the document under a new link, same bytes.
    pdfFiles.set('tor-1-reissued', { status: 200, body: torBytes });
    feedItems[0] = { ...feedItems[0], link: pdfLink('tor-1-reissued') };
    await runRssPoll(site, 'scheduler');
    const reissued = await Work.findOne({ projectId: '68050000010' });
    const current = reissued?.torFiles.filter(f => !f.supersededAt) ?? [];
    record(current.length === 1 && current[0].storageKey === first?.torFiles[0]?.storageKey, 'a re-issued link with identical content maps to the same stored file (same hash key)');
    record((await filesOnDisk()) === disk0 + 1, 'and the storage still holds that content once', `${await filesOnDisk()} file(s)`);

    // Another work whose document has the very same bytes.
    pdfFiles.set('tor-copy', { status: 200, body: torBytes });
    feedItems.push({ id: '68050000011', title: 'งานที่ใช้เอกสารชุดเดียวกัน', link: pdfLink('tor-copy') });
    await runRssPoll(site, 'scheduler');
    const twin = await Work.findOne({ projectId: '68050000011' });
    record(twin?.torFiles[0]?.storageKey === first?.torFiles[0]?.storageKey && (await filesOnDisk()) === disk0 + 1, 'two works with the same document share one stored copy');
    const served = await get(`/works/${twin?._id}/tor/0`);
    record(served.status === 200 && served.body.equals(torBytes), 'and each serves it');
  }

  // ===================================================================== D. dead source link
  section('D. a dead source link is logged for admins and shows "temporarily unavailable"');
  {
    const account = await Account.create({ email: 'admin@tor-download.check', passwordHash: 'SecurePass123', name: 'Admin', role: 'admin', permissions: ['poll:manage'] });
    const { raw, tokenHash } = issueSessionToken();
    await Session.create({ accountId: account._id, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    const adminCookie = `${SESSION_COOKIE_NAME}=${raw}`;

    pdfFiles.set('tor-dead', { status: 404 });
    feedItems.push({ id: '68050000020', title: 'ประกาศที่ลิงก์เอกสารเสีย', link: pdfLink('tor-dead') });
    const run = await runRssPoll(site, 'scheduler');
    const dead = await Work.findOne({ projectId: '68050000020' });
    record(!!dead && !dead.torFiles[0]?.storageKey && dead.torFiles[0]?.fetchAttempts === 1 && !!dead.torFiles[0]?.fetchAttemptedAt, 'the work is still stored; its TOR entry records the failed attempt');
    const logLine = run.errorLog.find(l => l.includes('68050000020'));
    record(!!logLine && /unavailable/.test(logLine) && /HTTP 404/.test(logLine) && logLine.includes(pdfLink('tor-dead')), 'the run log says which link is dead and why', logLine);
    const item = run.itemResults.find(i => i.projectId === '68050000020');
    record(item?.status === 'new' && /HTTP 404/.test(item.message ?? ''), 'the item row in the run carries the problem too', JSON.stringify(item));

    const adminView = await get(`/admin/ingestion/runs/${run._id}`, adminCookie);
    record(adminView.status === 200 && JSON.stringify(adminView.json?.data?.errorLog ?? []).includes('tor-dead'), 'an admin sees it in the run history (GET /admin/ingestion/runs/:id)');
    record((await get(`/admin/ingestion/runs/${run._id}`)).status === 401, 'the run log is admin-only');

    const r = await get(`/works/${dead?._id}/tor/0`);
    record(r.status === 503 && /temporarily unavailable/i.test(r.json?.error?.message ?? '') && !r.headers.get('content-type')?.includes('pdf'), 'GET its TOR -> 503 "temporarily unavailable"', `${r.status} ${r.json?.error?.message}`);
    record(Number(r.headers.get('retry-after')) > 0, 'with a Retry-After header', r.headers.get('retry-after') ?? '');
    const detail = await get(`/works/${dead?._id}`);
    const entry = detail.json?.data?.torFiles?.[0];
    record(entry && !entry.storageKey && entry.linkType === 'pdf' && entry.fetchAttempts === 1, 'the public work detail exposes the state the website shows as "temporarily unavailable" (pdf, no file yet)', JSON.stringify(entry));

    const again = await runRssPoll(site, 'scheduler');
    const still = await Work.findOne({ projectId: '68050000020' });
    record(still?.torFiles[0]?.fetchAttempts === 2 && again.errorLog.some(l => l.startsWith('[retry]') && l.includes('68050000020')), 'the next poll retries it and logs it again while it is still dead', again.errorLog.join(' | '));

    pdfFiles.set('tor-dead', { status: 200, body: pdf('it came back') });
    const recovered = await runRssPoll(site, 'scheduler');
    const back = await Work.findOne({ projectId: '68050000020' });
    const ok = await get(`/works/${back?._id}/tor/0`);
    record(!!back?.torFiles.find(f => !f.supersededAt)?.storageKey && ok.status === 200 && ok.headers.get('content-type') === 'application/pdf', 'once the link works again a later poll stores it and the download works');
    record(!recovered.errorLog.some(l => l.includes('68050000020')), 'and that run no longer logs it');
  }

  // ===================================================================== E. https in production
  section('E. links are HTTPS in production');
  {
    record(toHttpsLink('http://process.gprocurement.go.th/egp2procmainWeb/x?a=1&b=2', true) === 'https://process.gprocurement.go.th/egp2procmainWeb/x?a=1&b=2', 'an http e-GP link becomes https (path and query untouched)');
    record(toHttpsLink('https://process5.gprocurement.go.th/x', true) === 'https://process5.gprocurement.go.th/x', 'an https link is left as is');
    record(toHttpsLink('http://gprocurement.go.th.evil.example/x', true).startsWith('http:') && toHttpsLink('http://example.org/x', true).startsWith('http:'), 'other hosts (incl. look-alikes) are not rewritten');
    record(toHttpsLink('http://process.gprocurement.go.th/x', false).startsWith('http:'), 'outside production nothing is rewritten');

    const devDetail = await get(`/works/${id}`);
    record(devDetail.json?.data?.torFiles?.[5]?.sourceUrl?.startsWith('http://') === true, 'outside production the API returns the link exactly as stored');

    const src = readFileSync(path.join(__dirname, '../../src/integrations/egpRss.client.ts'), 'utf8');
    record(src.includes('fetch(toHttpsLink(url)') && src.includes('let currentUrl = toHttpsLink(url)'), 'the worker fetches TOR files and announcement pages through the same upgrade (wiring)');

    // The production app, in a child process (NODE_ENV is fixed at start-up).
    const backendRoot = path.join(__dirname, '../..');
    const probe = path.join(os.tmpdir(), `tor-download-prod-${process.pid}.ts`);
    writeFileSync(
      probe,
      `import mongoose from ${JSON.stringify(require.resolve('mongoose'))};
       import { createApp } from ${JSON.stringify(path.join(backendRoot, 'src/app'))};
       (async () => {
         await mongoose.connect(process.env.MONGODB_URI!);
         const server = createApp().listen(0, async () => {
           const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/v1';
           const detail = await fetch(base + '/works/${id}').then(r => r.json());
           const file = await fetch(base + '/works/${id}/tor/0');
           console.log('RESULT ' + JSON.stringify({ links: detail.data.torFiles.map((f: { sourceUrl: string }) => f.sourceUrl), hsts: file.headers.get('strict-transport-security'), type: file.headers.get('content-type') }));
           server.close(); await mongoose.disconnect(); process.exit(0);
         });
       })();`
    );
    const runProd = (appUrl: string) =>
      spawnSync(process.execPath, [require.resolve('tsx/cli'), probe], {
        cwd: backendRoot,
        env: { ...process.env, NODE_ENV: 'production', APP_URL: appUrl, CORS_ORIGIN: 'https://b2g.example', MONGODB_URI, TOR_STORAGE_DIR: storageDir, SMTP_HOST: '' },
        encoding: 'utf8',
        timeout: 60_000
      });
    const prod = runProd('https://b2g.example');
    const line = `${prod.stdout}`.split('\n').find(l => l.startsWith('RESULT '));
    const out = line ? (JSON.parse(line.slice(7)) as { links: string[]; hsts: string | null; type: string | null }) : null;
    // (the mock's own 127.0.0.1 links are not e-GP hosts, so they are left alone)
    const egpLinks = out?.links.filter(l => l.includes('gprocurement.go.th')) ?? [];
    record(
      egpLinks.length === 2 && egpLinks.every(l => l.startsWith('https://')) && out?.links[5] === 'https://process.gprocurement.go.th/egp2procmainWeb/jsp/procsearch.sch?proc_id=ShowHTMLFile&projectId=68050000001',
      'production: every e-GP link the API returns is https (the stored http announcement-page link is upgraded)',
      out ? out.links[5] : `${prod.stdout}\n${prod.stderr}`.slice(-400)
    );
    record(!!out?.hsts && /max-age=\d+/.test(out.hsts), 'production: the download carries Strict-Transport-Security (browsers stay on https)', out?.hsts ?? '');
    record(out?.type === 'application/pdf', 'production: the download itself still works');

    const refused = runProd('http://b2g.example');
    record(refused.status !== 0 && /APP_URL must be an https:\/\/ address in production/.test(`${refused.stdout}${refused.stderr}`), 'production refuses to start with a plain-http APP_URL (the base of every emailed link)', `exit ${refused.status}`);
    unlinkSync(probe);
    const stored = await Work.findById(id);
    record(stored?.torFiles[5]?.sourceUrl.startsWith('http://') === true, 'the stored link itself is never rewritten (it is the key ingestion matches on)');
  }

  // ===================================================================== report
  server.close();
  mock.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  const passes = results.filter(line => line.startsWith('PASS')).length;
  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await fs.rm(storageDir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  console.log(results.join('\n'));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
