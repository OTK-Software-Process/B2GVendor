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
import { createSession } from '../../src/services/session.service';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-staff-check';

// Backend/.env may hold REAL SMTP credentials. This check must never send mail:
// force "not configured" (send() then only logs) and capture what would have
// been sent.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const PASSWORD = 'Password123';
const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

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
  // Fixture sessions are minted directly: the real login endpoint is rate
  // limited (10 / 15 min / IP) -- a control worth keeping -- so the HTTP login
  // is reserved for the checks that are actually ABOUT logging in.
  async function loginCookie(email: string): Promise<string> {
    const account = await Account.findOne({ email });
    if (!account) throw new Error(`no account ${email}`);
    const { rawToken } = await createSession(account._id, {});
    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  // ------------------------------------------------------------------ fixtures
  const superAcc = await makeAccount('super@example.com', 'superadmin');
  const super2 = await makeAccount('super2@example.com', 'superadmin');
  const adminA = await makeAccount('admin-a@example.com', 'admin', { name: 'Aroon', phone: '0811111111' });
  const adminB = await makeAccount('admin-b@example.com', 'admin', { name: 'Bancha' });
  const adminC = await makeAccount('admin-c@example.com', 'admin', { name: 'Chai', status: 'suspended' });
  const vendor = await makeAccount('vendor@example.com', 'user', { name: 'Vendor' });
  const superCookie = await loginCookie('super@example.com');
  const adminACookie = await loginCookie('admin-a@example.com');
  const vendorCookie = await loginCookie('vendor@example.com');
  const superId = superAcc._id.toString();
  const super2Id = super2._id.toString();
  const aId = adminA._id.toString();
  const bId = adminB._id.toString();
  const cId = adminC._id.toString();
  const vendorId = vendor._id.toString();

  // ------------------------------------------------------------------ access
  const endpoints: [string, string, unknown?][] = [
    ['GET', '/admin/staff'],
    ['GET', `/admin/staff/${aId}`],
    ['POST', '/admin/staff', { name: 'X', email: 'x@example.com' }],
    ['PATCH', `/admin/staff/${aId}`, { name: 'Y' }],
    ['PATCH', `/admin/staff/${aId}/suspend`],
    ['PATCH', `/admin/staff/${aId}/reactivate`],
    ['POST', `/admin/staff/${aId}/sign-out`],
    ['POST', `/admin/staff/${aId}/password-link`],
    ['DELETE', `/admin/staff/${aId}`]
  ];
  let anonOk = true;
  let vendorOk = true;
  let adminOk = true;
  for (const [method, path, body] of endpoints) {
    if ((await call(method, path, undefined, body)).status !== 401) anonOk = false;
    if ((await call(method, path, vendorCookie, body)).status !== 403) vendorOk = false;
    if ((await call(method, path, adminACookie, body)).status !== 403) adminOk = false;
  }
  record(anonOk, 'every staff endpoint returns 401 to a visitor');
  record(vendorOk, 'every staff endpoint returns 403 to a vendor');
  record(adminOk, 'every staff endpoint returns 403 to a regular ADMIN (only a Super Admin manages admins)');
  record((await Account.countDocuments({ role: 'admin' })) === 3 && (await Account.findById(aId))!.name === 'Aroon', 'the rejected calls changed nothing');
  record((await call('GET', '/admin/accounts', adminACookie)).status === 200, 'a regular admin can still use the VENDOR API (the split is by resource, not blanket)');

  // -------------------------------------------------------------------- list
  const all = await call('GET', '/admin/staff', superCookie);
  record(all.status === 200 && all.json.data.total === 5, 'super admin lists all staff (2 super + 3 admin)', String(all.json?.data?.total));
  record(!all.json.data.items.some((a: any) => a.email === 'vendor@example.com'), 'vendors never appear in the staff list');
  const leaks = ['passwordHash', 'lockedUntil', 'tokenHash'].filter(s => all.text.includes(s));
  record(leaks.length === 0, 'the response never includes password hashes or lock data', leaks.join(','));
  const sup = all.json.data.items.find((a: any) => a.email === 'super2@example.com');
  const adm = all.json.data.items.find((a: any) => a.email === 'admin-a@example.com');
  record(sup?.manageable === false && adm?.manageable === true, 'Super Admins are flagged read-only (manageable:false), Admins manageable');
  record(adm?.activeSessions === 1 && adm?.lastActiveAt, 'an admin with a live session shows activeSessions=1 and a last-active time', JSON.stringify({ s: adm?.activeSessions, l: !!adm?.lastActiveAt }));
  record(all.json.data.items.find((a: any) => a.email === 'admin-b@example.com')?.activeSessions === 0, 'an admin who never signed in shows activeSessions=0');
  record(JSON.stringify(all.json.data.summary) === JSON.stringify({ total: 5, admins: 3, superadmins: 2, suspended: 1 }), 'summary counts admins, super admins and suspended', JSON.stringify(all.json.data.summary));
  const q = (s: string) => call('GET', `/admin/staff?q=${encodeURIComponent(s)}`, superCookie).then(r => r.json.data.items.map((a: any) => a.email).join());
  record((await q('aroon')) === 'admin-a@example.com', 'search by name');
  record((await q('ADMIN-B@')) === 'admin-b@example.com', 'search by email (case-insensitive)');
  record((await call('GET', '/admin/staff?q=(', superCookie)).status === 200, 'regex characters in the search do not break it');
  record((await call('GET', '/admin/staff?role=superadmin', superCookie)).json.data.total === 2, 'filter by role');
  record((await call('GET', '/admin/staff?status=suspended', superCookie)).json.data.items.map((a: any) => a.email).join() === 'admin-c@example.com', 'filter by status');
  record((await call('GET', '/admin/staff?role=user', superCookie)).status === 400, 'a vendor role filter is rejected');
  record((await call('GET', '/admin/staff?sort=name', superCookie)).json.data.items[0].name === 'Aroon', 'sort by name');
  record((await call('GET', '/admin/staff?pageSize=2&page=3', superCookie)).json.data.items.length === 1, 'pagination works');
  record((await call('GET', '/admin/staff?pageSize=500', superCookie)).status === 400, 'page size is capped');

  // ------------------------------------------------------------------ detail
  record((await call('GET', `/admin/staff/${aId}`, superCookie)).json.data.email === 'admin-a@example.com', 'detail of an admin');
  record((await call('GET', `/admin/staff/${super2Id}`, superCookie)).status === 200, 'detail of a super admin is readable');
  record((await call('GET', `/admin/staff/${vendorId}`, superCookie)).status === 404, 'a VENDOR id is "not found" through the staff API');
  record((await call('GET', '/admin/staff/not-an-id', superCookie)).status === 404, 'malformed id -> 404');

  // ------------------------------------------------------------------ create
  capturedLogs.length = 0;
  const created = await call('POST', '/admin/staff', superCookie, { name: 'Napat', email: '  NEW.ADMIN@Example.com ', phone: '0899999999' });
  record(created.status === 201 && created.json.data.admin.email === 'new.admin@example.com', 'super admin creates an admin (email normalised)', String(created.status));
  const newId: string = created.json.data.admin.id;
  const newDb = await Account.findById(newId).select('+passwordHash');
  record(newDb?.role === 'admin' && newDb.status === 'active' && newDb.type === 'individual', 'the new account has role "admin" (never higher)');
  record(!(await newDb!.comparePassword(PASSWORD)), 'nobody sets the password: it is random and unknown');
  record(created.json.data.setupEmail.sent === false && created.json.data.setupEmail.reason === 'smtp_not_configured', 'the response says honestly that no email was sent', JSON.stringify(created.json.data.setupEmail));
  record(!created.text.includes('passwordHash'), 'the create response leaks no password data');
  const token1 = lastResetToken();
  record(!!token1, 'a set-password link was issued');
  record((await tryLogin('new.admin@example.com', 'guess12345')).res.status === 401, 'the new admin cannot sign in before setting a password');
  const setPw = await call('POST', '/auth/reset-password', undefined, { token: token1, newPassword: 'BrandNew123', confirmNewPassword: 'BrandNew123' });
  record(setPw.status === 200, 'the new admin sets their own password through the emailed link');
  const newCookie = (await tryLogin('new.admin@example.com', 'BrandNew123')).cookie;
  record(newCookie !== '', '...and can sign in');
  record((await call('GET', '/admin/dashboard', newCookie)).status === 200, '...and has admin access');
  record((await call('GET', '/admin/staff', newCookie)).status === 403, '...but NOT staff-management access (that is Super Admin only)');
  record((await call('GET', '/admin/gov-sites', newCookie)).status !== 500, 'sanity: normal admin routes still work for the new admin');

  const dup = await call('POST', '/admin/staff', superCookie, { name: 'Dup', email: 'ADMIN-A@example.com' });
  record(dup.status === 409 && dup.json.error.code === 'EMAIL_ALREADY_REGISTERED', 'a duplicate email (any case) is rejected with 409');
  const dupVendor = await call('POST', '/admin/staff', superCookie, { name: 'Dup', email: 'vendor@example.com' });
  record(dupVendor.status === 409, 'an email already used by a VENDOR is rejected too (no silent promotion)');
  const before = await Account.countDocuments({});
  record((await call('POST', '/admin/staff', superCookie, { name: 'Bad', email: 'nope' })).status === 400, 'invalid email is rejected');
  record((await call('POST', '/admin/staff', superCookie, { name: 'B4d 1', email: 'b1@example.com' })).status === 400, 'a name with digits is rejected');
  record((await call('POST', '/admin/staff', superCookie, { name: 'Bad', email: 'b2@example.com', phone: '1' })).status === 400, 'a bad phone number is rejected');
  record((await call('POST', '/admin/staff', superCookie, { name: 'Evil', email: 'b3@example.com', role: 'superadmin' })).status === 400, 'a role field is rejected: no way to create a Super Admin');
  record((await call('POST', '/admin/staff', superCookie, { name: 'Evil', email: 'b4@example.com', password: 'Password123' })).status === 400, 'a password field is rejected');
  record((await call('POST', '/admin/staff', superCookie, { name: 'Evil', email: 'b5@example.com', type: 'business' })).status === 400, 'other fields are rejected (strict body)');
  record((await Account.countDocuments({})) === before, 'none of the invalid requests created an account');

  // ------------------------------------------------------------------ update
  const upd = await call('PATCH', `/admin/staff/${aId}`, superCookie, { name: 'Aroon Suksan', phone: '0822222222' });
  record(upd.status === 200 && upd.json.data.name === 'Aroon Suksan' && upd.json.data.phone === '0822222222', 'super admin edits an admin\'s name and phone');
  const clr = await call('PATCH', `/admin/staff/${aId}`, superCookie, { phone: null });
  record(clr.status === 200 && (await Account.findById(aId))!.phone === undefined, 'phone: null clears the phone number');
  record((await call('PATCH', `/admin/staff/${aId}`, superCookie, { email: 'x@example.com' })).status === 400, 'email cannot be changed');
  record((await call('PATCH', `/admin/staff/${aId}`, superCookie, { role: 'superadmin' })).status === 400, 'role cannot be changed: no promotion to Super Admin');
  record((await call('PATCH', `/admin/staff/${aId}`, superCookie, { status: 'suspended' })).status === 400, 'status changes only through suspend/reactivate');
  record((await call('PATCH', `/admin/staff/${aId}`, superCookie, {})).status === 400, 'an empty update is rejected');
  record((await Account.findById(aId))!.role === 'admin', 'the admin is still an admin');

  // ------------------------------------------------ Super Admins are read-only
  const frozen: [string, string, unknown?][] = [
    ['PATCH', `/admin/staff/${super2Id}`, { name: 'Hacked' }],
    ['PATCH', `/admin/staff/${super2Id}/suspend`],
    ['PATCH', `/admin/staff/${super2Id}/reactivate`],
    ['POST', `/admin/staff/${super2Id}/sign-out`],
    ['POST', `/admin/staff/${super2Id}/password-link`],
    ['DELETE', `/admin/staff/${super2Id}`]
  ];
  let frozenOk = true;
  for (const [method, path, body] of frozen) if ((await call(method, path, superCookie, body)).status !== 403) frozenOk = false;
  record(frozenOk, 'every change to a SUPER ADMIN is refused with 403');
  const super2Db = await Account.findById(super2Id);
  record(super2Db !== null && super2Db.status === 'active' && super2Db.name === 'Name super2', '...and the Super Admin account is untouched');
  record((await call('DELETE', `/admin/staff/${superId}`, superCookie)).status === 403 && (await Account.findById(superId)) !== null, 'a Super Admin cannot delete THEMSELVES (or anyone at their level)');
  record((await call('PATCH', `/admin/staff/${superId}/suspend`, superCookie)).status === 403 && (await call('GET', '/auth/me', superCookie)).status === 200, 'a Super Admin cannot suspend themselves, so they cannot lock everyone out');
  record((await Account.countDocuments({ role: 'superadmin' })) === 2, 'there are still 2 Super Admins after all of that');
  for (const [method, path] of [['PATCH', `/admin/staff/${vendorId}`], ['PATCH', `/admin/staff/${vendorId}/suspend`], ['DELETE', `/admin/staff/${vendorId}`]] as const) {
    if ((await call(method, path, superCookie, method === 'PATCH' && !path.endsWith('suspend') ? { name: 'Z' } : undefined)).status !== 404) record(false, `staff API refuses vendor id: ${method} ${path}`);
  }
  record((await Account.findById(vendorId))!.status === 'active', 'the staff API cannot touch a vendor account');

  // ---------------------------------------------------------- suspend / reactivate
  record((await call('GET', '/admin/dashboard', adminACookie)).status === 200, 'baseline: admin A\'s session works');
  const sus = await call('PATCH', `/admin/staff/${aId}/suspend`, superCookie);
  record(sus.status === 200 && sus.json.data.status === 'suspended' && sus.json.data.activeSessions === 0, 'super admin suspends an admin (sessions drop to 0)');
  const after = await call('GET', '/admin/dashboard', adminACookie);
  record(after.status === 401 || after.status === 403, 'the suspended admin\'s existing session stops working IMMEDIATELY', String(after.status));
  const susLogin = await tryLogin('admin-a@example.com');
  record(susLogin.res.status === 403 && susLogin.res.json?.error?.code === 'ACCOUNT_SUSPENDED', 'a suspended admin cannot sign in');
  record((await call('PATCH', `/admin/staff/${aId}/suspend`, superCookie)).status === 200, 'suspending twice is harmless');
  record((await call('POST', `/admin/staff/${aId}/password-link`, superCookie)).status === 400, 'no password link for a suspended admin');
  record((await call('POST', `/admin/staff/${aId}/sign-out`, superCookie)).status === 200, 'signing out a suspended admin is allowed (nothing to revoke)');
  const react = await call('PATCH', `/admin/staff/${aId}/reactivate`, superCookie);
  record(react.status === 200 && react.json.data.status === 'active', 'super admin reactivates the admin');
  const reCookie = (await tryLogin('admin-a@example.com')).cookie;
  record(reCookie !== '' && (await call('GET', '/admin/dashboard', reCookie)).status === 200, '...and they can sign in and work again');
  record((await call('GET', '/admin/dashboard', adminACookie)).status === 401, 'the OLD session stays dead after reactivation');

  // -------------------------------------------------------- force sign-out
  const c1 = await loginCookie('admin-b@example.com');
  const c2 = await loginCookie('admin-b@example.com');
  record((await call('GET', '/admin/dashboard', c1)).status === 200 && (await call('GET', '/admin/dashboard', c2)).status === 200, 'baseline: admin B has two live sessions');
  const so = await call('POST', `/admin/staff/${bId}/sign-out`, superCookie);
  record(so.status === 200 && so.json.data.revoked === 2, 'sign-out-everywhere revokes every live session', JSON.stringify(so.json?.data));
  record((await call('GET', '/admin/dashboard', c1)).status === 401 && (await call('GET', '/admin/dashboard', c2)).status === 401, '...both sessions stop working');
  record((await Account.findById(bId))!.status === 'active' && (await tryLogin('admin-b@example.com')).cookie !== '', '...but the account stays active: they just sign in again');

  // ------------------------------------------------------------- password link
  capturedLogs.length = 0;
  const link = await call('POST', `/admin/staff/${bId}/password-link`, superCookie);
  record(link.status === 200 && link.json.data.sent === false && link.json.data.reason === 'smtp_not_configured', 'sending a password link reports mail is not configured');
  record(!!lastResetToken(), '...but a fresh reset link was still issued');
  await call('POST', `/admin/staff/${bId}/password-link`, superCookie);
  record((await Token.countDocuments({ accountId: bId, purpose: 'password_reset' })) === 1, 'a new link replaces the previous one');

  // ------------------------------------------------------------------ delete
  await Follow.create({ accountId: adminB._id, tagId: (await Tag.create({ name: 'T', facet: 'keyword' }))._id });
  await Notification.create({ accountId: adminB._id, workId: new mongoose.Types.ObjectId(), workTitle: 't', agencyName: 'a', method: 'B0', status: 'BIDDING', statusLabel: 'BIDDING', matchedTags: [], ingestedDate: new Date() });
  const bCookie = await loginCookie('admin-b@example.com');
  record((await call('GET', '/admin/dashboard', bCookie)).status === 200, 'baseline: about to delete an admin with sessions, follows, a notification and a token');
  const del = await call('DELETE', `/admin/staff/${bId}`, superCookie);
  record(del.status === 200 && del.json.data.email === 'admin-b@example.com', 'super admin deletes an admin');
  const orphans = {
    account: await Account.countDocuments({ _id: bId }),
    sessions: await Session.countDocuments({ accountId: bId }),
    follows: await Follow.countDocuments({ accountId: bId }),
    notifications: await Notification.countDocuments({ accountId: bId }),
    tokens: await Token.countDocuments({ accountId: bId })
  };
  record(Object.values(orphans).every(n => n === 0), 'the account, sessions, follows, notifications and tokens are all removed', JSON.stringify(orphans));
  record((await call('GET', '/admin/dashboard', bCookie)).status === 401, 'the deleted admin\'s old session no longer works');
  record((await tryLogin('admin-b@example.com')).res.status === 401, 'the deleted admin cannot sign in');
  record((await call('GET', `/admin/staff/${bId}`, superCookie)).status === 404 && (await call('DELETE', `/admin/staff/${bId}`, superCookie)).status === 404, 'a deleted admin is 404, deleting twice -> 404');
  record((await Account.findById(cId)) !== null && (await Account.findById(aId)) !== null, 'other staff are untouched');
  record((await call('DELETE', `/admin/staff/${cId}`, superCookie)).status === 200, 'a suspended admin can be deleted');
  record((await call('GET', '/admin/staff', superCookie)).json.data.summary.total === 4, 'the list summary reflects the deletions (2 super + admin A + the new admin)');

  // ------------------------------------------------------ mail failure is not fatal
  (env as { SMTP_HOST?: string; SMTP_PORT?: number }).SMTP_HOST = '127.0.0.1';
  (env as { SMTP_HOST?: string; SMTP_PORT?: number }).SMTP_PORT = 1; // nothing listens here: connection refused
  const failMail = await call('POST', '/admin/staff', superCookie, { name: 'Mailfail', email: 'mailfail@example.com' });
  record(
    failMail.status === 201 && failMail.json.data.setupEmail.reason === 'send_failed' && (await Account.findOne({ email: 'mailfail@example.com' })) !== null,
    'if the mail server is unreachable the admin is STILL created and the response says the email failed',
    JSON.stringify(failMail.json?.data?.setupEmail)
  );

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
