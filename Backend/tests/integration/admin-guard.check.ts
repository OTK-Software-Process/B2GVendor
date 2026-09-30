import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account, AccountRole } from '../../src/models/account.model';
import { Session } from '../../src/models/session.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-guard-check';

const PASSWORD = 'Password123';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

interface Envelope {
  success: boolean;
  error?: { code: string; message: string };
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
    const json = (await res.json().catch(() => null)) as Envelope | null;
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }

  // The Account model bcrypt-hashes passwordHash on save, so pass the plain value.
  const passwordHash = PASSWORD;
  async function makeAccount(role: AccountRole, status: 'active' | 'suspended' = 'active') {
    return Account.create({
      email: `${role}-${status}@example.com`,
      passwordHash,
      name: `Test ${role}`,
      type: 'individual',
      status,
      role
    });
  }

  // Logs in through the real endpoint and returns the ready-to-send cookie.
  async function loginCookie(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    const first = res.setCookie?.split(';')[0] ?? '';
    if (!first.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`);
    }
    return first;
  }

  await makeAccount('user');
  await makeAccount('admin');
  await makeAccount('superadmin');
  const suspendedAdmin = await makeAccount('admin', 'suspended');

  const userCookie = await loginCookie('user-active@example.com');
  const adminCookie = await loginCookie('admin-active@example.com');
  const superCookie = await loginCookie('superadmin-active@example.com');

  // Read endpoints that every /admin area depends on -- a representative
  // sample across the mounted sub-routers.
  const adminReads = [
    '/admin/ingestion/runs',
    '/admin/gov-sites/poll-all'
  ];

  // --- Visitor (no session) ---
  for (const path of adminReads) {
    const res = await call(path.endsWith('poll-all') ? 'POST' : 'GET', path);
    record(
      res.status === 401 && res.json?.error?.code === 'NOT_AUTHENTICATED',
      `visitor is rejected with 401 on ${path}`,
      `${res.status} ${JSON.stringify(res.json)}`
    );
  }
  const badCookie = await call('GET', '/admin/ingestion/runs', `${SESSION_COOKIE_NAME}=not-a-real-token`);
  record(badCookie.status === 401, 'a forged session cookie is rejected with 401', String(badCookie.status));

  // --- Regular vendor account ---
  for (const path of adminReads) {
    const res = await call(path.endsWith('poll-all') ? 'POST' : 'GET', path, userCookie);
    record(
      res.status === 403 && res.json?.error?.code === 'FORBIDDEN',
      `vendor (role user) is rejected with 403 on ${path}`,
      `${res.status} ${JSON.stringify(res.json)}`
    );
  }
  const userTagCreate = await call('POST', '/admin/tags', userCookie, { name: 'x', facet: 'keyword' });
  record(userTagCreate.status === 403, 'vendor cannot create a tag via /admin/tags', String(userTagCreate.status));

  // --- Admin ---
  const adminRuns = await call('GET', '/admin/ingestion/runs', adminCookie);
  record(adminRuns.status === 200, 'admin can open admin read endpoints', String(adminRuns.status));

  // Super-Admin-only: adding a government site (source configuration).
  const adminAddSite = await call('POST', '/admin/gov-sites', adminCookie, {});
  record(
    adminAddSite.status === 403 && adminAddSite.json?.error?.code === 'FORBIDDEN',
    'admin is blocked server-side from adding a gov site (Super Admin only)',
    `${adminAddSite.status} ${JSON.stringify(adminAddSite.json)}`
  );
  const adminEditSite = await call('PATCH', '/admin/gov-sites/000000000000000000000000', adminCookie, {});
  record(adminEditSite.status === 403, 'admin is blocked server-side from editing a gov site', String(adminEditSite.status));

  // --- Super Admin ---
  const superRuns = await call('GET', '/admin/ingestion/runs', superCookie);
  record(superRuns.status === 200, 'super admin can open admin read endpoints', String(superRuns.status));
  // An empty body fails validation (400/422) -- the point is it got PAST the role guard.
  const superAddSite = await call('POST', '/admin/gov-sites', superCookie, {});
  record(
    superAddSite.status !== 401 && superAddSite.status !== 403,
    'super admin passes the role guard on adding a gov site',
    String(superAddSite.status)
  );

  // --- Public routes stay public ---
  const publicTags = await call('GET', '/tags');
  record(publicTags.status === 200, 'public GET /tags still works without login', String(publicTags.status));

  // --- Session lifecycle ---
  const suspendedLogin = await call('POST', '/auth/login', undefined, {
    email: suspendedAdmin.email,
    password: PASSWORD
  });
  record(
    suspendedLogin.status === 403 && suspendedLogin.json?.error?.code === 'ACCOUNT_SUSPENDED',
    'a suspended admin cannot log in',
    `${suspendedLogin.status} ${JSON.stringify(suspendedLogin.json)}`
  );

  // Suspend an admin who already holds a live session: the next admin call must fail.
  const secondAdmin = await Account.create({
    email: 'second-admin@example.com',
    passwordHash,
    name: 'Second admin',
    type: 'individual',
    status: 'active',
    role: 'admin'
  });
  const secondCookie = await loginCookie('second-admin@example.com');
  record((await call('GET', '/admin/ingestion/runs', secondCookie)).status === 200, 'second admin works before suspension');
  await Account.updateOne({ _id: secondAdmin._id }, { status: 'suspended' });
  const afterSuspend = await call('GET', '/admin/ingestion/runs', secondCookie);
  record(
    afterSuspend.status === 403 && afterSuspend.json?.error?.code === 'ACCOUNT_SUSPENDED',
    'an admin suspended mid-session is blocked on the next request',
    `${afterSuspend.status} ${JSON.stringify(afterSuspend.json)}`
  );

  // Demoted mid-session: role is read fresh from the DB on every request.
  const thirdAdmin = await Account.create({
    email: 'third-admin@example.com',
    passwordHash,
    name: 'Third admin',
    type: 'individual',
    status: 'active',
    role: 'admin'
  });
  const thirdCookie = await loginCookie('third-admin@example.com');
  await Account.updateOne({ _id: thirdAdmin._id }, { role: 'user' });
  const afterDemote = await call('GET', '/admin/ingestion/runs', thirdCookie);
  record(afterDemote.status === 403, 'an admin demoted mid-session loses access immediately', String(afterDemote.status));

  // Expired session.
  await Session.updateMany({ expiresAt: { $gt: new Date() } }, { expiresAt: new Date(Date.now() - 1000) });
  const expired = await call('GET', '/admin/ingestion/runs', adminCookie);
  record(
    expired.status === 401 && expired.json?.error?.code === 'NOT_AUTHENTICATED',
    'an expired session is rejected with 401',
    `${expired.status} ${JSON.stringify(expired.json)}`
  );

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
