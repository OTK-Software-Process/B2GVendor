import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { Follow } from '../../src/models/follow.model';
import { Notification } from '../../src/models/notification.model';
import { Session } from '../../src/models/session.model';
import { Tag } from '../../src/models/tag.model';
import { Token } from '../../src/models/token.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-accounts-check';

// Backend/.env may hold REAL SMTP credentials. This check must never send mail:
// force "not configured" (send() then only logs) and capture what would have
// been sent.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const PASSWORD = 'Password123';
const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// Would-be emails, captured from the logger instead of being sent.
const capturedLogs: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  capturedLogs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
};
function lastResetToken(): string | null {
  for (let i = capturedLogs.length - 1; i >= 0; i--) {
    const m = capturedLogs[i].match(/reset-password\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
  }
  return null;
}

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

  async function call(method: string, path: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
  }
  async function makeAccount(email: string, role: AccountRole, extra: Record<string, unknown> = {}) {
    return Account.create({ email, passwordHash: PASSWORD, name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  }
  async function tryLogin(email: string, password = PASSWORD) {
    const res = await call('POST', '/auth/login', undefined, { email, password });
    const first = res.setCookie?.split(';')[0] ?? '';
    return { res, cookie: first.startsWith(`${SESSION_COOKIE_NAME}=`) ? first : '' };
  }
  async function loginCookie(email: string): Promise<string> {
    const { cookie, res } = await tryLogin(email);
    if (!cookie) throw new Error(`login failed for ${email}: ${res.status}`);
    return cookie;
  }

  // ------------------------------------------------------------------ fixtures
  const adminAcc = await makeAccount('admin@example.com', 'admin');
  await makeAccount('super@example.com', 'superadmin');
  const v1 = await makeAccount('somchai@example.com', 'user', { name: 'Somchai', phone: '0812345678' });
  const v2 = await makeAccount('wipa@example.com', 'user', {
    name: 'Wipa',
    type: 'business',
    businessProfile: { companyName: 'Bangkok Build Co', taxId: '0105558123456' }
  });
  const v3 = await makeAccount('kamon@example.com', 'user', { name: 'Kamon', status: 'suspended' });
  const adminCookie = await loginCookie('admin@example.com');
  const superCookie = await loginCookie('super@example.com');
  const v1Cookie = await loginCookie('somchai@example.com');

  const tag1 = await Tag.create({ name: 'T1', facet: 'keyword' });
  const tag2 = await Tag.create({ name: 'T2', facet: 'keyword' });
  await Follow.create([{ accountId: v1._id, tagId: tag1._id }, { accountId: v1._id, tagId: tag2._id }, { accountId: v2._id, tagId: tag1._id }]);
  const v1Id = v1._id.toString();
  const v2Id = v2._id.toString();
  const v3Id = v3._id.toString();
  const adminId = adminAcc._id.toString();

  // ------------------------------------------------------------------ access
  const endpoints: [string, string, unknown?][] = [
    ['GET', '/admin/accounts'],
    ['GET', `/admin/accounts/${v1Id}`],
    ['POST', '/admin/accounts', { name: 'X', email: 'x@example.com' }],
    ['PATCH', `/admin/accounts/${v1Id}`, { name: 'Y' }],
    ['PATCH', `/admin/accounts/${v1Id}/suspend`],
    ['PATCH', `/admin/accounts/${v1Id}/reactivate`],
    ['POST', `/admin/accounts/${v1Id}/password-link`],
    ['DELETE', `/admin/accounts/${v1Id}`]
  ];
  let anonOk = true;
  let vendorOk = true;
  for (const [method, path, body] of endpoints) {
    if ((await call(method, path, undefined, body)).status !== 401) anonOk = false;
    if ((await call(method, path, v1Cookie, body)).status !== 403) vendorOk = false;
  }
  record(anonOk, 'every vendor-account endpoint returns 401 to a visitor');
  record(vendorOk, 'every vendor-account endpoint returns 403 to a vendor (a vendor cannot manage accounts)');
  record((await Account.countDocuments({ role: 'user' })) === 3, 'the rejected calls changed nothing');

  // ------------------------------------------------------------------- list
  const all = await call('GET', '/admin/accounts', adminCookie);
  record(all.status === 200 && all.json.data.total === 3, 'admin lists vendors only (3), not staff', String(all.json?.data?.total));
  record(!all.json.data.items.some((a: any) => a.email === 'admin@example.com' || a.email === 'super@example.com'), 'staff accounts never appear in the vendor list');
  record((await call('GET', '/admin/accounts', superCookie)).status === 200, 'super admin can list too');
  const leaks = ['passwordHash', 'lockedUntil', 'tokenHash'].filter(s => all.text.includes(s));
  record(leaks.length === 0, 'the response never includes password hashes or lock data', leaks.join(','));
  const somchai = all.json.data.items.find((a: any) => a.email === 'somchai@example.com');
  record(somchai?.followedTagsCount === 2 && somchai?.lastActiveAt, 'items include followed-tag count and last-active time', JSON.stringify({ f: somchai?.followedTagsCount, l: !!somchai?.lastActiveAt }));
  record(all.json.data.items.find((a: any) => a.email === 'wipa@example.com')?.lastActiveAt === null, 'a vendor who never signed in has lastActiveAt = null');
  record(JSON.stringify(all.json.data.summary) === JSON.stringify({ total: 3, active: 2, suspended: 1 }), 'summary counts active/suspended', JSON.stringify(all.json.data.summary));
  const q = (s: string) => call('GET', `/admin/accounts?q=${encodeURIComponent(s)}`, adminCookie).then(r => r.json.data.items.map((a: any) => a.email).join());
  record((await q('somchai')) === 'somchai@example.com', 'search by name');
  record((await q('WIPA@')) === 'wipa@example.com', 'search by email (case-insensitive)');
  record((await q('bangkok build')) === 'wipa@example.com', 'search by company name');
  record((await q('0105558')) === 'wipa@example.com', 'search by tax id');
  record((await call('GET', '/admin/accounts?q=(', adminCookie)).status === 200, 'regex characters in the search do not break it');
  const suspendedOnly = await call('GET', '/admin/accounts?status=suspended', adminCookie);
  record(suspendedOnly.json.data.items.map((a: any) => a.email).join() === 'kamon@example.com', 'filter by status');
  record(JSON.stringify(suspendedOnly.json.data.summary) === JSON.stringify({ total: 3, active: 2, suspended: 1 }), 'summary stays unfiltered when a filter is applied');
  record((await call('GET', '/admin/accounts?type=business', adminCookie)).json.data.total === 1, 'filter by account type');
  record((await call('GET', '/admin/accounts?sort=name', adminCookie)).json.data.items.map((a: any) => a.name).join() === 'Kamon,Somchai,Wipa', 'sort by name');
  const p2 = await call('GET', '/admin/accounts?pageSize=2&page=2', adminCookie);
  record(p2.json.data.items.length === 1 && p2.json.data.total === 3, 'pagination works');
  record((await call('GET', '/admin/accounts?pageSize=500', adminCookie)).status === 400, 'page size is capped');
  record((await call('GET', '/admin/accounts?role=admin', adminCookie)).status === 400, 'a role filter is not accepted (strict query)');

  // ------------------------------------------------------------------ detail
  const detail = await call('GET', `/admin/accounts/${v2Id}`, adminCookie);
  record(detail.status === 200 && detail.json.data.businessProfile?.taxId === '0105558123456', 'detail returns the business profile');
  record((await call('GET', `/admin/accounts/${adminId}`, adminCookie)).status === 404, 'an ADMIN account id is "not found" through the vendor API');
  record((await call('GET', '/admin/accounts/000000000000000000000000', adminCookie)).status === 404, 'unknown id -> 404');
  record((await call('GET', '/admin/accounts/not-an-id', adminCookie)).status === 404, 'malformed id -> 404');

  // ------------------------------------------------------------------ create
  capturedLogs.length = 0;
  const created = await call('POST', '/admin/accounts', adminCookie, { name: 'Napat', email: '  NAPAT@Example.com ', phone: '0899999999' });
  record(created.status === 201 && created.json.data.vendor.email === 'napat@example.com', 'admin creates an individual vendor (email normalised)', String(created.status));
  const napatId: string = created.json.data.vendor.id;
  const napatDb = await Account.findById(napatId).select('+passwordHash');
  record(napatDb?.role === 'user' && napatDb.status === 'active' && napatDb.type === 'individual', 'the new account is an active vendor');
  record(napatDb!.passwordHash !== undefined && !(await napatDb!.comparePassword(PASSWORD)), 'the admin sets no password: it is random and unknown');
  record(created.json.data.setupEmail.sent === false && created.json.data.setupEmail.reason === 'smtp_not_configured', 'the response says honestly that no email was sent (mail not configured)', JSON.stringify(created.json.data.setupEmail));
  record(!created.text.includes('passwordHash'), 'the create response leaks no password data');
  const token1 = lastResetToken();
  record(!!token1 && (await Token.countDocuments({ accountId: napatId, purpose: 'password_reset' })) === 1, 'a set-password link was issued for the vendor');
  record((await tryLogin('napat@example.com', 'anything123')).res.status === 401, 'the vendor cannot log in before setting a password');
  const setPw = await call('POST', '/auth/reset-password', undefined, { token: token1, newPassword: 'BrandNew123', confirmNewPassword: 'BrandNew123' });
  record(setPw.status === 200, 'the vendor sets their own password through the emailed link', String(setPw.status));
  record((await tryLogin('napat@example.com', 'BrandNew123')).cookie !== '', '...and can then sign in');
  record((await call('POST', '/auth/reset-password', undefined, { token: token1, newPassword: 'Another123', confirmNewPassword: 'Another123' })).status === 400, 'the link is single-use');

  const biz = await call('POST', '/admin/accounts', adminCookie, {
    name: 'Prayut',
    email: 'prayut@example.com',
    type: 'business',
    businessProfile: { companyName: 'Thong IT LP', taxId: '0105561987654' }
  });
  record(biz.status === 201 && biz.json.data.vendor.type === 'business' && biz.json.data.vendor.businessProfile.companyName === 'Thong IT LP', 'admin creates a business vendor');

  const dup = await call('POST', '/admin/accounts', adminCookie, { name: 'Dup', email: 'SOMCHAI@example.com' });
  record(dup.status === 409 && dup.json.error.code === 'EMAIL_ALREADY_REGISTERED', 'a duplicate email (any case) is rejected with 409', String(dup.status));
  const before = await Account.countDocuments({});
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Bad', email: 'not-an-email' })).status === 400, 'invalid email is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Bad', email: 'b1@example.com', type: 'business' })).status === 400, 'a business account without a profile is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Bad', email: 'b2@example.com', businessProfile: { companyName: 'X', taxId: '1' } })).status === 400, 'an individual with a business profile is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Bad', email: 'b3@example.com', type: 'business', businessProfile: { companyName: 'X', taxId: '123' } })).status === 400, 'a bad tax id is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'B4d 1', email: 'b4@example.com' })).status === 400, 'a name with digits is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Bad', email: 'b5@example.com', phone: '123' })).status === 400, 'a bad phone number is rejected');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Evil', email: 'b6@example.com', role: 'superadmin' })).status === 400, 'a role field is rejected: this API cannot create staff');
  record((await call('POST', '/admin/accounts', adminCookie, { name: 'Evil', email: 'b7@example.com', password: 'Password123' })).status === 400, 'a password field is rejected: admins never set vendor passwords');
  record((await Account.countDocuments({})) === before, 'none of the invalid requests created an account');

  // ------------------------------------------------------------------ update
  const upd = await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { name: 'Somchai Jaidee', phone: '0800000000' });
  record(upd.status === 200 && upd.json.data.name === 'Somchai Jaidee' && upd.json.data.phone === '0800000000', 'admin edits name and phone');
  const clr = await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { phone: null });
  record(clr.status === 200 && clr.json.data.phone === undefined && (await Account.findById(v1Id))!.phone === undefined, 'phone: null clears the phone number');
  const bizUpd = await call('PATCH', `/admin/accounts/${v2Id}`, adminCookie, { businessProfile: { companyName: 'Bangkok Build PLC', taxId: '0105558123456' } });
  record(bizUpd.status === 200 && bizUpd.json.data.businessProfile.companyName === 'Bangkok Build PLC', 'admin edits a business profile');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { businessProfile: { companyName: 'X', taxId: '0105558123456' } })).status === 400, 'an individual cannot be given a business profile');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { email: 'new@example.com' })).status === 400, 'email cannot be changed (identity)');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { type: 'business' })).status === 400, 'account type cannot be changed');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { role: 'admin' })).status === 400, 'role cannot be changed (no privilege escalation)');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, { status: 'suspended' })).status === 400, 'status changes only through suspend/reactivate');
  record((await call('PATCH', `/admin/accounts/${v1Id}`, adminCookie, {})).status === 400, 'an empty update is rejected');
  record((await call('PATCH', `/admin/accounts/${adminId}`, adminCookie, { name: 'Hacked' })).status === 404, 'staff cannot be edited through the vendor API');
  record((await Account.findById(adminId))!.name === 'Name admin', '...and the staff record is untouched');

  // ---------------------------------------------------------- suspend / reactivate
  record((await call('GET', '/auth/me', v1Cookie)).status === 200, 'baseline: the vendor\'s session works');
  const sus = await call('PATCH', `/admin/accounts/${v1Id}/suspend`, adminCookie);
  record(sus.status === 200 && sus.json.data.status === 'suspended', 'admin suspends a vendor');
  const meAfter = await call('GET', '/auth/me', v1Cookie);
  record(meAfter.status === 401 || meAfter.status === 403, 'the vendor\'s existing session stops working immediately', String(meAfter.status));
  record((await Session.countDocuments({ accountId: v1Id, revokedAt: { $exists: false } })) === 0, 'all of the vendor\'s sessions are revoked');
  const susLogin = await tryLogin('somchai@example.com');
  record(susLogin.res.status === 403 && susLogin.res.json?.error?.code === 'ACCOUNT_SUSPENDED', 'a suspended vendor cannot sign in', String(susLogin.res.status));
  record((await call('PATCH', `/admin/accounts/${v1Id}/suspend`, adminCookie)).status === 200, 'suspending twice is harmless (idempotent)');
  const pwSus = await call('POST', `/admin/accounts/${v1Id}/password-link`, adminCookie);
  record(pwSus.status === 400, 'no password link can be sent to a suspended account', String(pwSus.status));
  const react = await call('PATCH', `/admin/accounts/${v1Id}/reactivate`, adminCookie);
  record(react.status === 200 && react.json.data.status === 'active', 'admin reactivates the vendor');
  record((await tryLogin('somchai@example.com')).cookie !== '', '...and the vendor can sign in again');
  record((await call('GET', '/auth/me', v1Cookie)).status === 401, 'the OLD session stays dead after reactivation (no resurrection)');
  record((await call('PATCH', `/admin/accounts/${v1Id}/reactivate`, adminCookie)).status === 200, 'reactivating twice is harmless');
  record((await call('PATCH', `/admin/accounts/${adminId}/suspend`, adminCookie)).status === 404 && (await Account.findById(adminId))!.status === 'active', 'an admin cannot be suspended through the vendor API');

  // ------------------------------------------------------------- password link
  capturedLogs.length = 0;
  const link = await call('POST', `/admin/accounts/${v2Id}/password-link`, adminCookie);
  record(link.status === 200 && link.json.data.sent === false && link.json.data.reason === 'smtp_not_configured', 'sending a password link reports that mail is not configured', JSON.stringify(link.json?.data));
  record(!!lastResetToken(), 'a fresh reset link was still issued (visible in the log for local development)');
  const linkOnce = await Token.countDocuments({ accountId: v2Id, purpose: 'password_reset' });
  await call('POST', `/admin/accounts/${v2Id}/password-link`, adminCookie);
  record(linkOnce === 1 && (await Token.countDocuments({ accountId: v2Id, purpose: 'password_reset' })) === 1, 'a new link replaces the previous one');

  // ------------------------------------------------------------------ delete
  await loginCookie('kamon@example.com').catch(() => null); // suspended: no session, expected
  await Notification.create({
    accountId: v2._id, workId: new mongoose.Types.ObjectId(), workTitle: 't', agencyName: 'a', method: 'B0', status: 'BIDDING',
    statusLabel: 'BIDDING', matchedTags: [], ingestedDate: new Date()
  });
  const v2Cookie = await loginCookie('wipa@example.com');
  record((await call('GET', '/auth/me', v2Cookie)).status === 200, 'baseline: about to delete a vendor with sessions, follows and notifications');
  const v1Follows = await Follow.countDocuments({ accountId: v1Id });
  const del = await call('DELETE', `/admin/accounts/${v2Id}`, adminCookie);
  record(del.status === 200 && del.json.data.email === 'wipa@example.com', 'admin deletes a vendor');
  record((await Account.findById(v2Id)) === null, 'the account is gone');
  const orphans = {
    sessions: await Session.countDocuments({ accountId: v2Id }),
    follows: await Follow.countDocuments({ accountId: v2Id }),
    notifications: await Notification.countDocuments({ accountId: v2Id }),
    tokens: await Token.countDocuments({ accountId: v2Id })
  };
  record(Object.values(orphans).every(n => n === 0), 'sessions, follows, notifications and reset tokens are removed with it', JSON.stringify(orphans));
  record((await Follow.countDocuments({ accountId: v1Id })) === v1Follows && v1Follows === 2, 'other vendors\' data is untouched');
  record((await call('GET', '/auth/me', v2Cookie)).status === 401, 'the deleted vendor\'s old session no longer works');
  record((await tryLogin('wipa@example.com')).res.status === 401, 'the deleted vendor cannot sign in');
  record((await call('GET', `/admin/accounts/${v2Id}`, adminCookie)).status === 404, 'a deleted vendor is 404');
  record((await call('DELETE', `/admin/accounts/${v2Id}`, adminCookie)).status === 404, 'deleting twice -> 404');
  record((await call('DELETE', `/admin/accounts/${adminId}`, adminCookie)).status === 404 && (await Account.findById(adminId)) !== null, 'an admin cannot be deleted through the vendor API');
  record((await call('DELETE', `/admin/accounts/${v3Id}`, superCookie)).status === 200, 'super admin can delete vendors too');
  record((await call('GET', '/admin/accounts', adminCookie)).json.data.summary.total === 3, 'the list summary reflects the deletions (v1, napat, prayut remain)');

  // ------------------------------------------------------ mail failure is not fatal
  (env as { SMTP_HOST?: string; SMTP_PORT?: number }).SMTP_HOST = '127.0.0.1';
  (env as { SMTP_HOST?: string; SMTP_PORT?: number }).SMTP_PORT = 1; // nothing listens here: connection refused
  const failMail = await call('POST', '/admin/accounts', adminCookie, { name: 'Mailfail', email: 'mailfail@example.com' });
  record(
    failMail.status === 201 && failMail.json.data.setupEmail.sent === false && failMail.json.data.setupEmail.reason === 'send_failed',
    'if the mail server is unreachable the account is STILL created and the response says the email failed',
    JSON.stringify(failMail.json?.data?.setupEmail)
  );
  record((await Account.findOne({ email: 'mailfail@example.com' })) !== null, '...and the account exists');

  console.warn = realWarn;
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.warn = realWarn;
  console.error('check failed to run', err);
  process.exit(2);
});
