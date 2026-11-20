// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import http from 'node:http';
import net from 'node:net';
import util from 'node:util';
import mongoose from 'mongoose';
import { Agent, setGlobalDispatcher } from 'undici';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { installEgressProxy } from '../../src/config/egressProxy';
import { downloadTorFile } from '../../src/integrations/egpRss.client';
import { loginLimiter } from '../../src/middlewares/rateLimit.middleware';
import { Account } from '../../src/models/account.model';
import { assertFileIsClean, MalwareFoundError, ScannerUnavailableError } from '../../src/services/antivirus.service';
import { createSession } from '../../src/services/session.service';
import { logger } from '../../src/utils/logger';
import { maskEmail } from '../../src/utils/privacy';
import { isAllowedOutbound, OutboundBlockedError, outboundFetch } from '../../src/utils/outbound';

// Groups 7 and 8 of the OWASP ASVS plan (2026-11-20):
//   logging  -- V16.2.4 structured JSON, V16.4.1 no log injection, V16.3.1 auth
//               events, V16.3.2 refused authorization, V16.3.3 rejected input /
//               bypass attempts, V16.2.5 nothing secret, personal data masked
//   outbound -- V13.2.4 one allow-list, V1.3.6 SSRF, V15.3.2 redirects checked,
//               V13.2.5 the egress-proxy wiring, V5.4.3 the antivirus scan
// Run: npm run check:logging-outbound

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-logging-outbound-check';
if (!/check/i.test(new URL(MONGODB_URI).pathname)) {
  console.error('Refusing to run: this check drops its database, whose name must contain "check".');
  process.exit(2);
}
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// Every console line while `fn` runs, as written to the terminal.
const real = { log: console.log, warn: console.warn, error: console.error };
async function capture(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  console.log = console.warn = console.error = (...args: unknown[]) => lines.push(util.format(...args));
  try {
    await fn();
  } finally {
    Object.assign(console, real);
  }
  return lines;
}
const parsed = (lines: string[]) => lines.flatMap(line => {
  try {
    return [JSON.parse(line) as Record<string, any>];
  } catch {
    return [];
  }
});

function listen(server: http.Server | net.Server): Promise<number> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(mongoose.modelNames().map(name => mongoose.model(name).createIndexes()));

  const app = createApp().listen(0);
  await new Promise<void>(resolve => app.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(app.address() as net.AddressInfo).port}/api/v1`;
  const call = async (method: string, path: string, opts: { cookie?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...opts.headers },
      body: method === 'GET' ? undefined : (opts.body ?? '{}')
    });
    await res.text();
    return { status: res.status, requestId: res.headers.get('x-request-id'), cookie: res.headers.getSetCookie()[0]?.split(';')[0] };
  };
  const clearLimits = () => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].forEach(k => (loginLimiter as unknown as { resetKey(k: string): void }).resetKey(k));

  // ================================================================ logging
  // V16.2.4 + V16.4.1: one JSON object per line, control characters escaped.
  const injected = await capture(async () => logger.warn('check', 'line one\r\n{"level":"info","msg":"forged line"}\u001b[31m'));
  const one = parsed(injected)[0];
  record(injected.length === 1 && !injected[0].includes('\n') && !injected[0].includes('\r') && !injected[0].includes('\u001b'), 'V16.4.1: CR, LF and control characters in a message stay inside ONE escaped line -- no forged entries', injected[0]);
  record(!!one && one.level === 'warn' && one.scope === 'check' && typeof one.time === 'string' && one.msg.includes('forged line'), 'V16.2.4: the line is JSON with time, level, scope and msg');
  const withError = parsed(await capture(async () => logger.error('check', 'boom happened', new Error('the cause'))))[0];
  record(withError?.err?.message === 'the cause' && typeof withError.err.stack === 'string', 'V16.2.4: an error is logged as a structured err {name, message, stack}');

  const vendor = await Account.create({ email: 'somchai.logs@example.com', passwordHash: 'Correct-Horse-77', name: 'Somchai Logs', type: 'individual' });
  const admin = await Account.create({ email: 'admin.logs@example.com', passwordHash: 'Admin-Horse-77', name: 'Admin Logs', role: 'superadmin' });

  // V16.3.1: sign-in failure and success, with masked email, never the password.
  clearLimits();
  const failLines = await capture(() => call('POST', '/auth/login', { body: JSON.stringify({ email: 'somchai.logs@example.com', password: 'Wrong-Guess-123' }) }));
  const failure = parsed(failLines).find(l => l.event === 'auth.login.failure');
  record(failure?.reason === 'invalid_credentials' && failure.scope === 'security' && failure.level === 'warn' && failure.email === maskEmail('somchai.logs@example.com') && !!failure.ip, 'V16.3.1: a failed sign-in is a security event with the reason, a masked email and the address', JSON.stringify(failure));
  record(!failLines.join('\n').includes('Wrong-Guess-123') && !failLines.join('\n').includes('somchai.logs@'), 'V16.2.5: neither the password nor the full email address is in the logs');
  clearLimits();
  let sessionCookie = '';
  const okLines = await capture(async () => {
    sessionCookie = (await call('POST', '/auth/login', { body: JSON.stringify({ email: 'somchai.logs@example.com', password: 'Correct-Horse-77' }) })).cookie ?? '';
  });
  const success = parsed(okLines).find(l => l.event === 'auth.login.success');
  record(success?.accountId === String(vendor._id) && !!success.sessionId, 'V16.3.1: a successful sign-in is logged with the account and session id');
  record(!okLines.join('\n').includes(sessionCookie.split('=')[1] ?? '###'), 'V16.2.5: the session token itself never appears in the logs');

  // Lockout: four free failures, the fifth starts a lock.
  const lockout = await capture(async () => {
    for (let i = 0; i < 5; i++) {
      clearLimits();
      await call('POST', '/auth/login', { body: JSON.stringify({ email: 'admin.logs@example.com', password: 'nope-nope-nope' }) });
    }
  });
  record(parsed(lockout).some(l => l.event === 'auth.lockout' && l.accountId === String(admin._id) && !!l.lockedUntil), 'V16.3.1: the failure that locks an account logs auth.lockout with the lock end');

  // Access log + request id correlation.
  const accessLines = parsed(await capture(async () => {
    const r = await call('GET', '/works?q=secret-search-text&page=2');
    (globalThis as any).lastRequestId = r.requestId;
  }));
  const access = accessLines.find(l => l.event === 'http.request');
  record(access?.path === '/api/v1/works' && access.status === 200 && access.requestId === (globalThis as any).lastRequestId && typeof access.ms === 'number', 'access log: one JSON line per request (method, path, status, ms, ip) whose requestId matches the X-Request-Id header', JSON.stringify(access));
  record(!accessLines.some(l => JSON.stringify(l).includes('secret-search-text')), 'access log: the query string (search text) is never logged');

  // V16.3.2: refused authorization.
  const vendorCookie = sessionCookie;
  const denied = parsed(await capture(async () => {
    await call('GET', '/auth/me');
    await call('GET', '/admin/dashboard', { cookie: vendorCookie });
  })).filter(l => l.event === 'access.denied');
  record(denied.some(l => l.status === 401 && l.code === 'NOT_AUTHENTICATED' && l.path === '/api/v1/auth/me'), 'V16.3.2: a request without a session is logged as access.denied 401');
  record(denied.some(l => l.status === 403 && l.code === 'FORBIDDEN' && l.actor?.id === String(vendor._id)), 'V16.3.2: a vendor reaching an admin route is logged as access.denied 403, with who it was');

  // V16.3.3: validation failures and bypass attempts.
  const rejected = parsed(await capture(async () => {
    await call('PATCH', '/account/profile', { cookie: vendorCookie, body: JSON.stringify({ phone: 'definitely-not-a-phone' }) });
    await call('POST', '/auth/login', { body: JSON.stringify({ email: { $ne: null }, password: 'x', $where: 'sleep(1000)', __proto__: { admin: true } }) });
    await call('POST', '/auth/logout', { cookie: vendorCookie, headers: { Origin: 'https://evil.example' } });
  }));
  const invalid = rejected.find(l => l.event === 'input.rejected' && l.path === '/api/v1/account/profile');
  record(invalid?.code === 'VALIDATION_ERROR' && JSON.stringify(invalid.fields) === '["phone"]' && !JSON.stringify(invalid).includes('definitely-not-a-phone'), 'V16.3.3: a validation failure is logged with the field NAMES, never the values', JSON.stringify(invalid));
  const probe = rejected.find(l => l.event === 'input.dangerous_keys_dropped');
  record(!!probe && probe.keys.includes('$where') && probe.keys.includes('$ne'), 'V16.3.3: $-operator keys (NoSQL injection attempt) are logged when dropped', JSON.stringify(probe?.keys));
  record(rejected.some(l => l.event === 'csrf.blocked' && l.origin === 'https://evil.example'), 'V16.3.3: a cross-site request is logged as csrf.blocked with its origin');

  // Session lifecycle events.
  const lifecycle = parsed(await capture(() => call('POST', '/auth/logout', { cookie: vendorCookie })));
  record(lifecycle.some(l => l.event === 'auth.logout'), 'V16.3.1: sign-out is logged');

  // ================================================================ outbound
  // V13.2.4: the one allow-list, by purpose.
  record(
    ['https://process5.gprocurement.go.th/x.pdf', 'http://process.gprocurement.go.th/a', 'https://gprocurement.go.th/'].every(u => isAllowedOutbound('egp', u)),
    'V13.2.4: e-GP calls may reach gprocurement.go.th and its subdomains'
  );
  record(
    ['https://gprocurement.go.th.evil.example/', 'https://evilgprocurement.go.th/', 'ftp://process5.gprocurement.go.th/x', 'https://user:pw@process5.gprocurement.go.th/', 'http://169.254.169.254/latest/meta-data', 'https://data.go.th/', 'not a url'].every(u => !isAllowedOutbound('egp', u)),
    'V13.2.4: look-alike domains, other schemes, URLs with credentials, the cloud metadata address and other services are refused for e-GP'
  );
  record(isAllowedOutbound('hibp', 'https://api.pwnedpasswords.com/range/ABCDE') && !isAllowedOutbound('hibp', 'https://process5.gprocurement.go.th/'), 'V13.2.4: each purpose has its own hosts (HIBP only reaches HIBP)');

  // A local "e-GP" server: 127.0.0.1 is the configured feed host in tests (allowed);
  // "localhost" reaches the same server but is NOT on the list.
  const hits: string[] = [];
  const egp = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/redirect-out') return res.writeHead(302, { Location: `http://localhost:${egpPort}/target` }).end();
    if (req.url === '/redirect-in') return res.writeHead(302, { Location: '/file.pdf' }).end();
    if (req.url?.startsWith('/loop')) return res.writeHead(302, { Location: `/loop${hits.length}` }).end();
    if (req.url === '/post-redirect') return res.writeHead(307, { Location: '/file.pdf' }).end();
    res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF-1.4 test');
  });
  const egpPort = await listen(egp);
  const feedHost = new URL(env.EGP_RSS_BASE_URL).hostname;
  record(feedHost === '127.0.0.1', 'setup: the feed host in tests is 127.0.0.1', feedHost);
  const at = (path: string, host = '127.0.0.1') => `http://${host}:${egpPort}${path}`;

  const followed = await outboundFetch('egp', at('/redirect-in'));
  record(followed.status === 200 && hits.includes('/file.pdf'), 'V15.3.2: a redirect to an allowed host is followed');
  hits.length = 0;
  const outLines = await capture(async () => {
    const err = await outboundFetch('egp', at('/redirect-out')).then(() => null, e => e);
    (globalThis as any).outErr = err;
  });
  record((globalThis as any).outErr instanceof OutboundBlockedError && !hits.includes('/target'), 'V1.3.6 / V15.3.2: a redirect to a host off the list is refused BEFORE it is requested', String((globalThis as any).outErr));
  record(parsed(outLines).some(l => l.event === 'outbound.blocked' && l.purpose === 'egp' && l.host === 'localhost'), 'V1.3.6: the blocked call is a security event (outbound.blocked) for alerting');
  hits.length = 0;
  const loop = await outboundFetch('egp', at('/loop0')).then(() => null, e => e);
  record(loop instanceof OutboundBlockedError && /more than 5 redirects/.test(loop.message) && hits.length === 6, 'V15.3.2: at most 5 redirects are followed', `${hits.length} requests`);
  const post = await outboundFetch('egp', at('/post-redirect'), { method: 'POST', body: '{}' }).then(() => null, e => e);
  record(post instanceof OutboundBlockedError && /unexpected redirect of a POST/.test(post.message), 'V15.3.2: a redirected POST is never replayed elsewhere');
  hits.length = 0;
  const ssrf = await downloadTorFile(at('/file.pdf', 'localhost')).then(() => null, e => e);
  record(ssrf instanceof OutboundBlockedError && hits.length === 0, 'V1.3.6: a TOR link on a host off the list is never downloaded (it used to follow any feed link)');
  const allowedDownload = await downloadTorFile(at('/file.pdf'));
  record(allowedDownload.buffer.toString().startsWith('%PDF'), 'V1.3.6: a TOR link on an allowed host still downloads');

  // V13.2.5: with HTTPS_PROXY / HTTP_PROXY set, every fetch goes through the egress proxy.
  // undici tunnels every request through CONNECT (http:// ones too), like Squid expects.
  const proxied: string[] = [];
  const proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on('connect', (req, client, head) => {
    proxied.push(req.url ?? '');
    const [host, port] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
  process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
  process.env.NO_PROXY = 'mongo,clamav';
  installEgressProxy();
  const viaProxy = await fetch(`http://127.0.0.1:${egpPort}/through-proxy`).then(r => r.text());
  setGlobalDispatcher(new Agent());
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.NO_PROXY;
  record(viaProxy.startsWith('%PDF') && proxied.includes(`127.0.0.1:${egpPort}`) && hits.includes('/through-proxy'), 'V13.2.5: once HTTPS_PROXY is set, fetch() goes through the egress proxy (a CONNECT tunnel via undici EnvHttpProxyAgent)', proxied.join(','));

  // V5.4.3: the antivirus scan, against a fake clamd speaking INSTREAM.
  const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  let clamdMode: 'scan' | 'error' = 'scan';
  const clamd = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = 'zINSTREAM\0';
      if (buffer.length < command.length) return;
      let offset = command.length;
      const parts: Buffer[] = [];
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          const content = Buffer.concat(parts).toString('latin1');
          const verdict = clamdMode === 'error' ? 'INSTREAM size limit exceeded. ERROR' : content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK';
          socket.end(`${verdict}\0`);
          return;
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  const clamdPort = await listen(clamd);
  Object.assign(env, { CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: clamdPort, CLAMAV_TIMEOUT_MS: 3000 });
  const big = Buffer.alloc(300 * 1024, 'a'); // several 64 KB chunks
  const clean = await assertFileIsClean(Buffer.concat([Buffer.from('%PDF-1.4 '), big]), 'https://process5.gprocurement.go.th/x.pdf').then(() => 'clean', e => e);
  record(clean === 'clean', 'V5.4.3: a clean file (sent in several INSTREAM chunks) passes');
  const malwareLines = await capture(async () => {
    (globalThis as any).infected = await assertFileIsClean(Buffer.from(EICAR), 'https://process5.gprocurement.go.th/evil.pdf').then(() => 'clean', e => e);
  });
  record((globalThis as any).infected instanceof MalwareFoundError && (globalThis as any).infected.signature === 'Eicar-Test-Signature', 'V5.4.3: the EICAR test file is reported as malware', String((globalThis as any).infected));
  record(parsed(malwareLines).some(l => l.event === 'tor.malware_found' && l.sourceHost === 'process5.gprocurement.go.th'), 'V5.4.3: and logged as tor.malware_found (alert rule MalwareInTorFile)');
  clamdMode = 'error';
  const limit = await assertFileIsClean(Buffer.from('%PDF'), 'x').then(() => 'clean', e => e);
  record(limit instanceof ScannerUnavailableError, 'V5.4.3: a scanner error ("size limit exceeded") is never taken as clean');
  Object.assign(env, { CLAMAV_PORT: 9 });
  const down = await assertFileIsClean(Buffer.from('%PDF'), 'x').then(() => 'clean', e => e);
  record(down instanceof ScannerUnavailableError, 'V5.4.3: an unreachable scanner fails closed (the file is retried at the next poll, not stored)');
  Object.assign(env, { CLAMAV_HOST: undefined });

  const ingestionSrc = (await import('node:fs')).readFileSync(require.resolve('../../src/services/ingestion.service.ts'), 'utf8');
  const pdfBranch = ingestionSrc.slice(ingestionSrc.indexOf("if (item.linkType === 'pdf')"));
  const zipBranch = ingestionSrc.slice(ingestionSrc.indexOf("if (item.linkType === 'zip')"));
  record(pdfBranch.indexOf('assertFileIsClean') < pdfBranch.indexOf('saveTorFile') && zipBranch.indexOf('assertFileIsClean') < zipBranch.indexOf('extractPdfsFromZip'), 'V5.4.3: ingestion scans a PDF before storing it, and a ZIP before unpacking it');

  for (const server of [app, egp, proxy, clamd]) server.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  Object.assign(console, real);
  console.error('check failed to run', err);
  process.exit(2);
});
