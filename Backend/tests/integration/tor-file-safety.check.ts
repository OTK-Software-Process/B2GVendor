import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import AdmZip from 'adm-zip';
import mongoose from 'mongoose';

// Safer TOR zip / PDF handling:
//   A. the PDF signature + display-name rules (utils/pdfFile.ts);
//   B. zip extraction limits against real zip bombs and a hand-patched archive
//      that lies about its unpacked size (zipExtraction.service.ts);
//   C. storage: only PDFs, always <hash>.pdf (fileStorage.service.ts);
//   D. the download size cap (egpRss.client.ts downloadTorFile);
//   E. serving: GET /works/:id/tor/:index is application/pdf + nosniff + a .pdf name.
// Run: npm run check:tor-files   (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". Files go to a temp folder that is removed
// at the end; every network call goes to a local server started here.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-tor-files-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const MB = 1024 * 1024;
const pdf = (body = 'x', pad = 0) => Buffer.concat([Buffer.from(`%PDF-1.7\n${body}\n`), Buffer.alloc(pad, 0x20)]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');

function zipOf(files: Record<string, Buffer | null>): Buffer {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) {
    if (data === null) zip.addFile(name.endsWith('/') ? name : `${name}/`, Buffer.alloc(0));
    else zip.addFile(name, data);
  }
  return zip.toBuffer();
}

// Rewrites every "uncompressed size" field (local headers + central directory)
// so the archive claims `size` bytes per entry, whatever it really holds.
function lieAboutSize(zipBuffer: Buffer, size: number): Buffer {
  const out = Buffer.from(zipBuffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (sig === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

async function main(): Promise<void> {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tor-files-check-'));
  process.env.TOR_STORAGE_DIR = storageDir; // set BEFORE the app modules read env
  process.env.MONGODB_URI = MONGODB_URI;

  // app first: it installs the audit plugin before any model loads.
  const { createApp } = await import('../../src/app');
  const { hasPdfSignature, safePdfFilename } = await import('../../src/utils/pdfFile');
  const { extractPdfsFromZip, ZIP_LIMITS } = await import('../../src/services/zipExtraction.service');
  const { saveTorFile, isStoredPdf, NotPdfError } = await import('../../src/services/fileStorage.service');
  const { downloadTorFile } = await import('../../src/integrations/egpRss.client');
  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');

  // --- A. signature + names ---
  record(hasPdfSignature(pdf()), 'a %PDF- file is a PDF');
  record(!hasPdfSignature(HTML), 'HTML is not a PDF');
  record(!hasPdfSignature(Buffer.from('<html>%PDF-1.7')), 'a signature that is not at byte 0 does not count');
  record(!hasPdfSignature(Buffer.from('%PD')) && !hasPdfSignature(Buffer.alloc(0)), 'short / empty input is not a PDF');
  const names: [string, string][] = [
    ['evil.html', 'evil.pdf'],
    ['../../etc/passwd', 'passwd.pdf'],
    ['C:\\temp\\x.exe', 'x.pdf'],
    ['a\r\nSet-Cookie: x.pdf', 'aSet-Cookie x.pdf'],
    ['ร่าง TOR.PDF', 'ร่าง TOR.pdf'],
    ['report.tar.gz', 'report.tar.pdf'],
    ['.htaccess', 'document.pdf'],
    ['', 'document.pdf']
  ];
  const badNames = names.filter(([raw, want]) => safePdfFilename(raw) !== want).map(([raw]) => `${JSON.stringify(raw)} -> ${JSON.stringify(safePdfFilename(raw))}`);
  record(badNames.length === 0, 'display names: no folders / control chars, always .pdf', badNames.join('; '));

  // --- B. zip extraction ---
  const normal = extractPdfsFromZip(
    zipOf({ 'docs/': null, 'docs/doc_1001_6901.pdf': pdf('body'), 'Attach_TOR_1.PDF': pdf('att'), 'readme.txt': Buffer.from('hi') })
  );
  record(
    normal.map(e => e.filename).sort().join() === 'Attach_TOR_1.pdf,doc_1001_6901.pdf' && normal.every(e => hasPdfSignature(e.buffer)),
    'a normal TOR zip yields its PDFs (folders and non-PDFs ignored)',
    normal.map(e => e.filename).join()
  );

  const disguised = extractPdfsFromZip(zipOf({ 'real.pdf': pdf(), 'fake.pdf': HTML }));
  record(disguised.map(e => e.filename).join() === 'real.pdf', 'an entry named .pdf that is really HTML is dropped');

  const traversal = extractPdfsFromZip(zipOf({ '../../../evil.pdf': pdf() }));
  record(traversal.length === 1 && traversal[0].filename === 'evil.pdf', 'a ../ entry name becomes a plain display name (nothing is written by path)');

  const manyEntries: Record<string, Buffer> = {};
  for (let i = 0; i <= ZIP_LIMITS.maxEntries; i++) manyEntries[`f${i}.txt`] = Buffer.from('x');
  manyEntries['doc.pdf'] = pdf();
  record(extractPdfsFromZip(zipOf(manyEntries)).length === 0, `an archive with more than ${ZIP_LIMITS.maxEntries} entries is refused`);

  const small = { maxEntries: 50, maxPdfEntries: 3, maxEntryBytes: 1000, maxTotalBytes: 1500 };
  record(extractPdfsFromZip(zipOf({ 'a.pdf': pdf(), 'b.pdf': pdf(), 'c.pdf': pdf(), 'd.pdf': pdf() }), small).length === 0, 'too many PDF entries -> refused');
  const perEntry = extractPdfsFromZip(zipOf({ 'big.pdf': pdf('big', 2000), 'ok.pdf': pdf('ok') }), small);
  record(perEntry.map(e => e.filename).join() === 'ok.pdf', 'an entry over the per-entry limit is skipped, the rest kept', perEntry.map(e => e.filename).join());
  const total = extractPdfsFromZip(zipOf({ 'a.pdf': pdf('a', 600), 'b.pdf': pdf('b', 600), 'c.pdf': pdf('c', 600) }), small);
  record(total.map(e => e.filename).join() === 'a.pdf,b.pdf', 'entries past the total unpacked budget are skipped', total.map(e => e.filename).join());

  // A real bomb: 60 MB that compresses to a few KB.
  const bombZip = zipOf({ 'bomb.pdf': pdf('bomb', 60 * MB), 'doc.pdf': pdf('doc') });
  const bomb = extractPdfsFromZip(bombZip);
  record(
    bombZip.length < 1 * MB && bomb.map(e => e.filename).join() === 'doc.pdf',
    `a ${(bombZip.length / 1024).toFixed(0)} KB zip holding a 60 MB entry: the entry is skipped before inflating`,
    bomb.map(e => e.filename).join()
  );

  // The same 60 MB entry, but the archive CLAIMS 100 bytes (and 0 bytes):
  // adm-zip 0.6.1 must stop at the claimed size, so nothing big comes out.
  const lyingBomb = zipOf({ 'liar.pdf': pdf('liar', 60 * MB) });
  for (const claimed of [100, 0]) {
    const before = process.memoryUsage().rss;
    const lied = extractPdfsFromZip(lieAboutSize(lyingBomb, claimed));
    const grewMb = (process.memoryUsage().rss - before) / MB;
    record(lied.length === 0 && grewMb < 40, `an entry that claims ${claimed} bytes but holds 60 MB is not unpacked`, `kept ${lied.length}, rss +${grewMb.toFixed(1)} MB`);
  }
  record(extractPdfsFromZip(Buffer.from('not a zip at all')).length === 0, 'a corrupt archive yields nothing (no throw)');

  // --- C. storage ---
  let refused: unknown;
  try {
    await saveTorFile(HTML, 'evil.html');
  } catch (err) {
    refused = err;
  }
  record(refused instanceof NotPdfError, 'saveTorFile refuses a non-PDF', String(refused));
  record((await fs.readdir(storageDir)).length === 0, '...and writes nothing');

  const saved = await saveTorFile(pdf('stored'), 'evil.html');
  record(/^[0-9a-f]{24}\.pdf$/.test(saved.storageKey) && saved.filename === 'evil.pdf', 'a PDF named .html is stored as <hash>.pdf with a .pdf display name', JSON.stringify(saved));
  const again = await saveTorFile(pdf('stored'), 'other-name.pdf');
  record(again.storageKey === saved.storageKey, 'the same content keeps the same key (dedup unchanged)');
  record(await isStoredPdf(saved.storageKey), 'isStoredPdf: a stored PDF');
  await fs.writeFile(path.join(storageDir, 'legacy.html'), HTML);
  record(!(await isStoredPdf('legacy.html')) && !(await isStoredPdf('nope.pdf')), 'isStoredPdf: false for a non-PDF or a missing file');

  // --- D. download cap ---
  const server = http.createServer((req, res) => {
    const body = pdf('downloaded', 2000);
    if (req.url === '/declared-big') {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(body.length) });
      res.end(body);
    } else if (req.url === '/streamed-big') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' }); // chunked, no length
      res.write(body.subarray(0, 1000));
      res.end(body.subarray(1000));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="tor.pdf"' });
      res.end(pdf('small'));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const tryDownload = async (p: string) => {
    try {
      return await downloadTorFile(`http://127.0.0.1:${port}${p}`, 'pdf', 1500);
    } catch (err) {
      return err as Error;
    }
  };
  const declared = await tryDownload('/declared-big');
  record(declared instanceof Error && /larger than/.test(declared.message), 'download: a declared oversize body is refused up front', String(declared));
  const streamed = await tryDownload('/streamed-big');
  record(streamed instanceof Error && /larger than/.test(streamed.message), 'download: an oversize body with no length is cut off mid-stream', String(streamed));
  const fine = await tryDownload('/ok');
  record(!(fine instanceof Error) && hasPdfSignature(fine.buffer) && fine.filename === 'tor.pdf', 'download: a normal file comes through');
  server.close();

  // --- E. serving ---
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  const app = createApp().listen(0);
  await new Promise<void>(resolve => app.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}/api/v1`;

  const site = await GovSite.create({ name: 'ทดสอบไฟล์', shortCode: 'TORF', deptId: '9002', announceTypes: ['D0'] });
  const work = await Work.create({
    siteId: site._id,
    projectId: '69010000001',
    title: 'TOR file safety',
    status: 'BIDDING',
    announceType: 'D0',
    torFiles: [
      { announceType: 'D0', linkType: 'pdf', sourceUrl: 'http://example.test/a.pdf', storageKey: saved.storageKey, filename: 'evil.html', downloadedAt: new Date() },
      { announceType: 'D0', linkType: 'pdf', sourceUrl: 'http://example.test/b.pdf', storageKey: 'legacy.html', filename: 'legacy.html', downloadedAt: new Date() }
    ]
  });

  const served = await fetch(`${base}/works/${work._id}/tor/0`);
  const body = Buffer.from(await served.arrayBuffer());
  const disposition = served.headers.get('content-disposition') ?? '';
  record(served.status === 200 && hasPdfSignature(body), 'GET /works/:id/tor/0 serves the PDF', String(served.status));
  record(served.headers.get('content-type') === 'application/pdf', 'Content-Type: application/pdf (not from the file name)', String(served.headers.get('content-type')));
  record(served.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  record(/^attachment;/.test(disposition) && /filename="evil\.pdf"/.test(disposition), 'downloaded as an attachment named .pdf, even when the stored name was .html', disposition);

  const legacy = await fetch(`${base}/works/${work._id}/tor/1`);
  record(legacy.status === 404 && !(await legacy.text()).includes('<script>'), 'a stored file that is not a PDF is never served (404)', String(legacy.status));

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  app.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await fs.rm(storageDir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
