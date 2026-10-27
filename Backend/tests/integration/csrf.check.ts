import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { corsOrigins, env } from '../../src/config/env';
import { evaluateCsrf } from '../../src/middlewares/csrf.middleware';
import { Account, AccountRole } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { createSession } from '../../src/services/session.service';

// CSRF protection. Uses its own throwaway database (dropped at the start and
// end) -- never touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-csrf-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const FRONTEND = corsOrigins[0];
const EVIL = 'https://evil.example';

async function main(): Promise<void> {
  // =========================================================== decision matrix (pure)
  const allowed = ['http://localhost:3000', 'https://app.example.com/'];
  const verdict = (i: Parameters<typeof evaluateCsrf>[0]) => evaluateCsrf(i, allowed);
  const JSON_CT = 'application/json';
  const ok = (i: Parameters<typeof evaluateCsrf>[0]) => verdict(i).allowed;
  const err = (i: Parameters<typeof evaluateCsrf>[0]) => { const v = verdict(i); return v.allowed ? 'allowed' : v.error; };

  // reads never need a check
  record(['GET', 'HEAD', 'OPTIONS'].every(method => ok({ method, origin: EVIL, secFetchSite: 'cross-site' })), 'matrix: GET, HEAD and OPTIONS are never blocked (they change nothing)');
  record(ok({ method: 'get', origin: EVIL }), 'matrix: the method is matched case-insensitively');

  // who sent it
  record(ok({ method: 'POST', origin: 'http://localhost:3000', contentType: JSON_CT }), 'matrix: an allowed Origin passes');
  record(ok({ method: 'POST', origin: 'https://app.example.com', contentType: JSON_CT }), 'matrix: an allowlist entry written with a trailing slash still matches');
  record(ok({ method: 'POST', origin: 'HTTP://LOCALHOST:3000', contentType: JSON_CT }), 'matrix: origin comparison ignores case');
  record(err({ method: 'POST', origin: EVIL, contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: an unlisted Origin is blocked');
  record(err({ method: 'POST', origin: 'null', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: "Origin: null" (sandboxed frame, some redirects) is blocked');
  record(err({ method: 'POST', origin: 'http://localhost:3000.evil.example', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: a look-alike host that merely STARTS with an allowed origin is blocked');
  record(err({ method: 'POST', origin: 'http://localhost:3000/path', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: an origin must match exactly, not as a prefix');
  record(err({ method: 'POST', origin: 'http://localhost:3001', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: the same host on another port is a different origin and is blocked');
  record(err({ method: 'POST', origin: 'http://sibling.localhost:3000', secFetchSite: 'same-site', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: a same-SITE sibling that is not allowlisted is blocked (SameSite alone would have let it through)');
  record(ok({ method: 'POST', origin: 'http://localhost:3000', secFetchSite: 'cross-site', contentType: JSON_CT }), 'matrix: an allowed Origin passes even when Sec-Fetch-Site says cross-site (a frontend on another site)');
  record(ok({ method: 'POST', origin: 'http://localhost:3000', secFetchSite: 'same-site', contentType: JSON_CT }), 'matrix: an allowed Origin passes with Sec-Fetch-Site same-site (frontend and API on one site)');

  // no Origin: fall back to Sec-Fetch-Site
  record(ok({ method: 'POST', secFetchSite: 'same-origin', contentType: JSON_CT }), 'matrix: no Origin + Sec-Fetch-Site same-origin passes');
  record(ok({ method: 'POST', secFetchSite: 'none', contentType: JSON_CT }), 'matrix: no Origin + Sec-Fetch-Site none (user-initiated) passes');
  record(err({ method: 'POST', secFetchSite: 'cross-site', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: no Origin + Sec-Fetch-Site cross-site is blocked');
  record(err({ method: 'POST', secFetchSite: 'same-site', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: no Origin + Sec-Fetch-Site same-site is blocked (it could be a sibling subdomain)');
  record(err({ method: 'POST', secFetchSite: 'SAME-SITE', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: Sec-Fetch-Site is read case-insensitively');
  record(err({ method: 'POST', secFetchSite: 'garbage', contentType: JSON_CT }) === 'CSRF_BLOCKED', 'matrix: an unrecognised Sec-Fetch-Site value is blocked, not trusted');
  record(ok({ method: 'POST', contentType: JSON_CT }), 'matrix: neither header (curl, scripts, server-to-server) passes: there is no victim browser to abuse');

  // what it is
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    record(err({ method, contentType: undefined }) === 'UNSUPPORTED_MEDIA_TYPE', `matrix: ${method} with NO Content-Type is refused (415), even without a body`);
    record(ok({ method, contentType: JSON_CT }), `matrix: ${method} with application/json passes`);
  }
  for (const bad of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'application/json5', 'application/vnd.api+json', 'application/xml', 'text/plain; application/json', '']) {
    record(err({ method: 'POST', contentType: bad }) === 'UNSUPPORTED_MEDIA_TYPE', `matrix: Content-Type "${bad}" is refused (415)`);
  }
  for (const good of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json ;charset=utf-8', '  application/json  ']) {
    record(ok({ method: 'POST', contentType: good }), `matrix: Content-Type "${good}" is accepted`);
  }
  record(err({ method: 'POST', origin: EVIL, contentType: 'text/plain' }) === 'CSRF_BLOCKED', 'matrix: when BOTH are wrong, the origin failure (403) is reported first');

  // ================================================================ real HTTP
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Account.init(), AuditLog.init()]);

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, opts: { headers?: Record<string, string>; body?: string; json?: boolean } = {}) {
    const headers: Record<string, string> = { ...(opts.json === false ? {} : { 'Content-Type': 'application/json' }), ...opts.headers };
    const res = await fetch(base + p, { method, headers, body: opts.body });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  }
  // "reached the application" = it got past CSRF and was answered by the route itself
  const reached = (r: { status: number; json: any }) => ![403, 415].includes(r.status) || !['CSRF_BLOCKED', 'UNSUPPORTED_MEDIA_TYPE'].includes(r.json?.error?.code);

  // --- who sent it
  const login = (headers: Record<string, string>) => call('POST', '/auth/login', { headers, body: '{}' });
  const fromFrontend = await login({ Origin: FRONTEND });
  record(fromFrontend.status === 400 && fromFrontend.json?.error?.code === 'VALIDATION_ERROR', 'HTTP: a request from the allowed frontend origin reaches the login handler', `${fromFrontend.status}`);
  const noHeaders = await login({});
  record(noHeaders.status === 400, 'HTTP: a header-less client (curl, scripts) reaches the handler', `${noHeaders.status}`);
  const evil = await login({ Origin: EVIL });
  record(evil.status === 403 && evil.json?.error?.code === 'CSRF_BLOCKED', 'HTTP: a request from a foreign origin is refused with 403 CSRF_BLOCKED', `${evil.status} ${evil.json?.error?.code}`);
  record((await login({ Origin: 'null' })).status === 403, 'HTTP: "Origin: null" is refused');
  record((await login({ Origin: `${FRONTEND}.evil.example` })).status === 403, 'HTTP: a look-alike of the allowed origin is refused');
  record((await login({ 'Sec-Fetch-Site': 'cross-site' })).status === 403, 'HTTP: Sec-Fetch-Site cross-site with no Origin is refused');
  record((await login({ 'Sec-Fetch-Site': 'same-site' })).status === 403, 'HTTP: Sec-Fetch-Site same-site with no Origin is refused');
  record((await login({ 'Sec-Fetch-Site': 'same-origin' })).status === 400, 'HTTP: Sec-Fetch-Site same-origin with no Origin reaches the handler');
  record((await login({ Origin: FRONTEND, 'Sec-Fetch-Site': 'same-site' })).status === 400, 'HTTP: the real browser case (allowed Origin + same-site) reaches the handler');
  record((await login({ Origin: FRONTEND, 'Sec-Fetch-Site': 'cross-site' })).status === 400, 'HTTP: an allowed Origin on another site (Sec-Fetch-Site cross-site) reaches the handler');
  record((await login({ Origin: EVIL, 'Sec-Fetch-Site': 'same-site' })).status === 403, 'HTTP: a same-site but unlisted origin is refused');

  // --- what it is
  for (const [type, label] of [['text/plain', 'text/plain'], ['application/x-www-form-urlencoded', 'a form post'], ['multipart/form-data; boundary=x', 'multipart']] as const) {
    const r = await call('POST', '/auth/login', { headers: { 'Content-Type': type, Origin: FRONTEND }, body: 'email=a&password=b' });
    record(r.status === 415 && r.json?.error?.code === 'UNSUPPORTED_MEDIA_TYPE', `HTTP: ${label} from the allowed origin is refused with 415`, `${r.status}`);
  }
  record((await call('POST', '/auth/login', { headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{}' })).status === 400, 'HTTP: application/json; charset=utf-8 is accepted');

  // every state-changing method, with and without the JSON type (these routes need a login, so "reached" = 401)
  const targets: [string, string][] = [['POST', '/auth/logout'], ['PATCH', '/account/profile'], ['PUT', '/admin/works/000000000000000000000000/tags'], ['DELETE', '/follows/tags/000000000000000000000000']];
  for (const [method, p] of targets) {
    const bare = await call(method, p, { json: false });
    record(bare.status === 415 && bare.json?.error?.code === 'UNSUPPORTED_MEDIA_TYPE', `HTTP: ${method} ${p} with no Content-Type is refused (415)`, `${bare.status}`);
    const withJson = await call(method, p, { body: method === 'DELETE' ? undefined : '{}' });
    record(withJson.status === 401, `HTTP: ${method} ${p} with JSON reaches the route (401: not signed in)`, `${withJson.status}`);
  }

  // reads and preflights are untouched
  const evilRead = await fetch(`${base}/tags`, { headers: { Origin: EVIL } });
  record(evilRead.status !== 403 && evilRead.headers.get('access-control-allow-origin') === null, 'HTTP: a GET from a foreign origin is not blocked, but gets no CORS access (the page cannot read it)', `${evilRead.status}`);
  const preflight = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  record(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === FRONTEND, 'HTTP: the legitimate CORS preflight still succeeds');
  const evilPreflight = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  record(evilPreflight.headers.get('access-control-allow-origin') === null, 'HTTP: a foreign origin\'s preflight is not granted');

  // --- shape of a refusal
  record(evil.json?.success === false && !JSON.stringify(evil.json).includes(EVIL) && !JSON.stringify(evil.json).includes('Origin'), 'HTTP: a 403 refusal is generic: it does not echo the origin or explain the rule', JSON.stringify(evil.json));
  record(evil.headers.get('x-content-type-options') === 'nosniff' && evil.headers.get('x-powered-by') === null, 'HTTP: a refusal still carries the security headers');
  const wrongTypeFromFrontend = await call('POST', '/auth/login', { headers: { 'Content-Type': 'text/plain', Origin: FRONTEND }, body: 'x' });
  record(wrongTypeFromFrontend.headers.get('access-control-allow-origin') === FRONTEND, 'HTTP: a 415 to the allowed frontend still carries CORS headers, so the app can read the error');
  const bigBad = await call('POST', '/auth/login', { headers: { 'Content-Type': 'text/plain', Origin: FRONTEND }, body: 'x'.repeat(900_000) });
  record(bigBad.status === 415, 'HTTP: a large wrong-type body is refused before it is parsed');

  // ============================================== real attack simulation (DB)
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const admin = await mk('admin@example.com', 'admin', { permissions: ['poll&tag:manage'] });
  const vendor = await mk('vendor@example.com', 'user');
  const adminCookie = `${SESSION_COOKIE_NAME}=${(await createSession(admin._id, {})).rawToken}`;
  await AuditLog.collection.deleteMany({});
  const suspendPath = `/admin/accounts/${vendor._id}/suspend`;
  const vendorStatus = async () => (await Account.findById(vendor._id))!.status;

  // The attack: the victim (a logged-in admin) visits a hostile page. Their browser
  // sends the admin's cookie; the hostile page controls everything else.
  const attacks: [string, Record<string, string>, boolean][] = [
    ['a JSON request from a foreign origin', { Origin: EVIL }, true],
    ['a form-style "simple" request from a foreign origin', { Origin: EVIL, 'Content-Type': 'text/plain' }, true],
    ['a body-less POST with no Content-Type (needs no preflight)', { Origin: EVIL }, false],
    ['a request from a same-site sibling (SameSite=Lax would NOT stop this)', { Origin: 'https://sibling.example', 'Sec-Fetch-Site': 'same-site' }, true],
    ['a sandboxed frame (Origin: null)', { Origin: 'null' }, true],
    ['a cross-site request with the Origin stripped', { 'Sec-Fetch-Site': 'cross-site' }, true]
  ];
  for (const [label, headers, withJson] of attacks) {
    const r = await call('PATCH', suspendPath, { headers: { Cookie: adminCookie, ...headers }, body: withJson ? '{}' : undefined, json: withJson });
    record([403, 415].includes(r.status) && (await vendorStatus()) === 'active', `ATTACK blocked: ${label}`, `${r.status}, vendor still ${await vendorStatus()}`);
  }
  record((await AuditLog.countDocuments({})) === 0, 'ATTACK: none of the blocked requests left any trace in the audit log (no handler ran)');

  const victimCookieMe = await call('GET', '/auth/me', { headers: { Cookie: adminCookie } });
  const logoutAttack = await call('POST', '/auth/logout', { headers: { Cookie: adminCookie, Origin: EVIL }, body: '{}' });
  record(logoutAttack.status === 403 && (await call('GET', '/auth/me', { headers: { Cookie: adminCookie } })).status === 200 && victimCookieMe.status === 200, 'ATTACK blocked: a forced logout does not end the victim\'s session');

  const loginAttack = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: EVIL }, body: JSON.stringify({ email: 'vendor@example.com', password: 'Password123' }) });
  record(loginAttack.status === 403 && loginAttack.headers.get('set-cookie') === null, 'ATTACK blocked: login CSRF (forcing a victim into the attacker\'s account) sets no cookie');

  // the same actions, from the real frontend, still work
  const legit = await call('PATCH', suspendPath, { headers: { Cookie: adminCookie, Origin: FRONTEND, 'Sec-Fetch-Site': 'same-site' }, body: '{}' });
  record(legit.status === 200 && (await vendorStatus()) === 'suspended', 'LEGIT: the same suspend from the allowed frontend origin works', `${legit.status}`);
  const legitRe = await call('PATCH', `/admin/accounts/${vendor._id}/reactivate`, { headers: { Cookie: adminCookie }, body: '{}' });
  record(legitRe.status === 200 && (await vendorStatus()) === 'active', 'LEGIT: a header-less client with the cookie still works (non-browser use)');
  record((await AuditLog.countDocuments({ action: 'account.suspend' })) === 1, 'LEGIT: and the audit log recorded the real suspend exactly once');
  server.close();

  // ============================================ COOKIE_SAMESITE=none (the finding)
  // Run the app in a child process with SameSite=None, since the cookie options are fixed at start-up.
  const probe = path.join(os.tmpdir(), `csrf-samesite-none-${process.pid}.ts`);
  const backendRoot = path.join(__dirname, '../..');
  fs.writeFileSync(
    probe,
    `import { createApp } from ${JSON.stringify(path.join(backendRoot, 'src/app'))};
     import { sessionCookieOptions } from ${JSON.stringify(path.join(backendRoot, 'src/config/cookie'))};
     const server = createApp().listen(0, async () => {
       const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/v1';
       const post = (origin: string | null) => fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}' }).then(r => r.status);
       console.log('RESULT ' + JSON.stringify({ sameSite: sessionCookieOptions.sameSite, secure: sessionCookieOptions.secure, evil: await post(${JSON.stringify(EVIL)}), frontend: await post(${JSON.stringify(FRONTEND)}) }));
       server.close(); process.exit(0);
     });`
  );
  const runChild = (sameSite: string) => {
    const run = spawnSync('npx', ['tsx', probe], { cwd: backendRoot, env: { ...process.env, COOKIE_SAMESITE: sameSite, SMTP_HOST: '' }, encoding: 'utf8' });
    const output = `${run.stdout}\n${run.stderr}`; // the warning goes to stderr
    return { result: JSON.parse(output.split('\n').find(l => l.startsWith('RESULT '))!.slice(7)), output };
  };
  const none = runChild('none');
  record(none.result.sameSite === 'none' && none.result.secure === true, 'SameSite=None: the session cookie really is SameSite=None; Secure in this configuration');
  record(none.result.evil === 403 && none.result.frontend === 400, 'SameSite=None: a foreign origin is STILL refused (403) while the real frontend is served (the finding\'s scenario)', JSON.stringify(none.result));
  record(none.output.includes('COOKIE_SAMESITE=none') && none.output.includes(FRONTEND), 'SameSite=None: the server warns at start-up that CSRF protection now depends on CORS_ORIGIN, and lists it');
  const lax = runChild('lax');
  record(lax.result.evil === 403 && !lax.output.includes('COOKIE_SAMESITE=none'), 'SameSite=Lax: protection is on too, and there is no warning');
  fs.unlinkSync(probe);

  // ============================================================ wiring in source
  const src = fs.readFileSync(path.join(__dirname, '../../src/app.ts'), 'utf8');
  const at = (needle: string) => src.indexOf(needle);
  record(at('csrfProtection(corsOrigins)') !== -1, 'app.ts installs the CSRF protection with the same allowlist as CORS (CORS_ORIGIN)');
  record(at('cors(') < at('csrfProtection(corsOrigins)') && at('csrfProtection(corsOrigins)') < at('express.json(') && at('csrfProtection(corsOrigins)') < at("app.use('/api/v1'"), 'it runs after CORS, before the body parser and before every route');
  record(at('securityHeaders(isProduction)') < at('csrfProtection(corsOrigins)'), 'and after the security headers, so refusals carry them');
  void reached;

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
