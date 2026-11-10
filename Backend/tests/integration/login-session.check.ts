// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import { spawn } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../../src/config/cookie';
import { env, isProduction } from '../../src/config/env';
import { loginLimiter, passwordResetLimiter } from '../../src/middlewares/rateLimit.middleware';
import { Account, AccountRole } from '../../src/models/account.model';
import { Session, hashSessionToken } from '../../src/models/session.model';
import { FREE_ATTEMPTS } from '../../src/services/loginLockout.service';
import { createSession } from '../../src/services/session.service';
import { issueToken } from '../../src/services/token.service';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';
import { startFakeSmtp } from '../helpers/fakeSmtp';

// Login, session and brute-force protection (Use Case 6.2.1), through the real
// HTTP API. Uses its own throwaway database (dropped at the start and end) --
// never touches the dev database. Settings that are fixed at process start
// (NODE_ENV=production, COOKIE_SAMESITE, SESSION_TTL_DAYS) are checked in child
// processes (tests/helpers/authProbe.ts).
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-login-session-check';

mockPwnedPasswords();
// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const PASSWORD = 'SecurePass123';
const WRONG = 'WrongPass123';
const MINUTE = 60 * 1000;

interface Res {
  status: number;
  json: any;
  text: string;
  headers: Headers;
  cookies: string[];
}

function cookieAttrs(setCookie: string): { name: string; value: string; attrs: Map<string, string> } {
  const [pair, ...rest] = setCookie.split(';').map(part => part.trim());
  const eq = pair.indexOf('=');
  const attrs = new Map<string, string>();
  for (const part of rest) {
    const i = part.indexOf('=');
    attrs.set((i === -1 ? part : part.slice(0, i)).toLowerCase(), i === -1 ? '' : part.slice(i + 1));
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Account.init(), Session.init()]);
  const smtp = await startFakeSmtp(); // the password endpoints answer differently with no mail server

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;

  async function call(method: string, p: string, opts: { cookie?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Res> {
    const res = await fetch(base + p, {
      method,
      headers: { ...(opts.raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...opts.headers },
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body))
    }).catch(err => {
      throw new Error(`${method} ${p} failed: ${err.cause?.message ?? err.message}`);
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers, cookies: res.headers.getSetCookie() };
  }
  const login = (email: string, password: string, headers?: Record<string, string>) => call('POST', '/auth/login', { body: { email, password }, headers });
  const sessionCookie = (r: Res) => r.cookies.map(cookieAttrs).find(c => c.name === SESSION_COOKIE_NAME);
  const cookieHeader = (r: Res) => `${SESSION_COOKIE_NAME}=${sessionCookie(r)?.value}`;
  const code = (r: Res) => r.json?.error?.code;

  // ---------------------------------------------------------------- accounts
  const mk = (email: string, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: PASSWORD, name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role: 'user' as AccountRole, ...extra });
  const individual = await mk('individual@example.com');
  const business = await mk('business@example.com', { type: 'business', businessProfile: { companyName: 'Test Co Ltd', taxId: '0105558123456' } });
  const admin = await mk('admin@example.com', { role: 'admin', permissions: ['poll&tag:manage'] });
  const superAdmin = await mk('super@example.com', { role: 'superadmin' });
  const suspended = await mk('suspended@example.com', { status: 'suspended' });
  const unverified = await mk('unverified@example.com', { emailVerified: false });
  const suspendedUnverified = await mk('both@example.com', { status: 'suspended', emailVerified: false });
  // an account saved before the emailVerified field existed: it must not be locked out
  await Account.collection.insertOne({
    email: 'legacy@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), name: 'Legacy User', type: 'individual',
    status: 'active', role: 'user', permissions: [], createdAt: new Date(), updatedAt: new Date()
  });

  // The limiter is keyed by the client's address; read it from the first session, then reset between sections.
  const first = await login('individual@example.com', PASSWORD);
  const ip = (await Session.findOne({ accountId: individual._id }))!.ipAddress!;
  const fresh = () => {
    (loginLimiter as unknown as { resetKey(k: string): void }).resetKey(ip);
    (passwordResetLimiter as unknown as { resetKey(k: string): void }).resetKey(ip);
  };
  const state = async (id: unknown) => (await Account.findById(id).select('+failedLoginCount +lockedUntil +lastFailedLoginAt'))!;
  const clearLock = (id: unknown) => Account.updateOne({ _id: id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1, lastFailedLoginAt: 1 } });
  const expireLock = (id: unknown) => Account.updateOne({ _id: id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  record(!!ip && first.status === 200, 'setup: the client address is known (needed to reset the per-IP limiter between sections)', ip);

  // ======================================================= 1. one form for every account type
  fresh();
  const types: [string, string, Record<string, unknown>][] = [
    ['individual', 'individual@example.com', { type: 'individual', role: 'user' }],
    ['business', 'business@example.com', { type: 'business', role: 'user' }],
    ['admin', 'admin@example.com', { type: 'individual', role: 'admin' }],
    ['super admin', 'super@example.com', { type: 'individual', role: 'superadmin' }]
  ];
  for (const [label, email, expected] of types) {
    const r = await login(email, PASSWORD);
    const me = await call('GET', '/auth/me', { cookie: cookieHeader(r) });
    record(r.status === 200 && r.json.success === true && r.json.data.email === email, `login: the same form and endpoint signs in a ${label} account`, `${r.status}`);
    record(Object.entries(expected).every(([k, v]) => r.json.data[k] === v), `login: the ${label} response carries the right type and role`, JSON.stringify({ type: r.json.data?.type, role: r.json.data?.role }));
    record(me.status === 200 && me.json.data.email === email, `login: and /auth/me recognises that ${label} straight away`);
    const body = r.text + me.text;
    record(!/passwordHash|failedLoginCount|lockedUntil|lastFailedLoginAt|tokenHash|\$2[aby]\$/.test(body), `login: neither response for the ${label} leaks a hash, lockout bookkeeping or token hash`);
  }
  fresh();
  record((await login('  INDIVIDUAL@Example.COM ', PASSWORD)).status === 200, 'login: the email is trimmed and case-insensitive');
  const legacy = await login('legacy@example.com', PASSWORD);
  record(legacy.status === 200, 'login: an account saved before "emailVerified" existed can still sign in', `${legacy.status} ${code(legacy) ?? ''}`);

  // bad input and injection
  fresh();
  const sessionsBefore = await Session.countDocuments({});
  const malformed: [string, unknown][] = [
    ['no password', { email: 'individual@example.com' }],
    ['empty password', { email: 'individual@example.com', password: '' }],
    ['no email', { password: PASSWORD }],
    ['not an email', { email: 'not-an-email', password: PASSWORD }],
    ['an email with a space', { email: 'a b@example.com', password: PASSWORD }],
    ['an unknown extra field', { email: 'individual@example.com', password: PASSWORD, role: 'admin' }],
    ['a NoSQL operator as the email', { email: { $ne: null }, password: PASSWORD }],
    ['a NoSQL operator as the password', { email: 'individual@example.com', password: { $ne: '' } }],
    ['a regex operator as the email', { email: { $regex: '.*' }, password: PASSWORD }],
    ['an array as the email', { email: ['individual@example.com'], password: PASSWORD }],
    ['a number as the password', { email: 'individual@example.com', password: 12345678 }]
  ];
  for (const [label, body] of malformed) {
    fresh(); // malformed requests count toward the 10-per-15-minutes limit too
    const r = await call('POST', '/auth/login', { body });
    record(r.status === 400 && code(r) === 'VALIDATION_ERROR' && !sessionCookie(r), `login: ${label} -> 400 VALIDATION_ERROR, no cookie`, `${r.status}`);
  }
  fresh();
  const brokenJson = await call('POST', '/auth/login', { raw: '{"email": "secret-probe@example.com", oops', headers: { 'Content-Type': 'application/json' } });
  record(brokenJson.status === 400 && code(brokenJson) === 'BAD_REQUEST' && !brokenJson.text.includes('secret-probe') && !/position|token/i.test(brokenJson.text), 'login: a body that is not valid JSON -> 400 BAD_REQUEST (not a 500), and the parser\'s message is not echoed back', brokenJson.text);
  const bareString = await call('POST', '/auth/login', { raw: '"hello"', headers: { 'Content-Type': 'application/json' } });
  record(bareString.status === 400 && code(bareString) === 'BAD_REQUEST', 'login: a JSON body that is just a string -> 400, not a 500', `${bareString.status}`);
  // The server answers 413 and hangs up while the client is still uploading, so the client
  // sees either that 413 or a reset connection; both are a refusal. A one-shot connection,
  // so the next request does not try to reuse the socket the server just closed.
  const hugeOutcome = await new Promise<string>(resolve => {
    const payload = JSON.stringify({ email: 'individual@example.com', password: 'x'.repeat(1_100_000) });
    const req = http.request(
      { host: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/api/v1/auth/login', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => resolve(res.statusCode === 413 && body.includes('PAYLOAD_TOO_LARGE') ? '413' : `unexpected ${res.statusCode}`));
      }
    );
    req.on('error', err => resolve(/ECONNRESET|EPIPE/.test(String(err)) ? 'reset' : `error ${err}`));
    req.end(payload);
  });
  record(hugeOutcome === '413' || hugeOutcome === 'reset', 'login: a body over the 1 MB limit is refused (413 PAYLOAD_TOO_LARGE, or the connection is closed) before any password hashing', hugeOutcome);
  record((await call('POST', '/auth/login', { raw: 'email=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 415, 'login: a form-encoded body is refused (415)');
  record((await Session.countDocuments({})) === sessionsBefore, 'login: none of the malformed requests created a session');
  record((await call('GET', '/auth/login')).status === 404, 'login: it is POST-only (a GET finds nothing)');

  // ============================================ 2. identical 401s, and what is only said after the password
  fresh();
  const shape = (r: Res) => JSON.stringify([r.status, r.json, !!sessionCookie(r), r.headers.get('content-type'), r.headers.get('content-length')]);
  const unknown = await login('nobody@example.com', PASSWORD);
  const wrongs: [string, Res][] = [];
  for (const [label, email] of [['individual', 'individual@example.com'], ['business', 'business@example.com'], ['admin', 'admin@example.com'], ['suspended', 'suspended@example.com'], ['unverified', 'unverified@example.com'], ['suspended and unverified', 'both@example.com']] as const) {
    wrongs.push([label, await login(email, WRONG)]);
  }
  record(unknown.status === 401 && code(unknown) === 'INVALID_CREDENTIALS', 'identical 401: an unknown email -> 401 INVALID_CREDENTIALS', unknown.text);
  for (const [label, r] of wrongs) {
    record(shape(r) === shape(unknown), `identical 401: a wrong password on a ${label} account is byte-for-byte the same answer as an unknown email`, r.status === 401 ? '' : `${r.status} ${code(r)}`);
  }
  fresh();
  const suspendedRight = await login('suspended@example.com', PASSWORD);
  record(suspendedRight.status === 403 && code(suspendedRight) === 'ACCOUNT_SUSPENDED' && !sessionCookie(suspendedRight), '"suspended" is only revealed after the CORRECT password (403 ACCOUNT_SUSPENDED, no cookie)', suspendedRight.text);
  const unverifiedRight = await login('unverified@example.com', PASSWORD);
  record(unverifiedRight.status === 403 && code(unverifiedRight) === 'EMAIL_NOT_VERIFIED' && !sessionCookie(unverifiedRight), '"email not verified" is only revealed after the CORRECT password (403 EMAIL_NOT_VERIFIED, no cookie)', unverifiedRight.text);
  const bothRight = await login('both@example.com', PASSWORD);
  record(bothRight.status === 403 && code(bothRight) === 'ACCOUNT_SUSPENDED', 'a suspended AND unverified account is told "suspended" (the more serious) after the correct password');
  record((await Session.countDocuments({ accountId: { $in: [suspended._id, unverified._id, suspendedUnverified._id] } })) === 0, 'and none of those three got a session');
  await Promise.all([suspended, unverified, suspendedUnverified].map(a => clearLock(a._id)));

  // ================================================================ 3. cookie flags (this process)
  fresh();
  const c1 = await login('individual@example.com', PASSWORD);
  const parsed = sessionCookie(c1)!;
  const samesite = env.COOKIE_SAMESITE;
  const expectSecure = isProduction || samesite === 'none';
  record(parsed.name === env.SESSION_COOKIE_NAME && c1.cookies.length === 1, 'cookie: exactly one cookie, with the configured name');
  record(parsed.attrs.has('httponly'), 'cookie: HttpOnly (page scripts cannot read the session)');
  record((parsed.attrs.get('samesite') ?? '').toLowerCase() === samesite, `cookie: SameSite=${samesite}, as configured`, parsed.attrs.get('samesite'));
  record(parsed.attrs.has('secure') === expectSecure, `cookie: Secure is ${expectSecure ? 'set' : 'not set'} in this mode (production or SameSite=None only)`);
  record(parsed.attrs.get('path') === '/', 'cookie: Path=/');
  record(Number(parsed.attrs.get('max-age')) === SESSION_TTL_MS / 1000 && SESSION_TTL_MS === env.SESSION_TTL_DAYS * 86_400_000, `cookie: Max-Age equals the configured lifetime (${env.SESSION_TTL_DAYS} days)`, parsed.attrs.get('max-age'));
  record(!parsed.attrs.has('domain'), 'cookie: no Domain attribute (host-only, never sent to sibling subdomains)');
  const raw = parsed.value;
  record(/^[A-Za-z0-9_-]{40,}$/.test(raw), 'cookie: the token is long and URL-safe', `${raw.length} chars`);
  record(!raw.includes(String(individual._id)) && !raw.includes('individual'), 'cookie: the token does not contain the account id or email');
  const out = await call('POST', '/auth/logout', { cookie: cookieHeader(c1) });
  const cleared = out.cookies.map(cookieAttrs).find(c => c.name === SESSION_COOKIE_NAME);
  record(out.status === 200 && out.json.data.loggedOut === true, 'logout: 200 { loggedOut: true }');
  record(!!cleared && cleared.value === '' && (new Date(cleared.attrs.get('expires') ?? '').getTime() <= 0 || cleared.attrs.get('max-age') === '0'), 'logout: the cookie is cleared (empty value, already expired)', out.cookies.join(' | '));
  record(!!cleared && cleared.attrs.has('httponly') && (cleared.attrs.get('samesite') ?? '').toLowerCase() === samesite && cleared.attrs.has('secure') === expectSecure && cleared.attrs.get('path') === '/', 'logout: the clearing cookie has the same flags and path, so the browser really replaces it');

  // the same, in child processes with the settings that are fixed at start-up
  const root = path.join(__dirname, '../..');
  type Probe = { nodeEnv: string; configured: any; loginStatus: number; loginCookies: string[]; logoutStatus: number; logoutCookies: string[]; sessionLifetimeMs: number; rate?: any };
  // Asynchronous on purpose: a blocking spawn would freeze this process's own server for the
  // whole run, and its idle keep-alive connections would time out underneath the client.
  const probe = (vars: Record<string, string>): Promise<Probe> =>
    new Promise((resolve, reject) => {
      const child = spawn('npx', ['tsx', path.join(root, 'tests/helpers/authProbe.ts')], {
        cwd: root, env: { ...process.env, SMTP_HOST: '', PROBE_DB: MONGODB_URI, ...vars }
      });
      let output = '';
      child.stdout.on('data', chunk => (output += chunk));
      child.stderr.on('data', chunk => (output += chunk));
      child.on('close', () => {
        const line = output.split('\n').find(l => l.startsWith('RESULT '));
        if (line) resolve(JSON.parse(line.slice(7)));
        else reject(new Error(`probe produced no result: ${output.slice(0, 400)}`));
      });
    });
  const flags = (cookies: string[]) => {
    const c = cookies.map(cookieAttrs).find(x => x.name === SESSION_COOKIE_NAME);
    return { httpOnly: !!c?.attrs.has('httponly'), secure: !!c?.attrs.has('secure'), sameSite: c?.attrs.get('samesite'), maxAge: Number(c?.attrs.get('max-age')) };
  };

  const prod = await probe({ NODE_ENV: 'production', COOKIE_SAMESITE: 'lax', PROBE_RATE_LIMIT: '1' });
  const prodLogin = flags(prod.loginCookies);
  const prodLogout = flags(prod.logoutCookies);
  record(prod.nodeEnv === 'production' && prod.loginStatus === 200, 'production: the app signs in normally in production mode');
  record(prodLogin.httpOnly && prodLogin.secure && prodLogin.sameSite === 'Lax', 'production: the session cookie is HttpOnly + Secure + SameSite=Lax', JSON.stringify(prodLogin));
  record(prodLogout.httpOnly && prodLogout.secure && prodLogout.sameSite === 'Lax', 'production: the logout (clearing) cookie is Secure too', JSON.stringify(prodLogout));
  const none = await probe({ NODE_ENV: 'development', COOKIE_SAMESITE: 'none' });
  const noneLogin = flags(none.loginCookies);
  record(noneLogin.sameSite === 'None' && noneLogin.secure && noneLogin.httpOnly, 'SameSite=None: the cookie is forced to Secure (browsers reject it otherwise), still HttpOnly', JSON.stringify(noneLogin));
  record(flags(none.logoutCookies).secure, 'SameSite=None: the clearing cookie is Secure as well');
  const strictShort = await probe({ NODE_ENV: 'development', COOKIE_SAMESITE: 'strict', SESSION_TTL_DAYS: '1' });
  const strictLogin = flags(strictShort.loginCookies);
  record(strictLogin.sameSite === 'Strict' && !strictLogin.secure && strictLogin.httpOnly, 'SameSite=Strict (development): Strict + HttpOnly, no Secure over plain http', JSON.stringify(strictLogin));
  record(strictLogin.maxAge === 86_400 && strictShort.configured.ttlMs === 86_400_000, 'lifetime: SESSION_TTL_DAYS=1 makes the cookie last exactly one day', `${strictLogin.maxAge}`);
  record(Math.abs(strictShort.sessionLifetimeMs - 86_400_000) < 10_000, 'lifetime: ...and the stored session expires one day after it was made', `${strictShort.sessionLifetimeMs} ms`);

  // ============================================================ 4. session lifetime and revocation
  fresh();
  const accountId = individual._id;
  const s1 = await login('individual@example.com', PASSWORD);
  const s2 = await login('individual@example.com', PASSWORD);
  const sessionOf = async (r: Res) => (await Session.findOne({ tokenHash: hashSessionToken(sessionCookie(r)!.value) }).select('+tokenHash'))!;
  const doc1 = await sessionOf(s1);
  record(sessionCookie(s1)!.value !== sessionCookie(s2)!.value && String(doc1._id) !== String((await sessionOf(s2))._id), 'session: every login is its own session with its own token');
  record(Math.abs(doc1.expiresAt.getTime() - (Date.now() + SESSION_TTL_MS)) < 15_000, `session: it expires ${env.SESSION_TTL_DAYS} days after login (SESSION_TTL_DAYS)`, doc1.expiresAt.toISOString());
  const indexes = await Session.collection.indexes();
  record(indexes.some(i => i.key.expiresAt === 1 && i.expireAfterSeconds === 0), 'session: MongoDB deletes expired sessions by itself (TTL index on expiresAt)');
  record(doc1.tokenHash !== sessionCookie(s1)!.value && doc1.tokenHash.length === 64 && !JSON.stringify(await Session.find({}).select('+tokenHash').lean()).includes(sessionCookie(s1)!.value), 'session: only a hash of the token is stored, never the token itself');
  record(doc1.ipAddress === ip && doc1.accountId.equals(accountId), 'session: it records the account and the address it was opened from');

  const meOk = await call('GET', '/auth/me', { cookie: cookieHeader(s1) });
  record(meOk.status === 200 && meOk.json.data.email === 'individual@example.com', '/auth/me: returns the signed-in account');
  const beforeActive = (await sessionOf(s1)).lastActiveAt.getTime();
  await new Promise(resolve => setTimeout(resolve, 30));
  await call('GET', '/auth/me', { cookie: cookieHeader(s1) });
  record((await sessionOf(s1)).lastActiveAt.getTime() > beforeActive, '/auth/me: each use refreshes "last active"');

  // expiry
  await Session.updateOne({ _id: doc1._id }, { expiresAt: new Date(Date.now() + 5000) });
  record((await call('GET', '/auth/me', { cookie: cookieHeader(s1) })).status === 200, 'expiry: a session that has not yet expired still works');
  await Session.updateOne({ _id: doc1._id }, { expiresAt: new Date(Date.now() - 1000) });
  const expired = await call('GET', '/auth/me', { cookie: cookieHeader(s1) });
  record(expired.status === 401 && code(expired) === 'NOT_AUTHENTICATED', 'expiry: once its lifetime has passed the session is refused (401 NOT_AUTHENTICATED), even before MongoDB removes it', `${expired.status}`);
  record((await call('POST', '/auth/logout', { cookie: cookieHeader(s1) })).status === 401, 'expiry: an expired session cannot be used on other protected routes either');
  record((await call('GET', '/account/profile', { cookie: cookieHeader(s1) })).status === 401, 'expiry: ...nor reach the account area');

  // logout
  const lo = await call('POST', '/auth/logout', { cookie: cookieHeader(s2) });
  const doc2 = await sessionOf(s2);
  record(lo.status === 200 && !!doc2.revokedAt, 'logout: the session is revoked in the database, not just the cookie dropped');
  record((await call('GET', '/auth/me', { cookie: cookieHeader(s2) })).status === 401, 'logout: the old cookie no longer works (replay refused)');
  record((await call('POST', '/auth/logout', { cookie: cookieHeader(s2) })).status === 401, 'logout: logging out twice with the same cookie is refused cleanly (401)');
  const s3 = await login('individual@example.com', PASSWORD);
  const s4 = await login('individual@example.com', PASSWORD);
  await call('POST', '/auth/logout', { cookie: cookieHeader(s3) });
  record((await call('GET', '/auth/me', { cookie: cookieHeader(s4) })).status === 200, 'logout: it ends only THAT session; the account\'s other device stays signed in');

  // forged, malformed and stolen-hash cookies
  const bad: [string, string | undefined][] = [
    ['no cookie', undefined],
    ['an empty cookie', `${SESSION_COOKIE_NAME}=`],
    ['a random token', `${SESSION_COOKIE_NAME}=${crypto.randomBytes(32).toString('base64url')}`],
    ['a NoSQL operator in a JSON cookie', `${SESSION_COOKIE_NAME}=j:${JSON.stringify({ $ne: null })}`],
    ['a 10,000-character cookie', `${SESSION_COOKIE_NAME}=${'a'.repeat(10_000)}`],
    ['the cookie name with a different case', `${SESSION_COOKIE_NAME.toUpperCase()}=${sessionCookie(s4)!.value}`],
    ['the token with one character changed', `${SESSION_COOKIE_NAME}=${sessionCookie(s4)!.value.slice(0, -1)}${sessionCookie(s4)!.value.endsWith('A') ? 'B' : 'A'}`]
  ];
  for (const [label, cookie] of bad) {
    const r = await call('GET', '/auth/me', { cookie });
    record(r.status === 401 && code(r) === 'NOT_AUTHENTICATED', `forged: ${label} -> 401 NOT_AUTHENTICATED (no crash, no 500)`, `${r.status}`);
  }
  const stolenHash = (await sessionOf(s4)).tokenHash;
  record((await call('GET', '/auth/me', { cookie: `${SESSION_COOKIE_NAME}=${stolenHash}` })).status === 401, 'forged: the stored HASH is not a usable token (a database leak does not hand out sessions)');
  // session fixation: a cookie planted before login must not become the session
  const planted = 'attacker-chosen-value-0123456789-0123456789-abcdef';
  const fix = await login('individual@example.com', PASSWORD, { Cookie: `${SESSION_COOKIE_NAME}=${planted}` });
  record(sessionCookie(fix)!.value !== planted && (await call('GET', '/auth/me', { cookie: `${SESSION_COOKIE_NAME}=${planted}` })).status === 401, 'fixation: logging in with a planted cookie issues a NEW token; the planted one never becomes valid');

  // the account changes under a live session
  fresh();
  const live = await login('individual@example.com', PASSWORD);
  await Account.updateOne({ _id: accountId }, { status: 'suspended' });
  const susp = await call('GET', '/auth/me', { cookie: cookieHeader(live) });
  record(susp.status === 403 && code(susp) === 'ACCOUNT_SUSPENDED', 'live session: an account suspended meanwhile is refused on its next request (403 ACCOUNT_SUSPENDED)');
  await Account.updateOne({ _id: accountId }, { status: 'active' });
  const goneAccount = await mk('gone2@example.com');
  const goneLogin = await login('gone2@example.com', PASSWORD);
  await Account.collection.deleteOne({ _id: goneAccount._id });
  const gone = await call('GET', '/auth/me', { cookie: cookieHeader(goneLogin) });
  record(gone.status === 401 && code(gone) === 'NOT_AUTHENTICATED', 'live session: a session whose account was deleted is refused (401)');

  // suspending through the admin API signs the vendor out everywhere
  fresh();
  const adminCookie = `${SESSION_COOKIE_NAME}=${(await createSession(superAdmin._id, {})).rawToken}`;
  const victim = await mk('victim@example.com');
  const v1 = await login('victim@example.com', PASSWORD);
  const v2 = await login('victim@example.com', PASSWORD);
  const sus = await call('PATCH', `/admin/accounts/${victim._id}/suspend`, { cookie: adminCookie, body: {} });
  record(sus.status === 200, 'admin suspend: the admin API suspends the vendor', `${sus.status}`);
  const afterSuspend = [await call('GET', '/auth/me', { cookie: cookieHeader(v1) }), await call('GET', '/auth/me', { cookie: cookieHeader(v2) })];
  record(afterSuspend.every(r => r.status === 401), 'admin suspend: every live session of that vendor is dead at once (all devices)', afterSuspend.map(r => r.status).join());
  await call('PATCH', `/admin/accounts/${victim._id}/reactivate`, { cookie: adminCookie, body: {} });
  record((await call('GET', '/auth/me', { cookie: cookieHeader(v1) })).status === 401, 'admin suspend: reactivating does NOT bring the old sessions back (the vendor signs in again)');
  record((await login('victim@example.com', PASSWORD)).status === 200, 'admin suspend: after reactivation the vendor can sign in again');

  // password reset and change end sessions
  fresh();
  const pw = await mk('pw@example.com');
  const p1 = await login('pw@example.com', PASSWORD);
  const p2 = await login('pw@example.com', PASSWORD);
  const NEW1 = 'BrandNewPass456';
  const chg = await call('POST', '/account/change-password', { cookie: cookieHeader(p1), body: { currentPassword: PASSWORD, newPassword: NEW1, confirmNewPassword: NEW1 } });
  record(chg.status === 200, 'change password: succeeds with the right current password', `${chg.status} ${chg.text.slice(0, 100)}`);
  record((await call('GET', '/auth/me', { cookie: cookieHeader(p1) })).status === 200 && (await call('GET', '/auth/me', { cookie: cookieHeader(p2) })).status === 401, 'change password: the device that changed it stays signed in; every OTHER session is ended');
  record((await login('pw@example.com', PASSWORD)).status === 401 && (await login('pw@example.com', NEW1)).status === 200, 'change password: the old password stops working at once, the new one works');
  fresh();
  const NEW2 = 'ResetPass789x';
  const r1 = await login('pw@example.com', NEW1);
  const token = await issueToken(pw._id, 'password_reset');
  const reset = await call('POST', '/auth/reset-password', { body: { token, newPassword: NEW2, confirmNewPassword: NEW2 } });
  record(reset.status === 200, 'reset password: a valid token sets the new password', `${reset.status} ${reset.text.slice(0, 100)}`);
  record((await call('GET', '/auth/me', { cookie: cookieHeader(r1) })).status === 401, 'reset password: every existing session is ended (a stolen session does not survive a reset)');
  record((await call('POST', '/auth/reset-password', { body: { token, newPassword: NEW2, confirmNewPassword: NEW2 } })).status === 400, 'reset password: a token cannot be used twice');
  record((await login('pw@example.com', NEW2)).status === 200, 'reset password: the new password signs in');

  // ================================================================ 5. per-account lockout (HTTP)
  record(FREE_ATTEMPTS === 4, 'lockout: the number of free failures is 4 (the specification)', String(FREE_ATTEMPTS));
  fresh();
  const lock = await mk('lock@example.com');
  const lockMeta = async () => state(lock._id);
  const attempts: Res[] = [];
  for (let i = 1; i <= FREE_ATTEMPTS; i += 1) attempts.push(await login('lock@example.com', WRONG));
  record(attempts.every(r => r.status === 401 && code(r) === 'INVALID_CREDENTIALS'), `lockout: the first ${FREE_ATTEMPTS} wrong passwords are free (plain 401 each)`);
  record(!(await lockMeta()).lockedUntil, 'lockout: and the account is not locked yet');
  const fifth = await login('lock@example.com', WRONG);
  const lockedAt1 = (await lockMeta()).lockedUntil!;
  record(fifth.status === 401 && !!lockedAt1 && Math.abs(lockedAt1.getTime() - (Date.now() + MINUTE)) < 5000, 'lockout: the 5th failure is answered normally and locks the account for 1 minute', lockedAt1?.toISOString());
  const refused = await login('lock@example.com', PASSWORD);
  record(refused.status === 423 && code(refused) === 'ACCOUNT_LOCKED' && !sessionCookie(refused), 'lockout: even the CORRECT password is refused while locked (423 ACCOUNT_LOCKED, no cookie)', refused.text);
  const wait = refused.json?.error?.details?.retryAfterSeconds;
  record(typeof wait === 'number' && wait >= 1 && wait <= 60 && /1 minute/.test(refused.json.error.message), 'lockout: the answer says how long to wait', `${wait}s: ${refused.json?.error?.message}`);
  record((await lockMeta()).lockedUntil!.getTime() === lockedAt1.getTime(), 'lockout: attempts made while locked do not extend the lock');
  record((await login('individual@example.com', PASSWORD, { 'X-Forwarded-For': '198.51.100.77' })).status === 200, 'lockout: it is per account: another account on the same address is not affected');
  const spoof = await login('lock@example.com', PASSWORD, { 'X-Forwarded-For': '198.51.100.78' });
  record(spoof.status === 423, 'lockout: changing the apparent client address does not get around it (per account, not per address)');
  fresh();
  await expireLock(lock._id);
  const sixth = await login('lock@example.com', WRONG);
  const lockedAt2 = (await lockMeta()).lockedUntil!;
  record(sixth.status === 401 && Math.abs(lockedAt2.getTime() - (Date.now() + 2 * MINUTE)) < 5000, 'lockout: once the lock runs out, the next failure locks for 2 minutes', lockedAt2.toISOString());
  await expireLock(lock._id);
  await login('lock@example.com', WRONG);
  const lockedAt3 = (await lockMeta()).lockedUntil!;
  record(Math.abs(lockedAt3.getTime() - (Date.now() + 4 * MINUTE)) < 5000, 'lockout: ...and then 4 minutes (1 -> 2 -> 4)', lockedAt3.toISOString());
  await expireLock(lock._id);
  const unlocked = await login('lock@example.com', PASSWORD);
  const afterOk = await lockMeta();
  record(unlocked.status === 200 && !afterOk.lockedUntil && afterOk.failedLoginCount === 0, 'lockout: a successful sign-in after the lock clears the count and the lock');
  fresh();
  for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) await login('lock@example.com', WRONG);
  const relock = await login('lock@example.com', PASSWORD);
  record(relock.status === 423, 'lockout: the counting starts again from zero after a clean sign-in (locked again after 5 more failures)');
  const resetToken = await issueToken(lock._id, 'password_reset');
  const NEW3 = 'AfterReset321z';
  const resetLock = await call('POST', '/auth/reset-password', { body: { token: resetToken, newPassword: NEW3, confirmNewPassword: NEW3 } });
  const afterReset = await lockMeta();
  record(resetLock.status === 200 && !afterReset.lockedUntil && afterReset.failedLoginCount === 0, 'lockout: a password reset clears the lock', `${resetLock.status}`);
  fresh();
  record((await login('lock@example.com', NEW3)).status === 200, 'lockout: and the new password signs in straight away');
  fresh();
  const adminLock = [];
  for (let i = 0; i <= FREE_ATTEMPTS; i += 1) adminLock.push(await login('admin@example.com', WRONG));
  const adminRefused = await login('admin@example.com', PASSWORD);
  record(adminRefused.status === 423 && code(adminRefused) === 'ACCOUNT_LOCKED', 'lockout: admin accounts are locked by the same rule');
  await clearLock(admin._id);

  // ===================================================== 6. per-IP login limiter (10 per 15 minutes)
  fresh();
  const rate = await mk('rate@example.com');
  const sessionsBeforeRate = await Session.countDocuments({});
  const mixed: Res[] = [];
  for (const attemptBody of [
    ['nobody1@example.com', PASSWORD], ['nobody2@example.com', PASSWORD], ['nobody3@example.com', PASSWORD],
    ['rate@example.com', WRONG], ['rate@example.com', WRONG], ['rate@example.com', WRONG]
  ] as const) mixed.push(await login(attemptBody[0], attemptBody[1]));
  mixed.push(await call('POST', '/auth/login', { body: { email: 'bad' } }), await call('POST', '/auth/login', { body: {} }));
  mixed.push(await login('rate@example.com', PASSWORD), await login('rate@example.com', PASSWORD));
  record(mixed.length === 10 && mixed.every(r => r.status !== 429), 'rate limit: 10 sign-in requests from one address are all answered (wrong, unknown, malformed and successful ones all count)', mixed.map(r => r.status).join());
  const rl = mixed[0].headers;
  record(/limit=10/.test(rl.get('ratelimit') ?? '') && /10;\s*w=900/.test(rl.get('ratelimit-policy') ?? ''), 'rate limit: the limit and window (10 per 900 s = 15 min) are published in the standard headers', `${rl.get('ratelimit')} | ${rl.get('ratelimit-policy')}`);
  const remaining = (r: Res) => Number(/remaining=(\d+)/.exec(r.headers.get('ratelimit') ?? '')?.[1]);
  record(remaining(mixed[0]) === 9 && remaining(mixed[9]) === 0, 'rate limit: the remaining count runs from 9 down to 0', `${remaining(mixed[0])} -> ${remaining(mixed[9])}`);
  const countBefore = (await state(rate._id)).failedLoginCount ?? 0;
  const eleventh = await login('rate@example.com', PASSWORD);
  record(eleventh.status === 429 && code(eleventh) === 'RATE_LIMITED' && !sessionCookie(eleventh), 'rate limit: the 11th request is refused with 429 RATE_LIMITED, even with the correct password', eleventh.text);
  record((await Session.countDocuments({})) === sessionsBeforeRate + 2 && (((await state(rate._id)).failedLoginCount ?? 0) === countBefore), 'rate limit: the refused request never reached the login logic (no session made, no failure counted)');
  const retry = Number(eleventh.headers.get('retry-after'));
  record(retry >= 1 && retry <= 900, 'rate limit: the 429 carries Retry-After', `${retry}s`);
  record(!/rate@|password|account/i.test(eleventh.json.error.message), 'rate limit: the message is generic', eleventh.json.error.message);
  const spoofedAddr = await login('rate@example.com', PASSWORD, { 'X-Forwarded-For': '203.0.113.99' });
  record(spoofedAddr.status === 429, 'rate limit: a made-up X-Forwarded-For does not give a fresh allowance when no proxy is trusted (development)');
  const otherAccountBlocked = await login('individual@example.com', PASSWORD);
  record(otherAccountBlocked.status === 429, 'rate limit: it is per address, so a different account from the same address is limited too');
  const unthrottled = [await call('GET', '/auth/me'), { status: (await fetch(base.replace('/api/v1', '/health'))).status } as Res];
  record(unthrottled[0].status === 401 && unthrottled[1].status === 200 && !unthrottled.some(r => r.status === 429), 'rate limit: the rest of the API is not throttled by the sign-in limiter');
  fresh();
  record((await login('rate@example.com', PASSWORD)).status === 200, 'rate limit: when the window passes (simulated), sign-in works again');

  // behind a reverse proxy (production): the real client address is the last X-Forwarded-For entry
  const rateProbe = prod.rate;
  const answered = (statuses: number[]) => statuses.slice(0, 10).every(s => s === 401);
  record(answered(rateProbe.clientA) && rateProbe.clientA[10] === 429, 'production: behind the proxy the limit applies per real client (10 answered, the 11th is 429)', rateProbe.clientA.join());
  record(rateProbe.clientB === 401, 'production: a different client address has its own allowance');
  record(rateProbe.spoofedPrefixA.every((s: number) => s === 429), 'production: writing fake addresses at the front of X-Forwarded-For does NOT reset the limit', rateProbe.spoofedPrefixA.join());
  record(rateProbe.spoofedPrefixFresh === 401, 'production: ...and a fake prefix does not borrow someone else\'s limit either');
  record(rateProbe.noHeader === 401, 'production: a request with no X-Forwarded-For is counted on its own address');

  // ====================== 7. gaps found while testing: the password endpoints had no brute-force protection
  fresh();
  const forgot = (email: string) => call('POST', '/auth/forgot-password', { body: { email } });
  const forgotAnswers: number[] = [];
  for (let i = 0; i < 6; i += 1) forgotAnswers.push((await forgot(`nobody${i}@example.com`)).status);
  record(forgotAnswers.slice(0, 5).every(s => s === 200) && forgotAnswers[5] === 429, 'password reset: forgot-password is limited to 5 requests an hour per address (the 6th is 429), so it cannot be used to flood a mailbox', forgotAnswers.join());
  record((await call('POST', '/auth/reset-password', { body: { token: 'x', newPassword: NEW2, confirmNewPassword: NEW2 } })).status === 429, 'password reset: reset-password shares that limit (token guessing is throttled too)');
  fresh();
  const mailsBefore = smtp.messages.length;
  const realOwner = await mk('owner@example.com');
  for (let i = 0; i < 6; i += 1) await forgot('owner@example.com');
  record(smtp.messages.length - mailsBefore === 5 && !!realOwner, 'password reset: a registered mailbox gets at most 5 reset emails an hour from one address', `${smtp.messages.length - mailsBefore}`);
  fresh();

  const pwAttack = await mk('stolen@example.com');
  const stolen = await login('stolen@example.com', PASSWORD);
  const guess = (cur: string) => call('POST', '/account/change-password', { cookie: cookieHeader(stolen), body: { currentPassword: cur, newPassword: 'AttackerPass1!', confirmNewPassword: 'AttackerPass1!' } });
  const guesses: Res[] = [];
  for (let i = 0; i <= FREE_ATTEMPTS; i += 1) guesses.push(await guess(WRONG));
  record(guesses.every(r => r.status === 401 && code(r) === 'INVALID_CREDENTIALS'), 'change password: wrong current passwords are answered 401 (as before)');
  const guessRight = await guess(PASSWORD);
  record(guessRight.status === 423 && code(guessRight) === 'ACCOUNT_LOCKED', 'change password: after 5 wrong current passwords the endpoint is locked, even for the right one (a stolen session cannot brute-force the password)', `${guessRight.status} ${code(guessRight) ?? ''}`);
  record((await login('stolen@example.com', PASSWORD)).status === 423, 'change password: those failures count toward the same account lock as failed sign-ins');
  await expireLock(pwAttack._id);
  fresh();
  const rightNow = await call('POST', '/account/change-password', { cookie: cookieHeader(stolen), body: { currentPassword: PASSWORD, newPassword: 'Legit-Pass123', confirmNewPassword: 'Legit-Pass123' } });
  const clean = await state(pwAttack._id);
  record(rightNow.status === 200 && !clean.lockedUntil && clean.failedLoginCount === 0, 'change password: after the lock the right password works, and clears the count');

  server.close();
  await smtp.close();
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
