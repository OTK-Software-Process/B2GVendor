// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import mongoose from 'mongoose';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clock } from '../../src/config/clock';
import { env } from '../../src/config/env';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { mfaKey } from '../../src/config/mfa';
import { Account } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { MfaCredential } from '../../src/models/mfaCredential.model';
import { Session } from '../../src/models/session.model';
import { loginLimiter, mfaManageLimiter, mfaVerifyLimiter } from '../../src/middlewares/rateLimit.middleware';
import { decrypt } from '../../src/utils/secretBox';
import { totpAt } from '../../src/utils/totp';
import { PASSWORD_HASH_PREFIX } from '../../src/utils/passwordHasher';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';
import { startFakeSmtp } from '../helpers/fakeSmtp';

// Two-step verification (ASVS V6.3.3, V6.4.4, V6.5.1-V6.5.6, V6.5.8;
// docs/Security.md section 15): enrolment, the challenge at sign-in, a code that
// works once, the server's clock, recovery codes, the staff requirement, an
// administrator's reset, and what is (not) stored and logged.
// Run: npm run check:mfa

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-mfa-check';
const PASSWORD = 'SecurePass123';

mockPwnedPasswords();
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined; // Backend/.env may hold real SMTP credentials: only the fake server below is ever used

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ------------------------------------------------------------------ the server's clock
// Codes depend on the SERVER's time, which two-step verification reads from config/clock.ts.
// A check moves that clock instead of waiting (a code lives 30 seconds), and nothing else
// in the process is touched.
const realNow = (): number => Date.now();
let skewMs = 0;
let frozenAt: number | null = null;
clock.now = () => frozenAt ?? realNow() + skewMs;
const advance = (ms: number): void => {
  skewMs += ms;
};
// Holds the server's clock still, for assertions that sit exactly on a step edge: with the
// real clock running, a 30-second boundary could pass while a request is in flight and turn
// "one step back" into "two" (a flaky check, not a flaky product).
const freeze = (): void => {
  frozenAt = realNow() + skewMs;
};
const thaw = (): void => {
  if (frozenAt !== null) skewMs = frozenAt - realNow();
  frozenAt = null;
};

// ------------------------------------------------------------------ what was written to the logs
// Everything printed while a flow runs, to prove no secret, code or token reached a log line.
let captured = '';
const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);
function startCapture(): void {
  captured = '';
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return (stdoutWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return (stderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
}
function stopCapture(): string {
  process.stdout.write = stdoutWrite;
  process.stderr.write = stderrWrite;
  return captured;
}

// ------------------------------------------------------------------ mail
function readable(message: string): string {
  // headers' encoded words, then base64 / quoted-printable bodies
  let text = message.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
  text = text.replace(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi, (_, body: string) => Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'));
  text = text.replace(/Content-Transfer-Encoding: quoted-printable\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/gi, (_, body: string) => body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))));
  return text;
}

interface Reply {
  status: number;
  json: any;
  cookie?: string;
  setCookie: string[];
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await MfaCredential.init();

  const smtp = await startFakeSmtp();
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const clearLimits = (): void => {
    for (const key of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      (loginLimiter as unknown as { resetKey(k: string): void }).resetKey(key);
      (mfaVerifyLimiter as unknown as { resetKey(k: string): void }).resetKey(key);
    }
  };

  async function call(method: string, p: string, options: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
    clearLimits();
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.headers ?? {}) },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {})
    });
    const setCookie = res.headers.getSetCookie();
    const cookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith(`${SESSION_COOKIE_NAME}=`) && c.length > SESSION_COOKIE_NAME.length + 1);
    return { status: res.status, json: await res.json().catch(() => null), cookie, setCookie };
  }

  const login = (email: string, password = PASSWORD) => call('POST', '/auth/login', { body: { email, password } });

  async function makeAccount(email: string, role: 'user' | 'admin' | 'superadmin' = 'user', permissions: string[] = []) {
    return Account.create({ email, passwordHash: PASSWORD, name: `Test ${role}`, type: 'individual', role, permissions, status: 'active', emailVerified: true });
  }

  // A fresh authenticator code: always of a step newer than any used so far.
  const nextCode = (secret: string): string => {
    advance(30_000);
    return totpAt(secret, clock.now());
  };
  // A six-digit string that is certainly not valid now (none of the codes the window accepts).
  const wrongCode = (secret: string): string => {
    const valid = new Set([-1, 0, 1].map(o => totpAt(secret, clock.now() + o * 30_000)));
    for (let n = 0; n < 1000; n += 1) {
      const candidate = String(100000 + n * 7).slice(0, 6);
      if (!valid.has(candidate)) return candidate;
    }
    throw new Error('no wrong code');
  };

  interface Enrolled {
    secret: string;
    recoveryCodes: string[];
    cookie: string;
  }
  async function enroll(email: string): Promise<Enrolled> {
    const signedIn = await login(email);
    const cookie = signedIn.cookie as string;
    const setup = await call('POST', '/account/mfa/setup', { cookie, body: { password: PASSWORD } });
    const secret = setup.json.data.secret as string;
    const enable = await call('POST', '/account/mfa/enable', { cookie, body: { code: nextCode(secret) } });
    return { secret, recoveryCodes: enable.json.data.recoveryCodes as string[], cookie };
  }

  /** Password, then the second factor: the full two-step sign-in. */
  async function signInWithCode(email: string, code: string): Promise<{ challenge: Reply; verify: Reply }> {
    const challenge = await login(email);
    const verify = await call('POST', '/auth/mfa/verify', { cookie: challenge.cookie, body: { code } });
    return { challenge, verify };
  }

  const errorCode = (reply: Reply): string | undefined => reply.json?.error?.code;

  // =============================================================== 1. before anything is set up
  const vendor = await makeAccount('vendor@example.com');
  const plain = await login('vendor@example.com');
  record(plain.status === 200 && plain.json.data.email === 'vendor@example.com' && plain.json.data.mfaRequired === undefined, 'with no second factor, a correct password signs in as before (nothing changes for accounts that have not set one up)');
  record(plain.json.data.mfaEnabled === false && plain.json.data.mfaSetupRequired === false, 'the account says two-step verification is off, and that a vendor is not required to use it');
  const status0 = await call('GET', '/account/mfa', { cookie: plain.cookie });
  record(status0.status === 200 && status0.json.data.enabled === false && status0.json.data.available === true && status0.json.data.required === false && status0.json.data.recoveryCodesRemaining === 0, 'GET /account/mfa: off, available on this server, not required for a vendor');
  record((await call('GET', '/account/mfa')).status === 401, 'the status needs a session');

  // =============================================================== 2. setting up
  const noPassword = await call('POST', '/account/mfa/setup', { cookie: plain.cookie, body: {} });
  record(noPassword.status === 400 && errorCode(noPassword) === 'VALIDATION_ERROR', 'setup needs the password: without it the request is refused (400)');
  const wrongPassword = await call('POST', '/account/mfa/setup', { cookie: plain.cookie, body: { password: 'Not-the-password-1' } });
  record(wrongPassword.status === 401 && errorCode(wrongPassword) === 'INVALID_CREDENTIALS', 'a wrong password is refused (401): a stolen session cannot start setting up a second factor');
  record((await call('POST', '/account/mfa/setup', { cookie: plain.cookie, body: { password: PASSWORD, time: 12345 } })).status === 400, 'no extra field is accepted (the request carries no time or anything else)');

  const setup = await call('POST', '/account/mfa/setup', { cookie: plain.cookie, body: { password: PASSWORD } });
  const secret = setup.json?.data?.secret as string;
  record(setup.status === 200 && /^[A-Z2-7]{32}$/.test(secret), 'setup with the password hands out a 160-bit secret (32 Base32 characters)', String(setup.status));
  const uri = new URL(setup.json.data.otpauthUri);
  record(uri.protocol === 'otpauth:' && uri.searchParams.get('secret') === secret && uri.searchParams.get('issuer') === env.MFA_ISSUER && decodeURIComponent(uri.pathname).includes('vendor@example.com'), 'with an otpauth:// address for the authenticator app (issuer, account, secret)');
  record(setup.json.data.expiresInSeconds === 600, 'a secret that is not proven within 10 minutes expires');

  let credential = await MfaCredential.findOne({ accountId: vendor._id }).select('+secretEnc +pendingSecretEnc');
  record(!!credential?.pendingSecretEnc && !credential.secretEnc && !credential.enabledAt && !credential.pendingSecretEnc.includes(secret), 'the secret is kept PENDING and encrypted: it is not active, and not in the database in the clear');
  record(!(await Account.findById(vendor._id))!.mfaEnabled && (await login('vendor@example.com')).json.data.mfaRequired === undefined, 'until it is proven, nothing is turned on and signing in does not change');

  const badEnable = await call('POST', '/account/mfa/enable', { cookie: plain.cookie, body: { code: wrongCode(secret) } });
  record(badEnable.status === 401 && errorCode(badEnable) === 'INVALID_MFA_CODE', 'a wrong code does not turn it on (401)');
  record((await call('POST', '/account/mfa/enable', { cookie: plain.cookie, body: { code: '12345' } })).status === 401, 'nor does a code that is not six digits');
  record(!(await Account.findById(vendor._id))!.mfaEnabled, 'and it is still off');

  // a code from the future (the client's clock being ahead) is not accepted: only the server's time counts
  const future = totpAt(secret, clock.now() + 5 * 60_000);
  const futureAttempt = await call('POST', '/account/mfa/enable', { cookie: plain.cookie, body: { code: future }, headers: { Date: new Date(clock.now() + 5 * 60_000).toUTCString(), 'X-Client-Time': String(clock.now() + 5 * 60_000) } });
  record(futureAttempt.status === 401, 'a code made for 5 minutes ahead is refused even with a Date header and a client time claiming that moment: the server\'s clock decides (V6.5.8)');

  // keep the sessions of this account, to see that enabling ends the OTHER ones
  const otherDevice = await login('vendor@example.com');
  const goodCode = nextCode(secret);
  startCapture();
  const enable = await call('POST', '/account/mfa/enable', { cookie: plain.cookie, body: { code: goodCode } });
  const enableLog = stopCapture();
  record(enable.status === 200 && Array.isArray(enable.json.data.recoveryCodes) && enable.json.data.recoveryCodes.length === 10, 'the right code turns it on and returns ten recovery codes, once');
  const recoveryCodes = enable.json.data.recoveryCodes as string[];
  record(recoveryCodes.every(code => /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/.test(code)) && new Set(recoveryCodes).size === 10, 'ten different codes of five groups of four characters');
  record(enable.json.data.otherSessionsRevoked >= 1 && (await call('GET', '/auth/me', { cookie: otherDevice.cookie })).status === 401, 'every OTHER session of the account is ended when it is turned on (a session stolen earlier does not survive)');
  record((await call('GET', '/auth/me', { cookie: plain.cookie })).status === 200, 'the session that set it up stays signed in');
  record((await call('POST', '/account/mfa/enable', { cookie: plain.cookie, body: { code: nextCode(secret) } })).status === 409, 'turning it on again is refused (409)');
  record((await call('POST', '/account/mfa/setup', { cookie: plain.cookie, body: { password: PASSWORD } })).status === 409, 'and so is setting up a second authenticator while one is on');
  const status1 = await call('GET', '/account/mfa', { cookie: plain.cookie });
  record(status1.json.data.enabled === true && status1.json.data.recoveryCodesRemaining === 10 && typeof status1.json.data.enabledAt === 'string', 'the status now says it is on, with 10 recovery codes left');
  const mails = smtp.messages.map(readable);
  record(mails.some(m => /^To: .*vendor@example\.com/im.test(m) && /turned on two-step verification/i.test(m)), 'the owner is emailed that it was turned on');

  // =============================================================== 3. what is stored
  credential = await MfaCredential.findOne({ accountId: vendor._id }).select('+secretEnc +recoveryCodes');
  record(!!credential?.secretEnc?.startsWith('v1.') && !credential.secretEnc.includes(secret), 'the secret is stored encrypted (AES-256-GCM, versioned), not as given');
  const key = mfaKey() as Buffer;
  record(decrypt(credential!.secretEnc!, key, String(vendor._id)) === secret, 'and decrypts, with the key and this account, back to the secret');
  let decryptsForOther = false;
  try {
    decrypt(credential!.secretEnc!, key, String(new mongoose.Types.ObjectId()));
    decryptsForOther = true;
  } catch {
    decryptsForOther = false;
  }
  record(!decryptsForOther, 'it cannot be decrypted as if it belonged to another account (copying it onto one does not share a factor)');
  const displayedSecrets = recoveryCodes.map(code => code.replace(/-/g, '').slice(4));
  record(credential!.recoveryCodes.length === 10 && credential!.recoveryCodes.every(entry => entry.hash.startsWith(PASSWORD_HASH_PREFIX) && !entry.usedAt), 'recovery codes are stored as bcrypt hashes (V6.5.2), none used yet');
  const stored = JSON.stringify(credential!.toObject());
  record(!stored.includes(secret) && displayedSecrets.every(s => !stored.includes(s)), 'and neither the secret nor any recovery code appears anywhere in the stored record');
  const rawAccount = JSON.stringify(await mongoose.connection.collection('accounts').findOne({ _id: vendor._id }));
  record(!rawAccount.includes(secret) && displayedSecrets.every(s => !rawAccount.includes(s)) && !/secretEnc|recoveryCodes/.test(rawAccount), 'the accounts collection holds only the on/off flag: no secret, no codes');
  const meJson = JSON.stringify((await call('GET', '/auth/me', { cookie: plain.cookie })).json) + JSON.stringify((await call('GET', '/account/profile', { cookie: plain.cookie })).json) + JSON.stringify(status1.json);
  record(!meJson.includes(secret) && displayedSecrets.every(s => !meJson.includes(s)) && !/secretEnc|"recoveryCodes"|pendingSecret|lastUsedStep/.test(meJson), 'no API response about the account carries a secret, a code, or an internal field');
  record(![secret, ...displayedSecrets, goodCode].some(s => enableLog.includes(s)), 'nothing secret reached a log line while setting up: no secret, no recovery code, no authenticator code');
  const auditText = JSON.stringify(await AuditLog.find({ entityId: String(vendor._id) }).lean());
  record(!auditText.includes(secret) && displayedSecrets.every(s => !auditText.includes(s)) && /account\.mfa_enabled/.test(auditText), 'the audit log records that it was turned on, and holds no secret');

  // =============================================================== 4. signing in with it
  const challenge = await login('vendor@example.com');
  record(challenge.status === 200 && challenge.json.data.mfaRequired === true && challenge.json.data.email === undefined && challenge.json.data.role === undefined, 'with it on, a correct password is not a sign-in: the answer is "second factor required" and carries no account data');
  record(!!challenge.cookie && challenge.setCookie.some(c => /HttpOnly/i.test(c) && /Max-Age=300/i.test(c)), 'it issues a cookie for a challenge that lasts 5 minutes (HttpOnly)');
  const challengeCookie = challenge.cookie as string;
  const pendingSession = await Session.findOne({ accountId: vendor._id, mfaPending: true });
  record(!!pendingSession && pendingSession.expiresAt.getTime() - Date.now() <= 5 * 60_000 + 1000 && pendingSession.expiresAt.getTime() - Date.now() > 4 * 60_000, 'server side the challenge is a session flagged as pending, expiring in 5 minutes');
  for (const [name, reply] of [
    ['GET /auth/me', await call('GET', '/auth/me', { cookie: challengeCookie })],
    ['GET /account/profile', await call('GET', '/account/profile', { cookie: challengeCookie })],
    ['GET /account/mfa', await call('GET', '/account/mfa', { cookie: challengeCookie })],
    ['GET /notifications', await call('GET', '/notifications', { cookie: challengeCookie })],
    ['POST /auth/logout', await call('POST', '/auth/logout', { cookie: challengeCookie })],
    ['POST /account/mfa/disable', await call('POST', '/account/mfa/disable', { cookie: challengeCookie, body: { password: PASSWORD, code: '123456' } })]
  ] as [string, Reply][]) {
    if (reply.status !== 401) record(false, `the challenge must not work for ${name}`, String(reply.status));
  }
  record(true, 'the challenge cookie is refused everywhere (profile, notifications, account, logout, disabling): it can only answer the second factor');
  const sessionsList = await call('GET', '/account/sessions', { cookie: (await signInWithCode('vendor@example.com', nextCode(secret))).verify.cookie });
  record(sessionsList.status === 200 && sessionsList.json.data.every((s: { id: string }) => s.id !== String(pendingSession?._id)), 'a challenge is not listed among the signed-in devices');

  const wrong = await call('POST', '/auth/mfa/verify', { cookie: challengeCookie, body: { code: wrongCode(secret) } });
  record(wrong.status === 401 && errorCode(wrong) === 'INVALID_MFA_CODE' && !wrong.cookie, 'a wrong code is refused (401) and signs nobody in');
  record((await call('POST', '/auth/mfa/verify', { body: { code: '123456' } })).status === 401, 'with no challenge at all the answer route is refused');
  record((await call('POST', '/auth/mfa/verify', { cookie: challengeCookie, body: { code: '123456', time: Date.now() } })).status === 400, 'no time, counter or any other field is accepted with the code');

  const codeA = nextCode(secret);
  startCapture();
  const good = await call('POST', '/auth/mfa/verify', { cookie: challengeCookie, body: { code: codeA } });
  const verifyLog = stopCapture();
  record(good.status === 200 && good.json.data.email === 'vendor@example.com' && good.json.data.mfa?.method === 'totp', 'the right code completes the sign-in and returns the account', String(good.status));
  record(!!good.cookie && good.cookie !== challengeCookie, 'with a NEW session token: the one that existed while only the password was known is not the one signed in');
  record((await call('POST', '/auth/mfa/verify', { cookie: challengeCookie, body: { code: nextCode(secret) } })).status === 401 && (await call('GET', '/auth/me', { cookie: challengeCookie })).status === 401, 'and that earlier token is dead: it cannot answer again, nor be used for anything');
  record((await call('GET', '/auth/me', { cookie: good.cookie })).status === 200, 'the new token works');
  // The answer route is for a challenge only: an account that is already signed in cannot use
  // it (to mint another session from a stolen one, or to probe codes without a password step).
  const fullAttempt = await call('POST', '/auth/mfa/verify', { cookie: good.cookie, body: { code: nextCode(secret) } });
  record(fullAttempt.status === 401 && !fullAttempt.cookie, 'a session that is already signed in cannot use the answer route (401, and no new session is issued)', String(fullAttempt.status));
  const fullSession = await Session.findOne({ accountId: vendor._id, mfaVerifiedAt: { $exists: true } });
  record(!!fullSession && !fullSession.mfaPending, 'server side the session records that a second factor was checked');
  record(![codeA, secret, challengeCookie.split('=')[1], good.cookie!.split('=')[1]].some(s => verifyLog.includes(s)), 'no authenticator code, secret or session token reached a log line during the sign-in');

  // ---- a code works once (V6.5.1)
  const reuse = await signInWithCode('vendor@example.com', codeA);
  record(reuse.verify.status === 401 && errorCode(reuse.verify) === 'INVALID_MFA_CODE', 'the same code cannot be used a second time, even within its 30 seconds (replay refused)');
  const reuseCode = nextCode(secret);
  const firstUse = await signInWithCode('vendor@example.com', reuseCode);
  const secondUse = await signInWithCode('vendor@example.com', reuseCode);
  record(firstUse.verify.status === 200 && secondUse.verify.status === 401, 'a code accepted once is refused at the next sign-in');
  // two requests carrying the same code at the same moment: one wins
  const raceCode = nextCode(secret);
  const racers = await Promise.all([login('vendor@example.com'), login('vendor@example.com')]);
  const race = await Promise.all(racers.map(r => call('POST', '/auth/mfa/verify', { cookie: r.cookie, body: { code: raceCode } })));
  record(race.filter(r => r.status === 200).length === 1 && race.filter(r => r.status === 401).length === 1, 'two requests sending the same code at once: exactly one is accepted');
  const olderStepCode = totpAt(secret, clock.now() - 30_000);
  const olderAttempt = await signInWithCode('vendor@example.com', olderStepCode);
  record(olderAttempt.verify.status === 401, 'a code of an OLDER step than the last one used is refused too (the accepted step only moves forward)');

  // ---- drift, and nothing beyond it
  advance(10 * 60_000);
  freeze();
  const previous = totpAt(secret, clock.now() - 30_000);
  record((await signInWithCode('vendor@example.com', previous)).verify.status === 200, 'with one step of allowed drift, the code of the step just before is accepted (a phone clock a little behind)');
  thaw();
  advance(10 * 60_000);
  freeze();
  const twoBack = totpAt(secret, clock.now() - 60_000);
  record((await signInWithCode('vendor@example.com', twoBack)).verify.status === 401, 'a code two steps old (over 30 s past its step) is refused');
  const twoAhead = totpAt(secret, clock.now() + 60_000);
  record((await signInWithCode('vendor@example.com', twoAhead)).verify.status === 401, 'and so is a code made for two steps ahead');
  const oneAhead = totpAt(secret, clock.now() + 30_000);
  record((await signInWithCode('vendor@example.com', oneAhead)).verify.status === 200, 'while a code made for the next step (a phone clock a little ahead) is accepted');
  thaw();
  advance(5 * 60_000); // well past the step just used, so every later check starts from a fresh one

  // ---- an expired challenge
  const slow = await login('vendor@example.com');
  await Session.findOneAndUpdate({ accountId: vendor._id, mfaPending: true, revokedAt: { $exists: false } }, { $set: { expiresAt: new Date(Date.now() - 1000) } }, { sort: { createdAt: -1 } });
  const late = await call('POST', '/auth/mfa/verify', { cookie: slow.cookie, body: { code: nextCode(secret) } });
  record(late.status === 401 && /expired/i.test(late.json.error.message), 'a challenge older than 5 minutes cannot be answered: the password must be entered again');

  // =============================================================== 5. wrong codes lock, apart from the password
  await makeAccount('locked@example.com');
  const lockedEnrol = await enroll('locked@example.com');
  const lockedChallenge = await login('locked@example.com');
  const attempts: number[] = [];
  for (let i = 0; i < 5; i += 1) attempts.push((await call('POST', '/auth/mfa/verify', { cookie: lockedChallenge.cookie, body: { code: wrongCode(lockedEnrol.secret) } })).status);
  record(attempts.every(s => s === 401), 'the first five wrong codes are refused as wrong (4 are free, the fifth starts the lock)', attempts.join(','));
  const whileLocked = await call('POST', '/auth/mfa/verify', { cookie: lockedChallenge.cookie, body: { code: nextCode(lockedEnrol.secret) } });
  record(whileLocked.status === 423 && errorCode(whileLocked) === 'ACCOUNT_LOCKED' && whileLocked.json.error.details?.retryAfterSeconds > 0, 'after that the account is locked (423): even the CORRECT code is refused, with the time to wait');
  const lockedCred = await MfaCredential.findOne({ accountId: (await Account.findOne({ email: 'locked@example.com' }))!._id });
  record((lockedCred?.failedCount ?? 0) >= 5 && !!lockedCred?.lockedUntil && lockedCred.lockedUntil.getTime() > Date.now(), 'the lock is recorded on the second factor itself');
  const againPassword = await login('locked@example.com');
  const stillLocked = await MfaCredential.findOne({ accountId: lockedCred!.accountId });
  record(againPassword.json.data.mfaRequired === true && stillLocked!.failedCount === lockedCred!.failedCount && !!stillLocked!.lockedUntil, 'signing in again with the correct PASSWORD does not clear the code lock (or guessing would never be limited)');
  const lockedAgain = await call('POST', '/auth/mfa/verify', { cookie: againPassword.cookie, body: { code: nextCode(lockedEnrol.secret) } });
  record(lockedAgain.status === 423, 'and the code is still refused on the new challenge');
  await MfaCredential.updateOne({ accountId: lockedCred!.accountId }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  const afterLock = await call('POST', '/auth/mfa/verify', { cookie: againPassword.cookie, body: { code: nextCode(lockedEnrol.secret) } });
  const cleared = await MfaCredential.findOne({ accountId: lockedCred!.accountId });
  record(afterLock.status === 200 && cleared!.failedCount === 0 && !cleared!.lockedUntil, 'once the lock has run out, the correct code signs in and clears the count');

  // =============================================================== 6. recovery codes
  await makeAccount('recover@example.com');
  const recoverEnrol = await enroll('recover@example.com');
  const mailsBefore = smtp.messages.length;
  const recoveryCode = recoverEnrol.recoveryCodes[3];
  const typed = recoveryCode.toLowerCase().replace(/-/g, ' ');
  const viaRecovery = await signInWithCode('recover@example.com', typed);
  record(viaRecovery.verify.status === 200 && viaRecovery.verify.json.data.mfa.method === 'recovery_code' && viaRecovery.verify.json.data.mfa.recoveryCodesRemaining === 9, 'a recovery code signs in, typed in lower case with spaces, and says 9 are left');
  record((await signInWithCode('recover@example.com', recoveryCode)).verify.status === 401, 'the same recovery code cannot be used twice (V6.5.1)');
  const recredential = await MfaCredential.findOne({ accountId: (await Account.findOne({ email: 'recover@example.com' }))!._id }).select('+recoveryCodes');
  record(recredential!.recoveryCodes.filter(c => c.usedAt).length === 1 && recredential!.recoveryCodes.filter(c => !c.usedAt).length === 9, 'exactly one is marked used');
  record((await signInWithCode('recover@example.com', 'AAAA-AAAA-AAAA-AAAA-AAAA')).verify.status === 401 && (await signInWithCode('recover@example.com', 'not a code at all')).verify.status === 401, 'a made-up recovery code, or text that is not a code, is refused');
  const newRecoveryMails = smtp.messages.slice(mailsBefore).map(readable);
  record(newRecoveryMails.some(m => /recover@example\.com/i.test(m) && /recovery code was used/i.test(m)), 'the owner is emailed when a recovery code is used to sign in');
  const raceCodes = recoverEnrol.recoveryCodes[5];
  const raceLogins = await Promise.all([login('recover@example.com'), login('recover@example.com')]);
  const raceRec = await Promise.all(raceLogins.map(r => call('POST', '/auth/mfa/verify', { cookie: r.cookie, body: { code: raceCodes } })));
  record(raceRec.filter(r => r.status === 200).length === 1, 'two requests using the same recovery code at once: exactly one is accepted');

  // ---- new recovery codes
  const signed = await signInWithCode('recover@example.com', nextCode(recoverEnrol.secret));
  const regenNoCode = await call('POST', '/account/mfa/recovery-codes', { cookie: signed.verify.cookie, body: { password: PASSWORD } });
  record(regenNoCode.status === 400, 'new recovery codes need a code as well as the password');
  const regenWrongPassword = await call('POST', '/account/mfa/recovery-codes', { cookie: signed.verify.cookie, body: { password: 'Wrong-Password-9', code: nextCode(recoverEnrol.secret) } });
  record(regenWrongPassword.status === 401, 'and the right password');
  const regen = await call('POST', '/account/mfa/recovery-codes', { cookie: signed.verify.cookie, body: { password: PASSWORD, code: nextCode(recoverEnrol.secret) } });
  record(regen.status === 200 && regen.json.data.recoveryCodes.length === 10 && regen.json.data.recoveryCodes.every((c: string) => !recoverEnrol.recoveryCodes.includes(c)), 'with both, ten NEW recovery codes are issued');
  record((await signInWithCode('recover@example.com', recoverEnrol.recoveryCodes[0])).verify.status === 401, 'an old recovery code no longer works (the old set is revoked)');
  record((await signInWithCode('recover@example.com', regen.json.data.recoveryCodes[0])).verify.status === 200, 'a new one does');
  const regenerateCode = nextCode(recoverEnrol.secret);
  const spent = await signInWithCode('recover@example.com', regenerateCode);
  record(spent.verify.status === 200 && (await call('POST', '/account/mfa/recovery-codes', { cookie: spent.verify.cookie, body: { password: PASSWORD, code: regenerateCode } })).status === 401, 'a code just used to sign in cannot be reused to change the settings (one use, wherever it is entered)');

  // =============================================================== 7. turning it off
  await makeAccount('off@example.com');
  const offEnrol = await enroll('off@example.com');
  const offSession = (await signInWithCode('off@example.com', nextCode(offEnrol.secret))).verify.cookie as string;
  const otherOff = (await signInWithCode('off@example.com', nextCode(offEnrol.secret))).verify.cookie as string;
  record((await call('POST', '/account/mfa/disable', { cookie: offSession, body: { password: 'Wrong-Password-9', code: nextCode(offEnrol.secret) } })).status === 401, 'turning it off with the wrong password is refused');
  record((await call('POST', '/account/mfa/disable', { cookie: offSession, body: { password: PASSWORD, code: wrongCode(offEnrol.secret) } })).status === 401, 'turning it off with a wrong code is refused');
  record((await call('POST', '/account/mfa/disable', { cookie: offSession, body: { password: PASSWORD } })).status === 400, 'a code is required');
  const mailsOff = smtp.messages.length;
  const off = await call('POST', '/account/mfa/disable', { cookie: offSession, body: { password: PASSWORD, code: nextCode(offEnrol.secret) } });
  record(off.status === 200, 'with the password and a valid code it is turned off');
  const offAccount = await Account.findOne({ email: 'off@example.com' });
  record(!offAccount!.mfaEnabled && (await MfaCredential.countDocuments({ accountId: offAccount!._id })) === 0, 'the flag is off and the secret and recovery codes are DELETED');
  record((await call('GET', '/auth/me', { cookie: otherOff })).status === 401 && (await call('GET', '/auth/me', { cookie: offSession })).status === 200, 'other sessions are ended; the one that did it stays');
  record((await login('off@example.com')).json.data.mfaRequired === undefined, 'signing in is password-only again');
  record(smtp.messages.slice(mailsOff).map(readable).some(m => /off@example\.com/i.test(m) && /turned off two-step verification/i.test(m)), 'the owner is emailed that it was turned off');
  record(!!(await AuditLog.findOne({ action: 'account.mfa_disabled', entityId: String(offAccount!._id) })), 'and the audit log records it');

  // =============================================================== 8. staff must use it
  (env as { MFA_REQUIRED_FOR_STAFF: boolean }).MFA_REQUIRED_FOR_STAFF = true;
  const adminAccount = await makeAccount('admin@example.com', 'admin', ['poll&tag:manage']);
  const superAccount = await makeAccount('super@example.com', 'superadmin');
  const adminLogin = await login('admin@example.com');
  record(adminLogin.status === 200 && adminLogin.json.data.mfaSetupRequired === true && adminLogin.json.data.mfaEnabled === false, 'an Admin with no second factor signs in, and the account says setup is required');
  const probes = ['/admin/dashboard', '/admin/tags', '/admin/accounts', '/admin/ingestion/status', '/admin/audit-log', '/admin/works'];
  const blocked = await Promise.all(probes.map(p => call('GET', p, { cookie: adminLogin.cookie })));
  record(blocked.every(r => r.status === 403 && errorCode(r) === 'MFA_SETUP_REQUIRED'), 'until it is set up, every admin route answers 403 MFA_SETUP_REQUIRED', blocked.map(r => `${r.status}`).join(','));
  const superLogin = await login('super@example.com');
  record((await call('GET', '/admin/staff', { cookie: superLogin.cookie })).status === 403 && (await call('GET', '/admin/dashboard', { cookie: superLogin.cookie })).status === 403, 'a Super Admin without one is blocked the same way, from everything');
  record((await call('GET', '/account/profile', { cookie: adminLogin.cookie })).status === 200 && (await call('GET', '/notifications', { cookie: adminLogin.cookie })).status === 200, 'what is not the admin area (their own account, notifications) still works');
  const adminStatus = await call('GET', '/account/mfa', { cookie: adminLogin.cookie });
  record(adminStatus.json.data.required === true && adminStatus.json.data.setupRequired === true, 'the setup is reachable, and says it is required');
  const adminSetup = await call('POST', '/account/mfa/setup', { cookie: adminLogin.cookie, body: { password: PASSWORD } });
  const adminEnable = await call('POST', '/account/mfa/enable', { cookie: adminLogin.cookie, body: { code: nextCode(adminSetup.json.data.secret) } });
  record(adminEnable.status === 200, 'an Admin can set it up while blocked');
  const unblocked = await Promise.all(probes.map(p => call('GET', p, { cookie: adminLogin.cookie })));
  record(unblocked.every(r => r.status === 200), 'and the admin area opens straight away (the requirement is read from the database on every request)', unblocked.map(r => `${r.status}`).join(','));
  const adminSecret = adminSetup.json.data.secret as string;
  const adminChallenge = await login('admin@example.com');
  record(adminChallenge.json.data.mfaRequired === true && (await call('GET', '/admin/dashboard', { cookie: adminChallenge.cookie })).status === 401, 'from now on an Admin signs in with the second factor, and the challenge opens nothing');
  const adminFull = (await call('POST', '/auth/mfa/verify', { cookie: adminChallenge.cookie, body: { code: nextCode(adminSecret) } })).cookie as string;
  record((await call('GET', '/admin/dashboard', { cookie: adminFull })).status === 200, 'after the code the admin area works');
  const adminOff = await call('POST', '/account/mfa/disable', { cookie: adminFull, body: { password: PASSWORD, code: nextCode(adminSecret) } });
  record(adminOff.status === 403 && /required for your role/i.test(adminOff.json.error.message) && (await Account.findById(adminAccount._id))!.mfaEnabled, 'an Admin cannot turn it off: it is required for the role (403), and it stays on');
  (env as { MFA_REQUIRED_FOR_STAFF: boolean }).MFA_REQUIRED_FOR_STAFF = false;
  const relaxed = await login('super@example.com');
  record((await call('GET', '/admin/dashboard', { cookie: relaxed.cookie })).status === 200 && relaxed.json.data.mfaSetupRequired === false, 'with MFA_REQUIRED_FOR_STAFF off (a development setup) an account without a second factor may use the admin area');
  (env as { MFA_REQUIRED_FOR_STAFF: boolean }).MFA_REQUIRED_FOR_STAFF = true;
  const vendorRequired = await login('vendor@example.com');
  record(vendorRequired.json.data.mfaSetupRequired === undefined || vendorRequired.json.data.mfaSetupRequired === false, 'a vendor is never required to use it, with the requirement on');

  // =============================================================== 9. a lost factor: an administrator resets it
  await makeAccount('lost@example.com');
  const lostEnrol = await enroll('lost@example.com');
  const lostAccount = (await Account.findOne({ email: 'lost@example.com' }))!;
  const lostSession = (await signInWithCode('lost@example.com', nextCode(lostEnrol.secret))).verify.cookie as string;
  const adminSession = adminFull;
  const resetBody = { password: PASSWORD, identityCheck: 'video_call', reason: 'Called back on the number registered for the company and checked the tax ID.' };
  const resetUrl = `/admin/accounts/${lostAccount._id}/mfa-reset`;

  record((await call('POST', resetUrl, { body: resetBody })).status === 401, 'resetting needs a signed-in administrator (401 without)');
  record((await call('POST', resetUrl, { cookie: lostSession, body: resetBody })).status === 403, 'a vendor cannot reset anyone\'s (403)');
  record((await call('POST', resetUrl, { cookie: adminSession, body: { ...resetBody, identityCheck: undefined } })).status === 400, 'the identity check must be stated (400 without it)');
  record((await call('POST', resetUrl, { cookie: adminSession, body: { ...resetBody, identityCheck: 'trust_me' } })).status === 400, 'and must be one of the known ones');
  record((await call('POST', resetUrl, { cookie: adminSession, body: { ...resetBody, reason: 'ok' } })).status === 400, 'with a reason in words (at least 10 characters)');
  record((await call('POST', resetUrl, { cookie: adminSession, body: { ...resetBody, password: 'Wrong-Password-9' } })).status === 401, 'the administrator re-enters their OWN password: a wrong one is refused (401)');
  record((await MfaCredential.countDocuments({ accountId: lostAccount._id })) === 1 && (await Account.findById(lostAccount._id))!.mfaEnabled, 'and none of those refusals changed anything');
  record((await call('POST', `/admin/accounts/${adminAccount._id}/mfa-reset`, { cookie: adminSession, body: resetBody })).status === 404, 'the vendor route does not reach a staff account (404)');

  const mailsReset = smtp.messages.length;
  const reset = await call('POST', resetUrl, { cookie: adminSession, body: resetBody });
  record(reset.status === 200 && reset.json.data.sessionsRevoked >= 1, 'with everything stated, the reset is done');
  const afterReset = await Account.findById(lostAccount._id);
  record(!afterReset!.mfaEnabled && (await MfaCredential.countDocuments({ accountId: lostAccount._id })) === 0, 'the second factor, its secret and its codes are gone');
  record((await call('GET', '/auth/me', { cookie: lostSession })).status === 401, 'every session of that account was ended');
  const resetAudit = await AuditLog.findOne({ action: 'account.mfa_reset', entityId: String(lostAccount._id) }).lean();
  const resetMeta = (resetAudit?.metadata ?? {}) as Record<string, unknown>;
  record(!!resetAudit && resetMeta.identityCheck === 'video_call' && resetMeta.resetBy === 'admin@example.com' && /Called back/.test(String(resetMeta.reason)), 'the audit log says who reset it, which identity check was done, and why');
  record(smtp.messages.slice(mailsReset).map(readable).some(m => /lost@example\.com/i.test(m) && /reset your two-step verification/i.test(m)), 'the owner is emailed');
  record((await call('POST', resetUrl, { cookie: adminSession, body: resetBody })).status === 409, 'resetting an account that has none is refused (409)');
  record((await login('lost@example.com')).json.data.mfaRequired === undefined, 'the person can sign in with the password and set up a new authenticator');

  // ---- staff: only a Super Admin, and only for a plain Admin
  const targetAdmin = await makeAccount('target-admin@example.com', 'admin', ['tag:manage']);
  const targetEnrol = await enroll('target-admin@example.com');
  const staffUrl = `/admin/staff/${targetAdmin._id}/mfa-reset`;
  const superSetup = await call('POST', '/account/mfa/setup', { cookie: superLogin.cookie, body: { password: PASSWORD } });
  await call('POST', '/account/mfa/enable', { cookie: superLogin.cookie, body: { code: nextCode(superSetup.json.data.secret) } });
  const superFull = (await call('POST', '/auth/mfa/verify', { cookie: (await login('super@example.com')).cookie, body: { code: nextCode(superSetup.json.data.secret) } })).cookie as string;
  record((await call('POST', staffUrl, { cookie: adminFull, body: resetBody })).status === 403, 'a plain Admin cannot reset an Admin\'s second factor (403)');
  record((await call('POST', `/admin/staff/${superAccount._id}/mfa-reset`, { cookie: superFull, body: resetBody })).status === 403, 'nor can anyone reset a Super Admin\'s from the panel (403): that stays a command-line act');
  const staffReset = await call('POST', staffUrl, { cookie: superFull, body: resetBody });
  record(staffReset.status === 200 && !(await Account.findById(targetAdmin._id))!.mfaEnabled, 'a Super Admin resets a plain Admin\'s');
  const targetBack = await login('target-admin@example.com');
  record(targetBack.json.data.mfaRequired === undefined && targetBack.json.data.mfaSetupRequired === true && (await call('GET', '/admin/dashboard', { cookie: targetBack.cookie })).status === 403, 'that Admin must set up a new one before using the admin area again');
  record(!!(await AuditLog.findOne({ action: 'account.mfa_reset', entityId: String(targetAdmin._id) })) && targetEnrol.secret.length > 0, 'and the audit log records that too');
  const staffAudit = await call('GET', '/admin/audit-log?action=account.mfa_reset', { cookie: adminFull });
  record(staffAudit.status === 200 && !JSON.stringify(staffAudit.json).includes('target-admin@example.com'), 'entries about staff accounts stay hidden from a plain Admin\'s view of the audit log, as for every other staff change');

  // =============================================================== 10. deleting an account, and the command line
  const gone = await makeAccount('gone@example.com');
  await enroll('gone@example.com');
  const del = await call('DELETE', `/admin/accounts/${gone._id}`, { cookie: adminSession });
  record(del.status === 200 && (await MfaCredential.countDocuments({ accountId: gone._id })) === 0, 'deleting an account deletes its second factor');

  const cliAccount = await makeAccount('cli@example.com', 'superadmin');
  const cliEnrol = await enroll('cli@example.com');
  const cliSession = (await signInWithCode('cli@example.com', nextCode(cliEnrol.secret))).verify.cookie as string;
  const runCli = (args: string[]) =>
    spawnSync(path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx'), ['src/scripts/resetMfa.ts', ...args], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, MONGODB_URI, DOTENV_CONFIG_PATH: '/dev/null', SMTP_HOST: '' },
      encoding: 'utf8',
      timeout: 60_000
    });
  record(runCli([]).status === 1 && runCli(['cli@example.com', 'short']).status === 1 && runCli(['nobody@example.com', 'A reason that is long enough']).status === 1, 'the command-line reset refuses a missing email, a reason under 10 characters, and an unknown account');
  const cli = runCli(['cli@example.com', 'Lost both the phone and the recovery codes; verified in person.']);
  record(cli.status === 0 && /removed from cli@example\.com/.test(cli.stdout), 'the command-line reset works for a Super Admin (what the panel will not do)', (cli.stdout + cli.stderr).slice(0, 160));
  record(!(await Account.findById(cliAccount._id))!.mfaEnabled && (await MfaCredential.countDocuments({ accountId: cliAccount._id })) === 0 && (await call('GET', '/auth/me', { cookie: cliSession })).status === 401, 'it removes the factor and ends the sessions');
  const cliAudit = await AuditLog.findOne({ action: 'account.mfa_reset', entityId: String(cliAccount._id) }).lean();
  record((cliAudit?.metadata as Record<string, unknown> | undefined)?.identityCheck === 'server_access' && /verified in person/.test(String((cliAudit?.metadata as Record<string, unknown>)?.reason)), 'and records, in the audit log, that it was done from the command line and why');

  // =============================================================== 11. rate limits
  (mfaVerifyLimiter as unknown as { resetKey(k: string): void }).resetKey('127.0.0.1');
  const verifyStatuses: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const res = await fetch(base + '/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456' }) });
    verifyStatuses.push(res.status);
  }
  record(verifyStatuses.slice(0, 10).every(s => s === 401) && verifyStatuses[10] === 429, 'the answer route allows 10 tries per address per 15 minutes, then answers 429', verifyStatuses.join(','));
  clearLimits();

  const manageAccount = await makeAccount('limit@example.com');
  const limitSession = (await login('limit@example.com')).cookie as string;
  (mfaManageLimiter as unknown as { resetKey(k: string): void }).resetKey(`account:${manageAccount._id}`);
  const manage: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const res = await fetch(base + '/account/mfa/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: limitSession }, body: JSON.stringify({ password: 'Wrong-Password-9' }) });
    manage.push(res.status);
  }
  record(manage[10] === 429 && manage.slice(0, 4).every(s => s === 401), 'changing a second factor is limited per account too: 10 tries, then 429', manage.join(','));

  // =============================================================== 12. a recovery attempt is told nothing more than a wrong one
  await signInWithCode('vendor@example.com', nextCode(secret)); // a success: the count of wrong codes starts again
  const sameAnswer = await Promise.all([
    signInWithCode('vendor@example.com', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'),
    signInWithCode('vendor@example.com', '000000')
  ]);
  record(sameAnswer.every(({ verify }) => verify.status === 401 && errorCode(verify) === 'INVALID_MFA_CODE' && verify.json.error.message === sameAnswer[0].verify.json.error.message), 'a wrong code and an unknown recovery code get the very same answer (no hint which kind of input was close)');

  server.close();
  await mongoose.connection.dropDatabase();
  await smtp.close();
  await mongoose.disconnect();

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
