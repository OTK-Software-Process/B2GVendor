// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { IDLE_TIMEOUT_MESSAGE } from '../../src/middlewares/auth.middleware';
import { loginLimiter, registerLimiter } from '../../src/middlewares/rateLimit.middleware';
import { Account } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { Session, hashSessionToken } from '../../src/models/session.model';
import { issueToken } from '../../src/services/token.service';
import { PASSWORD_HASH_PREFIX } from '../../src/utils/passwordHasher';
import { CONTEXT_WORDS, isTooGuessable } from '../../src/utils/passwordPolicy';
import { startFakeSmtp } from '../helpers/fakeSmtp';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';

// Groups 5 and 6 of the OWASP ASVS plan (2026-11-20):
//   passwords -- V6.2.5 any composition, V6.2.9 64+ characters (Thai too),
//                V6.1.2/V6.2.11 context words, V6.3.7 change/reset notice,
//                V11.2.2 old hashes upgraded at sign-in
//   sessions  -- V7.2.4 sign-in ends the browser's previous session, V7.3.1
//                inactivity timeout, V7.4.5 "sign out everywhere" for vendors,
//                V7.5.2 the account's own session list with re-authentication
// Run: npm run check:password-session

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-password-session-check';
if (!/check/i.test(new URL(MONGODB_URI).pathname)) {
  console.error('Refusing to run: this check drops its database, whose name must contain "check".');
  process.exit(2);
}
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;
const HIBP = mockPwnedPasswords();

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const MINUTE = 60_000;
const THAI_64 = 'สวัสดีครับยินดีต้อนรับสู่ระบบจัดซื้อจัดจ้างภาครัฐของประเทศไทยปลอดภัยดีมากเลยนะครับ'.slice(0, 64);

function decode(message: string): string {
  return message.replace(/=\r?\n/g, '').replace(/=([a-f\d]{2})/gi, (_m, byte: string) => String.fromCharCode(Number.parseInt(byte, 16)));
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(mongoose.modelNames().map(name => mongoose.model(name).createIndexes()));

  const server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`;
  const call = async (method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {})
    });
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(`${SESSION_COOKIE_NAME}=`) && c.length > SESSION_COOKIE_NAME.length + 1);
    return { status: res.status, json: (await res.json().catch(() => null)) as any, cookie };
  };
  // Every request here comes from this machine: clear the per-address sign-in and
  // sign-up limits before each one (they are tested in login-session / auth-registration).
  const clearLimits = () => {
    for (const key of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      (loginLimiter as unknown as { resetKey(k: string): void }).resetKey(key);
      (registerLimiter as unknown as { resetKey(k: string): void }).resetKey(key);
    }
  };
  const login = (email: string, password: string, cookie?: string) => {
    clearLimits();
    return call('POST', '/auth/login', { cookie, body: { email, password } });
  };
  const smtp = await startFakeSmtp();

  // =================================================================== passwords
  // V6.2.5 + V6.2.9 at sign-up: any composition, 64 Thai characters, up to 128.
  const signUp = (email: string, password: string, name = 'Napat Wongsa') => {
    clearLimits();
    return call('POST', '/auth/register', { body: { name, email, password, confirmPassword: password, type: 'individual' } });
  };
  const thai = await signUp('thai@example.com', THAI_64);
  const lettersOnly = await signUp('letters@example.com', 'correct horse battery staple');
  const max = await signUp('max@example.com', 'x'.repeat(127) + 'y');
  const tooLong = await signUp('toolong@example.com', 'x'.repeat(129));
  record(thai.status === 201 && Array.from(THAI_64).length === 64 && Buffer.byteLength(THAI_64) > 72, 'V6.2.9: a 64-character Thai password (over 72 bytes) is accepted at sign-up', `${thai.status} ${Buffer.byteLength(THAI_64)} bytes`);
  record(lettersOnly.status === 201, 'V6.2.5: a password with no digit or capital letter is accepted (no composition rules)', JSON.stringify(lettersOnly.json));
  record(max.status === 201 && tooLong.status === 400 && /128/.test(tooLong.json?.error?.fields?.password ?? ''), 'length: 128 characters accepted, 129 refused with a clear message', `${max.status} / ${tooLong.status}`);

  // V6.1.2 + V6.2.11: the documented context words.
  record(CONTEXT_WORDS.includes('b2gvendor') && CONTEXT_WORDS.includes('จัดซื้อจัดจ้าง'), 'V6.1.2: the context-word list includes the product name and the Thai procurement terms');
  const site = await signUp('site@example.com', 'B2G-Vendor-2026');
  const own = await signUp('napat.w@example.com', 'NapatWongsa99');
  const thaiWord = await signUp('word@example.com', 'จัดซื้อจัดจ้าง123');
  record(site.status === 400 && own.status === 400 && thaiWord.status === 400, 'V6.2.11: passwords made mostly of the site name, the person\'s own name, or a procurement term are refused', `${site.status} ${own.status} ${thaiWord.status}`);
  record(/too easy to guess/.test(site.json?.error?.fields?.password ?? ''), 'V6.2.11: the refusal says why, on the password field');
  record(!isTooGuessable('my vendor visits on rainy tuesdays') && isTooGuessable('Vendor2026!!') && !isTooGuessable('Vendor2026!!-and-more-words'), 'V6.2.11: a context word inside a long passphrase is fine; it only refuses when the word is most of the password');

  // V11.2.2: an account still on the old plain-bcrypt hash is upgraded at sign-in.
  const legacyHash = bcrypt.hashSync('Legacy-Password-Ok', 4); // old scheme, and a cost other than BCRYPT_ROUNDS
  const legacy = await Account.create({ email: 'legacy@example.com', passwordHash: 'placeholder-123', name: 'Legacy User', type: 'individual' });
  await Account.collection.updateOne({ _id: legacy._id }, { $set: { passwordHash: legacyHash }, $unset: { passwordChangedAt: 1 } });
  const messagesBefore = smtp.messages.length;
  const legacyLogin = await login('legacy@example.com', 'Legacy-Password-Ok');
  const upgraded = await Account.findById(legacy._id).select('+passwordHash +passwordChangedAt');
  record(legacyLogin.status === 200, 'V11.2.2: an old plain-bcrypt hash still signs in');
  record(!!upgraded?.passwordHash.startsWith(PASSWORD_HASH_PREFIX) && bcrypt.getRounds(upgraded.passwordHash.slice(PASSWORD_HASH_PREFIX.length)) === env.BCRYPT_ROUNDS, `V11.2.2: ...and is replaced at that sign-in by the current scheme at cost ${env.BCRYPT_ROUNDS}`, upgraded?.passwordHash.slice(0, 22));
  record(!upgraded?.passwordChangedAt && smtp.messages.length === messagesBefore, 'V11.2.2: the upgrade is not a password change (no passwordChangedAt, no email)');
  record((await login('legacy@example.com', 'Legacy-Password-Ok')).status === 200 && (await login('legacy@example.com', 'Legacy-Password-No')).status === 401, 'V11.2.2: the upgraded hash keeps working, and still refuses a wrong password');

  // V6.3.7: a notice after a change and after a reset.
  const vendor = await Account.create({ email: 'vendor.one@example.com', passwordHash: 'Plain-Old-Pass-1', name: 'Somsri Jaidee', type: 'individual' });
  const v1 = await login('vendor.one@example.com', 'Plain-Old-Pass-1');
  const beforeChange = smtp.messages.length;
  const change = await call('POST', '/account/change-password', { cookie: v1.cookie, body: { currentPassword: 'Plain-Old-Pass-1', newPassword: 'Second-Fresh-Phrase', confirmNewPassword: 'Second-Fresh-Phrase' } });
  const changeMail = decode(smtp.messages[beforeChange] ?? '');
  record(change.status === 200 && smtp.messages.length === beforeChange + 1 && changeMail.includes('vendor.one@example.com') && /forgot-password/.test(changeMail), 'V6.3.7: changing the password emails the owner a notice with the way to take the account back', String(change.status));
  const guessableChange = await call('POST', '/account/change-password', { cookie: v1.cookie, body: { currentPassword: 'Second-Fresh-Phrase', newPassword: 'Somsri-1234', confirmNewPassword: 'Somsri-1234' } });
  record(guessableChange.status === 400 && /too easy/.test(guessableChange.json?.error?.fields?.newPassword ?? ''), 'V6.2.11: change-password refuses the owner\'s own name too', JSON.stringify(guessableChange.json?.error));
  const resetToken = await issueToken(vendor._id, 'password_reset');
  const beforeReset = smtp.messages.length;
  const reset = await call('POST', '/auth/reset-password', { body: { token: resetToken, newPassword: THAI_64, confirmNewPassword: THAI_64 } });
  record(reset.status === 200 && smtp.messages.length === beforeReset + 1, 'V6.3.7: resetting the password by email link sends the notice too', String(reset.status));
  record((await login('vendor.one@example.com', THAI_64)).status === 200, 'V6.2.9: the 64-character Thai password set by reset signs in');

  // ==================================================================== sessions
  // A clean slate for this account: the password steps above left sessions behind.
  await Session.updateMany({ accountId: vendor._id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  const somsri = await login('vendor.one@example.com', THAI_64);
  // V7.2.4: signing in again from the same browser ends the session it held.
  const again = await login('vendor.one@example.com', THAI_64, somsri.cookie);
  const oldSession = await Session.findOne({ tokenHash: hashSessionToken(somsri.cookie!.split('=')[1]) });
  record(again.status === 200 && again.cookie !== somsri.cookie && !!oldSession?.revokedAt, 'V7.2.4: a new sign-in issues a new token AND revokes the one the browser already had');
  record((await call('GET', '/auth/me', { cookie: somsri.cookie })).status === 401, 'V7.2.4: the old token no longer works');

  // V7.5.2: the account's own session list.
  const phone = await login('vendor.one@example.com', THAI_64);
  const laptop = again;
  const list = await call('GET', '/account/sessions', { cookie: laptop.cookie });
  const views = (list.json?.data ?? []) as { id: string; isCurrent: boolean; browser: string; ipAddress?: string; lastActiveAt: string }[];
  record(list.status === 200 && views.length === 2 && views.filter(v => v.isCurrent).length === 1 && views.every(v => !!v.lastActiveAt), 'V7.5.2: GET /account/sessions lists every live session, marking this one', JSON.stringify(views.map(v => ({ current: v.isCurrent }))));
  record(views.every(v => !v.ipAddress || /\.xx\.xx$|:x+/.test(v.ipAddress)), 'V7.5.2: addresses are shown masked', views.map(v => v.ipAddress).join());
  const phoneId = views.find(v => !v.isCurrent)!.id;
  const wrong = await call('POST', `/account/sessions/${phoneId}/revoke`, { cookie: laptop.cookie, body: { password: 'not-my-password' } });
  record(wrong.status === 401 && (await call('GET', '/auth/me', { cookie: phone.cookie })).status === 200, 'V7.5.2: ending a session with the wrong password is refused, and that session lives on');
  const right = await call('POST', `/account/sessions/${phoneId}/revoke`, { cookie: laptop.cookie, body: { password: THAI_64 } });
  record(right.status === 200 && (await call('GET', '/auth/me', { cookie: phone.cookie })).status === 401 && (await call('GET', '/auth/me', { cookie: laptop.cookie })).status === 200, 'V7.5.2: with the password, that one session ends and this one stays');
  const stranger = await Account.create({ email: 'stranger@example.com', passwordHash: 'Stranger-Pass-77', name: 'Other Person', type: 'individual' });
  const strangerLogin = await login('stranger@example.com', 'Stranger-Pass-77');
  const strangerSession = await Session.findOne({ accountId: stranger._id, revokedAt: { $exists: false } });
  const cross = await call('POST', `/account/sessions/${strangerSession!._id}/revoke`, { cookie: laptop.cookie, body: { password: THAI_64 } });
  record(cross.status === 404 && (await call('GET', '/auth/me', { cookie: strangerLogin.cookie })).status === 200, 'V7.5.2: nobody can end another account\'s session (404)');
  const tablet = await login('vendor.one@example.com', THAI_64);
  const tv = await login('vendor.one@example.com', THAI_64);
  const others = await call('POST', '/account/sessions/revoke-others', { cookie: laptop.cookie, body: { password: THAI_64 } });
  record(others.status === 200 && others.json?.data?.revoked === 2 && (await call('GET', '/auth/me', { cookie: tablet.cookie })).status === 401 && (await call('GET', '/auth/me', { cookie: tv.cookie })).status === 401 && (await call('GET', '/auth/me', { cookie: laptop.cookie })).status === 200, 'V7.5.2: "sign out all other devices" ends the rest and keeps this one', JSON.stringify(others.json?.data));

  // V7.3.1: inactivity timeout -- 30 min for staff, 24 h for vendors.
  const admin = await Account.create({ email: 'admin@example.com', passwordHash: 'Admin-Strong-Pass', name: 'Staff Member', role: 'superadmin' });
  const adminLogin = await login('admin@example.com', 'Admin-Strong-Pass');
  const adminSession = await Session.findOne({ accountId: admin._id, revokedAt: { $exists: false } });
  const ago = (ms: number) => new Date(Date.now() - ms);
  await Session.updateOne({ _id: adminSession!._id }, { lastActiveAt: ago(env.SESSION_IDLE_MINUTES_STAFF * MINUTE - MINUTE) });
  record((await call('GET', '/auth/me', { cookie: adminLogin.cookie })).status === 200, `V7.3.1: a staff session idle for just under ${env.SESSION_IDLE_MINUTES_STAFF} minutes still works (and the request counts as activity)`);
  await Session.updateOne({ _id: adminSession!._id }, { lastActiveAt: ago(env.SESSION_IDLE_MINUTES_STAFF * MINUTE + MINUTE) });
  const expired = await call('GET', '/auth/me', { cookie: adminLogin.cookie });
  record(expired.status === 401 && expired.json?.error?.message === IDLE_TIMEOUT_MESSAGE, `V7.3.1: idle for over ${env.SESSION_IDLE_MINUTES_STAFF} minutes, a staff session is refused with "ended after a period of inactivity"`, JSON.stringify(expired.json?.error));
  record(!!(await Session.findById(adminSession!._id))?.revokedAt, 'V7.3.1: ...and revoked on the server, so the token is dead for good');
  await Session.updateOne({ _id: (await Session.findOne({ tokenHash: hashSessionToken(laptop.cookie!.split('=')[1]) }))!._id }, { lastActiveAt: ago(2 * 60 * MINUTE) });
  record((await call('GET', '/auth/me', { cookie: laptop.cookie })).status === 200, 'V7.3.1: a vendor session idle for 2 hours still works (vendors: 24 hours)');
  await Session.updateOne({ tokenHash: hashSessionToken(laptop.cookie!.split('=')[1]) }, { lastActiveAt: ago(env.SESSION_IDLE_MINUTES_VENDOR * MINUTE + MINUTE) });
  record((await call('GET', '/auth/me', { cookie: laptop.cookie })).status === 401, `V7.3.1: idle for over ${env.SESSION_IDLE_MINUTES_VENDOR / 60} hours, a vendor session ends too`);

  // The admin screens' background "is a poll running?" check does not count as activity.
  const busyAdmin = await login('admin@example.com', 'Admin-Strong-Pass');
  const busyId = (await Session.findOne({ tokenHash: hashSessionToken(busyAdmin.cookie!.split('=')[1]) }))!._id;
  const tenMinutesAgo = ago(10 * MINUTE);
  await Session.updateOne({ _id: busyId }, { lastActiveAt: tenMinutesAgo });
  const status = await call('GET', '/admin/ingestion/status', { cookie: busyAdmin.cookie });
  const afterBackground = (await Session.findById(busyId))!.lastActiveAt.getTime();
  await call('GET', '/admin/dashboard', { cookie: busyAdmin.cookie });
  const afterReal = (await Session.findById(busyId))!.lastActiveAt.getTime();
  record(status.status === 200 && afterBackground === tenMinutesAgo.getTime() && afterReal > tenMinutesAgo.getTime() + 9 * MINUTE, 'V7.3.1: the background poll-status check is answered but does not keep the session alive; a real page request does', `${status.status}`);

  // V7.4.5: an Admin signs a VENDOR out everywhere.
  const target = await Account.create({ email: 'target@example.com', passwordHash: 'Target-Pass-2026', name: 'Target Vendor', type: 'individual' });
  const t1 = await login('target@example.com', 'Target-Pass-2026');
  const t2 = await login('target@example.com', 'Target-Pass-2026');
  const byVendor = await call('POST', `/admin/accounts/${target._id}/sign-out`, { cookie: strangerLogin.cookie });
  record(byVendor.status === 403, 'V7.4.5: a vendor cannot use the admin "sign out everywhere"', String(byVendor.status));
  const byAdmin = await call('POST', `/admin/accounts/${target._id}/sign-out`, { cookie: busyAdmin.cookie });
  record(byAdmin.status === 200 && byAdmin.json?.data?.revoked === 2 && (await call('GET', '/auth/me', { cookie: t1.cookie })).status === 401 && (await call('GET', '/auth/me', { cookie: t2.cookie })).status === 401, 'V7.4.5: an Admin ends every session of a vendor account', JSON.stringify(byAdmin.json?.data));
  record(!!(await AuditLog.findOne({ action: 'account.sign_out_all', entityId: String(target._id) })), 'V7.4.5: the action is in the audit log');
  record((await login('target@example.com', 'Target-Pass-2026')).status === 200, 'V7.4.5: the vendor can simply sign in again (not suspended)');

  server.close();
  await smtp.close();
  HIBP.restore();
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
