// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import { Request } from 'express';
import mongoose from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { Account } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { resetPassword } from '../../src/services/account.service';
import { loginWithPassword } from '../../src/services/auth.service';
import { FREE_ATTEMPTS, MAX_LOCK_MS, lockDurationMs } from '../../src/services/loginLockout.service';
import { issueToken } from '../../src/services/token.service';
import { AppError } from '../../src/utils/AppError';

// Per-account sign-in lockout (loginLockout.service.ts). Uses its own throwaway
// database (dropped at the start and end) -- never touches the dev database.
// loginLimiter allows 10 HTTP sign-ins per IP per 15 min across this whole
// process, so most attempts go through the service directly, which is also how
// "many different IPs" is simulated.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-login-lockout-check';

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: { retryAfterSeconds?: number } };
}

const MINUTE = 60 * 1000;
const EMAIL = 'lockout@company.co.th';
const PASSWORD = 'SecurePass123';
const WRONG = 'WrongPass123';

function fakeRequest(ip: string): Request {
  return { ip, get: () => undefined } as unknown as Request;
}

async function serviceLogin(password: string, ip: string): Promise<string> {
  try {
    await loginWithPassword({ email: EMAIL, password }, fakeRequest(ip));
    return 'OK';
  } catch (error) {
    return error instanceof AppError ? error.code : `THREW ${String(error)}`;
  }
}

async function lockState() {
  const account = await Account.findOne({ email: EMAIL }).select('+failedLoginCount +lockedUntil +lastFailedLoginAt');
  const lockMs = account?.lockedUntil ? account.lockedUntil.getTime() - Date.now() : 0;
  return { count: account?.failedLoginCount ?? 0, lockMs, lockedUntil: account?.lockedUntil, lastFailed: account?.lastFailedLoginAt };
}

const near = (actual: number, expected: number) => Math.abs(actual - expected) < 5000;

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function login(email: string, password: string) {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = (await res.json().catch(() => null)) as Envelope | null;
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }

  // --- The delay schedule ---
  const schedule = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50].map(lockDurationMs);
  record(
    schedule.slice(0, FREE_ATTEMPTS + 1).every(ms => ms === 0),
    `the first ${FREE_ATTEMPTS} failures do not lock`,
    JSON.stringify(schedule)
  );
  record(
    lockDurationMs(5) === MINUTE && lockDurationMs(6) === 2 * MINUTE && lockDurationMs(7) === 4 * MINUTE && lockDurationMs(9) === 16 * MINUTE,
    'the lock doubles with each further failure (1, 2, 4, ... 16 min)'
  );
  record(lockDurationMs(10) === MAX_LOCK_MS && lockDurationMs(50) === MAX_LOCK_MS, 'the lock is capped at 30 min');

  const account = await Account.create({ name: 'Lockout Test', email: EMAIL, passwordHash: PASSWORD, type: 'individual' });
  const auditRowsBefore = await AuditLog.countDocuments({ entityId: String(account._id) });

  // --- Over HTTP: lock, refusal, growth, success ---
  for (let i = 1; i <= FREE_ATTEMPTS; i++) {
    const res = await login(EMAIL, WRONG);
    record(res.status === 401 && res.json?.error?.code === 'INVALID_CREDENTIALS', `wrong password #${i} -> 401 INVALID_CREDENTIALS`, JSON.stringify(res.json));
  }
  let state = await lockState();
  record(state.count === FREE_ATTEMPTS && !state.lockedUntil, `after ${FREE_ATTEMPTS} failures: counted, not locked`, JSON.stringify(state));

  const fifth = await login(EMAIL, WRONG);
  record(fifth.status === 401 && fifth.json?.error?.code === 'INVALID_CREDENTIALS', 'the failure that triggers the lock is itself answered normally');
  state = await lockState();
  record(state.count === 5 && near(state.lockMs, MINUTE), 'the 5th failure locks the account for 1 minute', JSON.stringify(state));

  const whileLocked = await login(EMAIL, PASSWORD);
  const retryAfter = whileLocked.json?.error?.details?.retryAfterSeconds ?? -1;
  record(
    whileLocked.status === 423 && whileLocked.json?.error?.code === 'ACCOUNT_LOCKED' && retryAfter > 0 && retryAfter <= 60,
    'even the CORRECT password is refused while locked (423 ACCOUNT_LOCKED + retryAfterSeconds)',
    JSON.stringify(whileLocked.json)
  );
  record(!whileLocked.setCookie, 'no session cookie while locked');
  const afterRefusal = await lockState();
  record(
    afterRefusal.count === 5 && afterRefusal.lockedUntil?.getTime() === state.lockedUntil?.getTime(),
    'a refused attempt neither counts nor extends the lock',
    JSON.stringify(afterRefusal)
  );

  await Account.updateOne({ _id: account._id }, { lockedUntil: new Date(Date.now() - 1000) });
  const sixth = await login(EMAIL, WRONG);
  state = await lockState();
  record(sixth.status === 401 && state.count === 6 && near(state.lockMs, 2 * MINUTE), 'after the lock runs out, the next failure locks for 2 minutes', JSON.stringify(state));

  await Account.updateOne({ _id: account._id }, { lockedUntil: new Date(Date.now() - 1000) });
  const success = await login(EMAIL, PASSWORD);
  state = await lockState();
  record(success.status === 200 && !!success.setCookie?.startsWith(`${SESSION_COOKIE_NAME}=`), 'the correct password works once the lock has run out');
  record(state.count === 0 && !state.lockedUntil && !state.lastFailed, 'a successful sign-in clears the count and the lock', JSON.stringify(state));
  const body = JSON.stringify(success.json);
  record(!body.includes('failedLoginCount') && !body.includes('lockedUntil') && !body.includes('lastFailedLoginAt'), 'lockout bookkeeping is not in the account JSON');

  const unknown = await login('nobody@company.co.th', WRONG);
  record(unknown.status === 401 && unknown.json?.error?.code === 'INVALID_CREDENTIALS', 'an unknown email is still a plain INVALID_CREDENTIALS');

  record(
    (await AuditLog.countDocuments({ entityId: String(account._id) })) === auditRowsBefore,
    'failed / successful sign-ins write no audit rows (bookkeeping only)'
  );

  // --- Many IPs: the per-IP limiter would not notice, the account lock does ---
  const rotating: string[] = [];
  for (let i = 1; i <= 5; i++) rotating.push(await serviceLogin(WRONG, `10.0.0.${i}`));
  rotating.push(await serviceLogin(PASSWORD, '10.0.0.99'));
  record(
    JSON.stringify(rotating) === JSON.stringify([...Array(5).fill('INVALID_CREDENTIALS'), 'ACCOUNT_LOCKED']),
    'five failures from five different IPs still lock the account',
    JSON.stringify(rotating)
  );

  // --- A parallel burst can't slip past the lock during the bcrypt compare ---
  await Account.updateOne({ _id: account._id }, { failedLoginCount: FREE_ATTEMPTS, lastFailedLoginAt: new Date(), $unset: { lockedUntil: 1 } });
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => serviceLogin(WRONG, `192.168.1.${i}`)));
  record(
    burst.filter(code => code === 'INVALID_CREDENTIALS').length === 1 && burst.filter(code => code === 'ACCOUNT_LOCKED').length === 7,
    'of 8 parallel guesses at the threshold, exactly one is checked; the rest are refused',
    JSON.stringify(burst)
  );

  // --- Old failures are forgotten ---
  await Account.updateOne(
    { _id: account._id },
    { failedLoginCount: FREE_ATTEMPTS, lastFailedLoginAt: new Date(Date.now() - 2 * 24 * 60 * MINUTE), $unset: { lockedUntil: 1 } }
  );
  const afterQuiet = await serviceLogin(WRONG, '10.1.1.1');
  state = await lockState();
  record(afterQuiet === 'INVALID_CREDENTIALS' && state.count === 1 && !state.lockedUntil, 'failures older than 24h are forgotten (count restarts at 1)', JSON.stringify(state));

  // --- A password reset lifts the lock ---
  await Account.updateOne({ _id: account._id }, { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 20 * MINUTE) });
  await resetPassword(await issueToken(account._id, 'password_reset'), 'BrandNewPass456');
  state = await lockState();
  record(state.count === 0 && !state.lockedUntil, 'a password reset clears the lock', JSON.stringify(state));
  record((await serviceLogin('BrandNewPass456', '10.2.2.2')) === 'OK', 'and the new password signs in straight away');

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
