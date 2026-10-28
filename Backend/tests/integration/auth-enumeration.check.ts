// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../../src/config/env';
import { Account } from '../../src/models/account.model';
import { Session } from '../../src/models/session.model';
import { loginWithPassword, registerAccount } from '../../src/services/auth.service';
import { clearFailedLogins } from '../../src/services/loginLockout.service';

// Account enumeration: sign-in and sign-up must not reveal which emails have an
// account -- by their answer, by what they cost, or by their timing. Uses its
// own throwaway database (dropped at the start and end).
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-auth-enumeration-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const PASSWORD = 'SecurePass123';
const WRONG = 'WrongPass123';
const fakeRequest = (): Request => ({ ip: '203.0.113.9', get: () => undefined }) as unknown as Request;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn().catch(() => undefined);
  return Number(process.hrtime.bigint() - start) / 1e6;
}
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
}

// Count (and keep) every bcrypt call the app makes.
const realCompare = bcrypt.compare;
const realHash = bcrypt.hash;
const compares: { plain: string; hash: string }[] = [];
let hashes = 0;
(bcrypt as any).compare = (plain: string, hash: string, ...rest: unknown[]) => {
  compares.push({ plain, hash });
  return (realCompare as any).call(bcrypt, plain, hash, ...rest);
};
(bcrypt as any).hash = (...args: unknown[]) => {
  hashes += 1;
  return (realHash as any).apply(bcrypt, args);
};
const resetSpy = () => {
  compares.length = 0;
  hashes = 0;
};

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Account.init();

  const mk = (email: string, status: 'active' | 'suspended') =>
    Account.create({ email, passwordHash: PASSWORD, name: 'Test User', type: 'individual', status });
  const active = await mk('active@example.com', 'active');
  const suspended = await mk('suspended@example.com', 'suspended');
  const hashOf = async (id: unknown) => (await Account.findById(id).select('+passwordHash'))!.passwordHash;
  const activeHash = await hashOf(active._id);
  const suspendedHash = await hashOf(suspended._id);

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function post(p: string, body: unknown) {
    const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text(), cookie: res.headers.get('set-cookie') };
  }
  const parse = (text: string) => JSON.parse(text);

  // ============================================================ sign-in: what it says
  // (loginLimiter allows 10 HTTP sign-ins per IP, so only 6 are used here.)
  const unknown = await post('/auth/login', { email: 'nobody@example.com', password: PASSWORD });
  const wrongActive = await post('/auth/login', { email: 'active@example.com', password: WRONG });
  const wrongSuspended = await post('/auth/login', { email: 'suspended@example.com', password: WRONG });
  record(unknown.status === 401 && parse(unknown.text).error?.code === 'INVALID_CREDENTIALS', 'unknown email -> 401 INVALID_CREDENTIALS', unknown.text);
  record(wrongActive.status === 401 && parse(wrongActive.text).error?.code === 'INVALID_CREDENTIALS', 'wrong password on an active account -> 401 INVALID_CREDENTIALS');
  record(wrongSuspended.status === 401 && parse(wrongSuspended.text).error?.code === 'INVALID_CREDENTIALS', 'wrong password on a SUSPENDED account -> 401 INVALID_CREDENTIALS, not 403 (the suspension is not revealed)', wrongSuspended.text);
  record(unknown.text === wrongActive.text && wrongActive.text === wrongSuspended.text, 'all three answers are byte-for-byte identical (status, code, message, body)');
  record(!unknown.cookie && !wrongActive.cookie && !wrongSuspended.cookie, 'none of them sets a cookie');

  const suspendedRight = await post('/auth/login', { email: 'suspended@example.com', password: PASSWORD });
  record(suspendedRight.status === 403 && parse(suspendedRight.text).error?.code === 'ACCOUNT_SUSPENDED' && !suspendedRight.cookie, 'a suspended account with the RIGHT password is still told it is suspended (and gets no session)', suspendedRight.text);
  record((await Session.countDocuments({ accountId: suspended._id })) === 0, 'and no session was created for it');
  const activeRight = await post('/auth/login', { email: 'active@example.com', password: PASSWORD });
  record(activeRight.status === 200 && !!activeRight.cookie, 'an active account with the right password still signs in');
  const lookalike = await post('/auth/login', { email: 'nobody@example.com', password: 'not-a-real-password' });
  record(lookalike.status === 401 && !lookalike.cookie, 'no password signs in to an unknown email, whatever it is (the dummy hash cannot match)');
  await Account.updateOne({ _id: active._id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1, lastFailedLoginAt: 1 } });
  await Account.updateOne({ _id: suspended._id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1, lastFailedLoginAt: 1 } });

  // ====================================================== sign-in: what it costs (bcrypt)
  const attempt = (email: string, password: string) => () => loginWithPassword({ email, password }, fakeRequest());
  async function bcryptCallsFor(label: string, fn: () => Promise<unknown>, expectedOutcome: string) {
    await clearFailedLogins(active._id);
    await clearFailedLogins(suspended._id);
    resetSpy();
    const got = await outcome(fn);
    const calls = [...compares];
    record(got === expectedOutcome, `${label}: answers ${expectedOutcome}`, got);
    record(calls.length === 1, `${label}: runs exactly one bcrypt compare`, `${calls.length}`);
    return calls[0];
  }
  const unknownCall = await bcryptCallsFor('unknown email', attempt('nobody@example.com', PASSWORD), 'INVALID_CREDENTIALS');
  const activeCall = await bcryptCallsFor('active, wrong password', attempt('active@example.com', WRONG), 'INVALID_CREDENTIALS');
  const suspendedWrongCall = await bcryptCallsFor('suspended, wrong password', attempt('suspended@example.com', WRONG), 'INVALID_CREDENTIALS');
  const suspendedRightCall = await bcryptCallsFor('suspended, right password', attempt('suspended@example.com', PASSWORD), 'ACCOUNT_SUSPENDED');
  record(activeCall?.hash === activeHash && suspendedWrongCall?.hash === suspendedHash && suspendedRightCall?.hash === suspendedHash, 'a real account is compared against its own hash');
  record(!!unknownCall && unknownCall.hash !== activeHash && unknownCall.hash !== suspendedHash && unknownCall.plain === PASSWORD, 'an unknown email is compared (the submitted password) against a hash that belongs to nobody');
  record(!!unknownCall && bcrypt.getRounds(unknownCall.hash) === env.BCRYPT_ROUNDS && bcrypt.getRounds(activeHash) === env.BCRYPT_ROUNDS, `the dummy hash has the same cost as real ones (${env.BCRYPT_ROUNDS} rounds), so it takes as long`, `${unknownCall ? bcrypt.getRounds(unknownCall.hash) : 'n/a'}`);
  await clearFailedLogins(active._id);
  resetSpy();
  await outcome(attempt('another-nobody@example.com', PASSWORD));
  record(compares.length === 1 && compares[0].hash === unknownCall?.hash && hashes === 0, 'the dummy hash is made once and reused (no extra hashing per request)');

  // ====================================================== sign-in: what it costs (time)
  const N = 7;
  const samples: Record<'unknown' | 'active' | 'suspended', number[]> = { unknown: [], active: [], suspended: [] };
  for (let i = 0; i < N; i++) {
    await clearFailedLogins(active._id);
    await clearFailedLogins(suspended._id);
    samples.unknown.push(await timed(attempt(`nobody${i}@example.com`, WRONG)));
    samples.active.push(await timed(attempt('active@example.com', WRONG)));
    samples.suspended.push(await timed(attempt('suspended@example.com', WRONG)));
  }
  const med = { unknown: median(samples.unknown), active: median(samples.active), suspended: median(samples.suspended) };
  const detail = `median ms: unknown ${med.unknown.toFixed(0)}, active ${med.active.toFixed(0)}, suspended ${med.suspended.toFixed(0)}`;
  record(med.unknown > 30, 'timing: an unknown email takes bcrypt-sized time, not a few ms', detail);
  record(med.unknown / med.active > 0.6 && med.unknown / med.active < 1.7, 'timing: unknown email vs wrong password differ by well under the 50x gap there used to be', detail);
  record(med.suspended / med.active > 0.6 && med.suspended / med.active < 1.7, 'timing: a suspended account answers as slowly as an active one', detail);

  // ===================================================================== sign-up
  const body = (email: string, extra: Record<string, unknown> = {}) => ({ name: 'Somchai Jaidee', email, password: PASSWORD, confirmPassword: PASSWORD, type: 'individual', ...extra });
  const fresh = await post('/auth/register', body('fresh@example.com'));
  record(fresh.status === 201 && !!fresh.cookie, 'sign-up with a new email still works (201 + session)');
  const dupe = await post('/auth/register', body('fresh@example.com', { name: 'Someone Else', password: 'OtherPass456', confirmPassword: 'OtherPass456' }));
  const dupeCase = await post('/auth/register', body('  FRESH@Example.com '));
  const dupeSuspended = await post('/auth/register', body('suspended@example.com'));
  const dupeJson = parse(dupe.text);
  record(dupe.status === 409 && dupeJson.error?.code === 'REGISTRATION_FAILED', 'sign-up with a taken email -> 409 REGISTRATION_FAILED, not EMAIL_ALREADY_REGISTERED', dupe.text);
  record(dupeJson.error?.fields === undefined, 'the refusal does not point at the email field');
  record(!/in use|registered|taken|exists|email/i.test(dupeJson.error?.message ?? ''), 'its message does not say the email is the problem', dupeJson.error?.message);
  record(!dupe.text.includes('fresh@example.com'), 'and does not echo the email back');
  record(dupeCase.status === 409 && parse(dupeCase.text).error?.code === 'REGISTRATION_FAILED' && parse(dupeCase.text).error?.message === dupeJson.error?.message, 'a taken email in a different case/spacing gets the same answer');
  record(dupeSuspended.status === 409 && dupeSuspended.text === dupe.text, 'a taken email that belongs to a suspended account gets the same answer, byte for byte');
  record(!dupe.cookie && !dupeCase.cookie && !dupeSuspended.cookie, 'a refused sign-up sets no cookie');
  record((await Account.countDocuments({ email: 'fresh@example.com' })) === 1, 'and creates no second account');
  const dupeName = await Account.findOne({ email: 'fresh@example.com' });
  record(dupeName?.name === 'Somchai Jaidee', 'and does not overwrite the existing account');

  // cost: a taken email must be hashed too (the duplicate is only refused at insert)
  resetSpy();
  await outcome(() => registerAccount({ name: 'Somchai Jaidee', email: 'fresh@example.com', password: PASSWORD, type: 'individual' }, fakeRequest()));
  const dupeHashes = hashes;
  resetSpy();
  await outcome(() => registerAccount({ name: 'Somchai Jaidee', email: 'brand-new@example.com', password: PASSWORD, type: 'individual' }, fakeRequest()));
  record(dupeHashes === 1 && hashes === 1, 'sign-up: a taken email costs one bcrypt hash, exactly like a free one', `taken ${dupeHashes}, free ${hashes}`);
  const reg = { taken: [] as number[], free: [] as number[] };
  for (let i = 0; i < 5; i++) {
    reg.taken.push(await timed(() => registerAccount({ name: 'Somchai Jaidee', email: 'fresh@example.com', password: PASSWORD, type: 'individual' }, fakeRequest())));
    reg.free.push(await timed(() => registerAccount({ name: 'Somchai Jaidee', email: `free${i}@example.com`, password: PASSWORD, type: 'individual' }, fakeRequest())));
  }
  const regMed = { taken: median(reg.taken), free: median(reg.free) };
  const regDetail = `median ms: taken ${regMed.taken.toFixed(0)}, free ${regMed.free.toFixed(0)}`;
  record(regMed.taken > 30 && regMed.taken / regMed.free > 0.6 && regMed.taken / regMed.free < 1.7, 'sign-up timing: a taken email is not measurably faster than a free one', regDetail);
  const other = await outcome(() => registerAccount({ name: '', email: 'x@example.com', password: PASSWORD, type: 'individual' }, fakeRequest()));
  record(other !== 'REGISTRATION_FAILED' && other !== 'ok', 'a genuine failure (invalid data) is still reported as what it is, not swallowed', other);

  // ============================================================ wiring in source
  const src = fs.readFileSync(path.join(__dirname, '../../src/services/auth.service.ts'), 'utf8');
  const login = src.slice(src.indexOf('export async function loginWithPassword'));
  record(login.indexOf('comparePassword') !== -1 && login.indexOf('comparePassword') < login.indexOf('accountSuspended'), 'source: the password is checked before the suspended status');
  record(login.indexOf('getDummyHash') !== -1 && login.indexOf('getDummyHash') < login.indexOf('reserveLoginAttempt'), 'source: the unknown-email branch does the dummy compare');
  record(!/Account\.(findOne|exists|countDocuments)[^\n]*email/.test(src.slice(src.indexOf('export async function registerAccount'), src.indexOf('export async function loginWithPassword'))), 'source: sign-up does no "is this email taken?" lookup before hashing');

  server.close();
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
