// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { Request } from 'express';
import mongoose from 'mongoose';
import { env } from '../../src/config/env';
import { SESSION_COOKIE_NAME, sessionCookieName } from '../../src/config/cookie';
import { stripDangerousKeys } from '../../src/middlewares/sanitize.middleware';
import { Account } from '../../src/models/account.model';
import { Follow } from '../../src/models/follow.model';
import { LoginFailure } from '../../src/models/loginFailure.model';
import { Session } from '../../src/models/session.model';
import { Work } from '../../src/models/work.model';
import { loginWithPassword } from '../../src/services/auth.service';
import { sendPasswordResetEmail } from '../../src/services/email.service';
import { resolveTorFilePath, saveTorFile, torStorageKeyFor } from '../../src/services/fileStorage.service';
import { clearFailedLogins, hashLoginEmail } from '../../src/services/loginLockout.service';
import { purgeUnverifiedAccounts, UNVERIFIED_ACCOUNT_RETENTION_DAYS } from '../../src/services/retention.service';
import { createSession } from '../../src/services/session.service';
import { logger } from '../../src/utils/logger';
import { maskEmail, tokenLink } from '../../src/utils/privacy';
import { startFakeSmtp } from '../helpers/fakeSmtp';

// The OWASP ASVS hardening of 2026-11-20 (groups 1-3 of the plan workbook) that
// no other check already covers:
//   V15.3.6  prototype-pollution keys dropped from request bodies
//   V1.3.10  request text never used as a log format string
//   V16.5.4  a last-resort handler for crashes outside any request
//   V6.3.8   an unknown email locks exactly like a real account, in the same time
//   V11.4.3  TOR files keyed by the full SHA-256, and the migration of old keys
//   V3.3.1/3 the __Host- cookie name in production
//   V14.3.1  Clear-Site-Data on logout
//   V14.3.2  Cache-Control: no-store on everything but public reads
//   V14.2.1  emailed tokens only after the # of the link
//   V14.2.4/V16.2.5  email addresses masked in logs
//   V14.2.7  never-verified accounts removed after the retention period
// Run: npm run check:security-hardening

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-security-hardening-check';
if (!/check/i.test(new URL(MONGODB_URI).pathname)) {
  console.error('Refusing to run: this check drops its database, whose name must contain "check".');
  process.exit(2);
}
// Backend/.env may hold REAL SMTP credentials: only the fake server below is ever used.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const backendRoot = path.resolve(__dirname, '../..');
const PASSWORD = 'SecurePass123';
const WRONG = 'WrongPass999';

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const fakeRequest = (): Request => ({ ip: '203.0.113.50', get: () => undefined }) as unknown as Request;
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
}
async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn().catch(() => undefined);
  return Number(process.hrtime.bigint() - start) / 1e6;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function runTsx(file: string, extraEnv: Record<string, string>, args: string[] = []): Promise<{ code: number | null; output: string }> {
  return new Promise(resolve => {
    // node + tsx's CLI rather than `npx tsx`: Windows cannot spawn npx (a .cmd) without a shell.
    const child = spawn(process.execPath, [require.resolve('tsx/cli'), file, ...args], { cwd: backendRoot, env: { ...process.env, ...extraEnv } });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    child.on('close', code => resolve({ code, output }));
  });
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`;
  const call = async (method: string, p: string, opts: { cookie?: string; body?: string } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: method === 'GET' ? undefined : (opts.body ?? '{}')
    });
    return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
  };

  const vendor = await Account.create({ email: 'vendor@example.com', passwordHash: PASSWORD, name: 'Vendor One', type: 'individual' });
  const { rawToken } = await createSession(vendor._id);
  const cookie = `${SESSION_COOKIE_NAME}=${rawToken}`;

  // ================================================== V15.3.6 prototype pollution
  const parsed = JSON.parse('{"name":"x","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"__proto__":{"polluted":true},"ok":1},"list":[{"prototype":1,"keep":2}]}');
  const clean = stripDangerousKeys(parsed) as Record<string, any>;
  record(Object.getPrototypeOf(clean) === Object.prototype && Object.getPrototypeOf(clean.nested) === Object.prototype, 'V15.3.6: a "__proto__" key in a JSON body does not become the object\'s prototype', JSON.stringify(clean));
  record(!Object.prototype.hasOwnProperty.call(clean, 'constructor') && !('polluted' in clean) && !('polluted' in clean.nested) && clean.nested.ok === 1, 'V15.3.6: "__proto__", "constructor" and "prototype" keys are dropped at every depth; other keys stay');
  record(JSON.stringify(clean.list) === '[{"keep":2}]' && ({} as Record<string, unknown>).polluted === undefined, 'V15.3.6: inside arrays too, and Object.prototype itself is untouched');
  const viaHttp = await call('PATCH', '/account/profile', { cookie, body: '{"name":"Renamed Vendor","__proto__":{"role":"superadmin"},"constructor":{"prototype":{"role":"superadmin"}}}' });
  const after = await Account.findById(vendor._id);
  record(viaHttp.status === 200 && after?.name === 'Renamed Vendor' && after?.role === 'user', 'V15.3.6: over HTTP, the profile update applies the name and nothing smuggled in through __proto__ / constructor', `${viaHttp.status} role=${after?.role}`);

  // ================================================== V1.3.10 format strings in logs
  const captured: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => captured.push(util.format(...args));
  logger.info('check', 'GET /works?q=%s%d%o%j %c');
  console.log = realLog;
  record(captured.length === 1 && captured[0].includes('GET /works?q=%s%d%o%j %c'), 'V1.3.10: %s / %d / %o / %j / %c in logged request text are printed as written, never expanded', captured[0]);

  // ================================================== V16.5.4 last-resort handler
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'b2g-hardening-'));
  const handlers = path.join(backendRoot, 'src/utils/processHandlers.ts').replace(/\\/g, '/');
  const rejectFile = path.join(scratch, 'reject.ts');
  await fs.writeFile(rejectFile, `import { installProcessHandlers } from '${handlers}';\ninstallProcessHandlers('probe');\nsetInterval(() => undefined, 1000);\nvoid Promise.reject(new Error('lost promise'));\n`);
  const throwFile = path.join(scratch, 'throw.ts');
  await fs.writeFile(throwFile, `import { installProcessHandlers } from '${handlers}';\ninstallProcessHandlers('probe');\nsetInterval(() => undefined, 1000);\nsetTimeout(() => { throw new Error('thrown in a timer'); }, 10);\n`);
  const rejected = await runTsx(rejectFile, {});
  const thrown = await runTsx(throwFile, {});
  record(rejected.code === 1 && /"scope":"process","msg":"probe: unhandled promise rejection -- exiting"/.test(rejected.output) && rejected.output.includes('lost promise'), 'V16.5.4: an unhandled promise rejection is logged with its error and the process exits with code 1', `code ${rejected.code}`);
  record(thrown.code === 1 && /"scope":"process","msg":"probe: uncaught exception -- exiting"/.test(thrown.output) && thrown.output.includes('thrown in a timer'), 'V16.5.4: an exception thrown outside any request is logged and the process exits with code 1 (Docker restarts it)', `code ${thrown.code}`);
  const serverSrc = await fs.readFile(path.join(backendRoot, 'src/server.ts'), 'utf8');
  const workerSrc = await fs.readFile(path.join(backendRoot, 'src/worker.ts'), 'utf8');
  record(serverSrc.includes("installProcessHandlers('api')") && workerSrc.includes("installProcessHandlers('ingestion-worker')"), 'V16.5.4: both the API and the ingestion worker install it');

  // ================================================== V6.3.8 lockout must not reveal accounts
  const lockable = await Account.create({ email: 'lockable@example.com', passwordHash: PASSWORD, name: 'Lock Able', type: 'individual' });
  const sequence = async (email: string) => {
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) seen.push(await outcome(() => loginWithPassword({ email, password: WRONG }, fakeRequest())));
    return seen;
  };
  const known = await sequence('lockable@example.com');
  const unknown = await sequence('nobody-at-all@example.com');
  record(
    JSON.stringify(known) === JSON.stringify([...Array(5).fill('INVALID_CREDENTIALS'), 'ACCOUNT_LOCKED']) && JSON.stringify(unknown) === JSON.stringify(known),
    'V6.3.8: an email with NO account is locked after the same failures as a real one -- 423 no longer proves an account exists',
    `known ${known.join(',')} | unknown ${unknown.join(',')}`
  );
  const failureRow = await LoginFailure.findOne({ emailHash: hashLoginEmail('nobody-at-all@example.com') }).lean();
  record(!!failureRow && !JSON.stringify(await LoginFailure.find({}).lean()).includes('nobody-at-all'), 'V6.3.8: the unknown address is counted under a hash; the address itself is not stored');
  const ttl = (await LoginFailure.collection.indexes()).find(i => i.key.lastFailedLoginAt === 1);
  record(ttl?.expireAfterSeconds === 25 * 3600, 'V6.3.8: those rows delete themselves after 25 hours (TTL index)', String(ttl?.expireAfterSeconds));

  // Same time: a locked answer pays for a bcrypt compare like every other answer.
  const sample = { locked: [] as number[], wrong: [] as number[], unknownLocked: [] as number[] };
  const other = await Account.create({ email: 'other@example.com', passwordHash: PASSWORD, name: 'Other One', type: 'individual' });
  for (let i = 0; i < 5; i++) {
    sample.locked.push(await timed(() => loginWithPassword({ email: 'lockable@example.com', password: WRONG }, fakeRequest())));
    sample.unknownLocked.push(await timed(() => loginWithPassword({ email: 'nobody-at-all@example.com', password: WRONG }, fakeRequest())));
    await clearFailedLogins(other._id);
    sample.wrong.push(await timed(() => loginWithPassword({ email: 'other@example.com', password: WRONG }, fakeRequest())));
  }
  const m = { locked: median(sample.locked), wrong: median(sample.wrong), unknownLocked: median(sample.unknownLocked) };
  const timingDetail = `median ms: locked ${m.locked.toFixed(0)}, locked unknown ${m.unknownLocked.toFixed(0)}, wrong password ${m.wrong.toFixed(0)}`;
  record(m.locked > 30 && m.locked / m.wrong > 0.5 && m.locked / m.wrong < 2, 'V6.3.8: a locked account answers in bcrypt time, like a wrong password (it used to answer in a few ms)', timingDetail);
  record(m.unknownLocked / m.wrong > 0.5 && m.unknownLocked / m.wrong < 2, 'V6.3.8: so does a "locked" unknown email', timingDetail);
  await clearFailedLogins(lockable._id);

  // ================================================== V11.4.3 full SHA-256 file keys
  const pdf = Buffer.from('%PDF-1.4\n% hardening check\n');
  const saved = await saveTorFile(pdf, 'tor.pdf');
  record(/^[0-9a-f]{64}\.pdf$/.test(saved.storageKey) && saved.storageKey === torStorageKeyFor(pdf), 'V11.4.3: a stored TOR file is keyed by its full 256-bit SHA-256', saved.storageKey);

  const legacyPdf = Buffer.from('%PDF-1.4\n% stored before the change\n');
  const fullKey = torStorageKeyFor(legacyPdf);
  const oldKey = `${fullKey.slice(0, 24)}.pdf`;
  await fs.writeFile(resolveTorFilePath(oldKey), legacyPdf);
  const siteId = new mongoose.Types.ObjectId();
  const torFile = { sourceUrl: 'https://example.com/a.pdf', linkType: 'pdf', announceType: 'D0', storageKey: oldKey, filename: 'a.pdf' };
  await Work.collection.insertMany([
    { siteId, projectId: 'P-1', title: 'one', status: 'BIDDING', announceType: 'D0', torFiles: [torFile] },
    { siteId, projectId: 'P-2', title: 'two', status: 'BIDDING', announceType: 'D0', torFiles: [torFile, { ...torFile, storageKey: saved.storageKey }] }
  ]);
  const script = 'src/scripts/backfillTorFileKeys.ts';
  const scriptEnv = { MONGODB_URI, TOR_STORAGE_DIR: env.TOR_STORAGE_DIR };
  const dry = await runTsx(script, scriptEnv, ['--dry-run']);
  const stillOld = await Work.countDocuments({ 'torFiles.storageKey': oldKey });
  record(dry.code === 0 && stillOld === 2 && /1 file\(s\) would be renamed/.test(dry.output), 'V11.4.3 migration: --dry-run reports the old key and changes nothing', dry.output.trim().split('\n').pop());
  const run = await runTsx(script, scriptEnv);
  const exists = async (key: string) => fs.access(resolveTorFilePath(key)).then(() => true, () => false);
  record(
    run.code === 0 && (await Work.countDocuments({ 'torFiles.storageKey': oldKey })) === 0 && (await Work.countDocuments({ 'torFiles.storageKey': fullKey })) === 2,
    'V11.4.3 migration: every work pointing at the 96-bit key now points at the full key',
    run.output.trim().split('\n').pop()
  );
  record((await exists(fullKey)) && !(await exists(oldKey)) && (await Work.countDocuments({ 'torFiles.storageKey': saved.storageKey })) === 1, 'V11.4.3 migration: the file is renamed on disk, and files already on a full key are left alone');

  // ================================================== V3.3.1 / V3.3.3 cookie name
  record(sessionCookieName('b2g_session', true) === '__Host-b2g_session' && sessionCookieName('b2g_session', false) === 'b2g_session', 'V3.3.1: production uses __Host-b2g_session; development (plain http) keeps b2g_session');
  record(sessionCookieName('__Host-custom', true) === '__Host-custom' && sessionCookieName('__Secure-custom', true) === '__Host-custom', 'V3.3.3: an already-prefixed name is kept, and __Secure- is upgraded to __Host-');

  // ================================================== V14.3.2 / V14.3.1 caching and logout
  const noStore = (r: { headers: Headers }) => r.headers.get('cache-control') === 'no-store';
  const me = await call('GET', '/auth/me', { cookie });
  const profile = await call('GET', '/account/profile', { cookie });
  const anonymous = await call('GET', '/auth/me');
  const loginRes = await call('POST', '/auth/login', { body: JSON.stringify({ email: 'other@example.com', password: PASSWORD }) });
  record(noStore(me) && noStore(profile) && noStore(anonymous) && noStore(loginRes), 'V14.3.2: signed-in answers, sign-in and even a 401 carry Cache-Control: no-store', [me, profile, anonymous, loginRes].map(r => `${r.status}:${r.headers.get('cache-control')}`).join(' '));
  const works = await call('GET', '/works');
  const tags = await call('GET', '/tags');
  record(!noStore(works) && !noStore(tags), 'V14.3.2: the public reads (works, tags, sites) are left cacheable', `${works.headers.get('cache-control')} / ${tags.headers.get('cache-control')}`);
  const logout = await call('POST', '/auth/logout', { cookie });
  record(logout.status === 200 && logout.headers.get('clear-site-data') === '"cache", "storage"', 'V14.3.1: logout sends Clear-Site-Data: "cache", "storage"', String(logout.headers.get('clear-site-data')));
  record((await Session.countDocuments({ accountId: vendor._id, revokedAt: { $exists: false } })) === 0, 'V14.3.1: and the session itself is revoked on the server');

  // ================================================== V14.2.1 tokens after the #
  const smtp = await startFakeSmtp();
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(util.format(...args));
  await sendPasswordResetEmail('somchai.jaidee@example.com', 'Somchai', 'ab'.repeat(32));
  console.log = realLog;
  const decoded = (smtp.messages[0] ?? '').replace(/=\r?\n/g, '').replace(/=([a-f\d]{2})/gi, (_x, byte: string) => String.fromCharCode(Number.parseInt(byte, 16)));
  record(decoded.includes(`${env.APP_URL}/reset-password#token=${'ab'.repeat(32)}`) && !decoded.includes(`/reset-password/${'ab'.repeat(32)}`), 'V14.2.1: the emailed reset link carries its token after the #, never in the path a server would log');
  record(tokenLink('https://app.example', 'unsubscribe', 'a b') === 'https://app.example/unsubscribe#token=a%20b', 'V14.2.1: tokenLink() builds the same fragment form for verification and unsubscribe links');
  const emailLog = logs.join('\n');
  record(emailLog.includes(maskEmail('somchai.jaidee@example.com')) && !emailLog.includes('somchai.jaidee@example.com'), 'V14.2.4 / V16.2.5: the "email sent" log line shows the address masked', emailLog);
  record(maskEmail('somchai.jaidee@example.com') === 's*************@example.com' && maskEmail('a@b.co') === 'a***@b.co' && maskEmail(undefined) === '(none)', 'V16.2.5: maskEmail keeps the first letter and the domain only');
  await smtp.close();

  // ================================================== V14.2.7 retention
  const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const stale = await Account.create({ email: 'stale@example.com', passwordHash: PASSWORD, name: 'Never Verified', type: 'individual', emailVerified: false });
  const recent = await Account.create({ email: 'recent@example.com', passwordHash: PASSWORD, name: 'Just Signed Up', type: 'individual', emailVerified: false });
  const oldVerified = await Account.create({ email: 'old@example.com', passwordHash: PASSWORD, name: 'Old Verified', type: 'individual' });
  await Account.collection.updateOne({ _id: stale._id }, { $set: { createdAt: days(UNVERIFIED_ACCOUNT_RETENTION_DAYS + 1) } });
  await Account.collection.updateOne({ _id: oldVerified._id }, { $set: { createdAt: days(400) } });
  await Follow.collection.insertOne({ accountId: stale._id, tagId: new mongoose.Types.ObjectId(), createdAt: new Date() });
  await createSession(stale._id);
  const removed = await purgeUnverifiedAccounts();
  record(removed === 1 && !(await Account.exists({ _id: stale._id })), `V14.2.7: an account never verified within ${UNVERIFIED_ACCOUNT_RETENTION_DAYS} days is removed`, `${removed} removed`);
  record((await Follow.countDocuments({ accountId: stale._id })) === 0 && (await Session.countDocuments({ accountId: stale._id })) === 0, 'V14.2.7: with its follows and sessions');
  record(!!(await Account.exists({ _id: recent._id })) && !!(await Account.exists({ _id: oldVerified._id })), 'V14.2.7: a recent unverified sign-up and an old verified account are kept');

  server.close();
  await fs.rm(scratch, { recursive: true, force: true });
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
