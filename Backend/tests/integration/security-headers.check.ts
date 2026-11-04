import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { createApp } from '../../src/app';
import { corsOrigins, isProduction } from '../../src/config/env';
import { securityHeaders } from '../../src/middlewares/securityHeaders.middleware';
import { Tag } from '../../src/models/tag.model';

// API security headers. Needs NO database: every request below is answered
// before (or without) touching one, so this can never touch your data.

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

type Headers = Awaited<ReturnType<typeof fetch>>['headers'];
const listen = (app: express.Express) =>
  new Promise<{ base: string; close: () => void }>(resolve => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }));
  });

// The four headers the finding asks for, checked on one response.
function expectProtected(label: string, h: Headers, opts: { hsts: boolean }): void {
  record(h.get('x-powered-by') === null, `${label}: X-Powered-By is gone`, String(h.get('x-powered-by')));
  record(h.get('x-content-type-options') === 'nosniff', `${label}: X-Content-Type-Options is nosniff`, String(h.get('x-content-type-options')));
  record(h.get('content-security-policy') === "frame-ancestors 'none'", `${label}: Content-Security-Policy is exactly frame-ancestors 'none'`, String(h.get('content-security-policy')));
  record(h.get('x-frame-options') === 'DENY', `${label}: X-Frame-Options is DENY (matches frame-ancestors 'none')`, String(h.get('x-frame-options')));
  const hsts = h.get('strict-transport-security');
  if (opts.hsts) record(hsts === 'max-age=15552000; includeSubDomains', `${label}: HSTS is sent (180 days, includeSubDomains)`, String(hsts));
  else record(hsts === null, `${label}: no HSTS outside production`, String(hsts));
}

async function main(): Promise<void> {
  const app = createApp();
  const { base, close } = await listen(app);

  // The real app, in whatever mode this process runs in (development under `npm run check`).
  const expectHsts = isProduction;
  record(true, `running the real app in ${isProduction ? 'PRODUCTION' : 'non-production'} mode`);

  // ---------------------------------------------------- every kind of response
  const ok = await fetch(`${base}/health`);
  record(ok.status === 200, 'GET /health answers 200', String(ok.status));
  expectProtected('200 success', ok.headers, { hsts: expectHsts });

  const unauth = await fetch(`${base}/api/v1/admin/dashboard`);
  record(unauth.status === 401, 'an unauthenticated admin call answers 401', String(unauth.status));
  expectProtected('401 error', unauth.headers, { hsts: expectHsts });

  const missing = await fetch(`${base}/definitely-not-a-route`);
  record(missing.status === 404, 'an unknown URL answers 404', String(missing.status));
  expectProtected('404 not found', missing.headers, { hsts: expectHsts });

  const invalid = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  record(invalid.status === 400, 'an invalid login body answers 400', String(invalid.status));
  expectProtected('400 validation error', invalid.headers, { hsts: expectHsts });

  // a genuine 500: make a public endpoint's database call blow up
  const realFind = Tag.find.bind(Tag);
  const realError = console.error;
  console.error = () => undefined;
  (Tag as unknown as { find: () => never }).find = () => {
    throw new Error('simulated failure');
  };
  const broken = await fetch(`${base}/api/v1/tags`);
  (Tag as unknown as { find: typeof realFind }).find = realFind;
  console.error = realError;
  record(broken.status === 500, 'a server failure answers 500', String(broken.status));
  expectProtected('500 server error', broken.headers, { hsts: expectHsts });

  // --------------------------------------------------------------------- CORS
  const origin = corsOrigins[0];
  const preflight = await fetch(`${base}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  record(preflight.status === 204, 'a CORS preflight still answers 204', String(preflight.status));
  record(preflight.headers.get('access-control-allow-origin') === origin && preflight.headers.get('access-control-allow-credentials') === 'true', 'CORS still allows the frontend origin WITH credentials (helmet did not disturb it)', `${preflight.headers.get('access-control-allow-origin')}`);
  expectProtected('CORS preflight', preflight.headers, { hsts: expectHsts });

  const crossOrigin = await fetch(`${base}/health`, { headers: { Origin: origin } });
  record(crossOrigin.headers.get('access-control-allow-origin') === origin, 'a cross-origin fetch from the frontend still receives its CORS headers');
  record(crossOrigin.headers.get('cross-origin-resource-policy') === 'same-origin', 'Cross-Origin-Resource-Policy stays at helmet\'s strict default', String(crossOrigin.headers.get('cross-origin-resource-policy')));
  const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  record(evil.headers.get('access-control-allow-origin') === null, 'an unlisted origin still gets no CORS access');
  close();

  // ------------------------------------------------- production vs development
  for (const production of [true, false]) {
    const mini = express();
    mini.disable('x-powered-by');
    mini.use(securityHeaders(production));
    mini.get('/x', (_req, res) => res.json({ ok: true }));
    const server = await listen(mini);
    const res = await fetch(`${server.base}/x`);
    expectProtected(production ? 'PRODUCTION mode' : 'development mode', res.headers, { hsts: production });
    if (production) record(!String(res.headers.get('strict-transport-security')).includes('preload'), 'HSTS does not opt in to the browsers\' preload list (hard to undo)');
    server.close();
  }

  // ---------------------------------------------------- downloads (TOR PDFs)
  const pdfPath = path.join(os.tmpdir(), `security-headers-check-${process.pid}.pdf`);
  fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n');
  const dl = express();
  dl.disable('x-powered-by');
  dl.use(securityHeaders(true));
  dl.get('/tor', (_req, res) => res.download(pdfPath, 'tor.pdf'));
  const dlServer = await listen(dl);
  const file = await fetch(`${dlServer.base}/tor`);
  record(file.status === 200 && (file.headers.get('content-disposition') ?? '').includes('tor.pdf'), 'a file download still works');
  expectProtected('file download', file.headers, { hsts: true });
  const csp = file.headers.get('content-security-policy') ?? '';
  record(!/object-src|default-src|sandbox/.test(csp), 'the CSP on a download has no object-src/default-src/sandbox (those can stop a browser\'s built-in PDF viewer)', csp);
  record((file.headers.get('content-type') ?? '').includes('pdf'), 'the file keeps its own Content-Type (nosniff relies on it being right)', String(file.headers.get('content-type')));
  dlServer.close();
  fs.unlinkSync(pdfPath);

  // ------------------------------------------------------------ wiring in source
  const src = fs.readFileSync(path.join(__dirname, '../../src/app.ts'), 'utf8');
  const at = (needle: string) => src.indexOf(needle);
  record(at("app.disable('x-powered-by')") !== -1, "app.ts disables Express's X-Powered-By itself");
  record(at('app.use(securityHeaders(isProduction))') !== -1, 'app.ts installs the security headers, driven by the real production flag');
  record(at('securityHeaders(isProduction)') < at('cors(') && at('securityHeaders(isProduction)') < at("app.use('/api/v1'"), 'the headers are installed BEFORE cors and before every route, so nothing can skip them');

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
