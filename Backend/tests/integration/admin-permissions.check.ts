import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account, AccountRole, Permission } from '../../src/models/account.model';
import { Tag } from '../../src/models/tag.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';

// Integration check for the split Admin roles -- Poll Admin (poll:manage),
// Tag Admin (tag:manage), Poll and Tag Admin (poll&tag:manage) -- and for the
// admin editor that hands them out:
//   A. what each role may call on the API (and that a refused call changes nothing);
//   B. what the admin editor (/admin/staff) accepts, stores and reports;
//   C. a role change applies on the very next request.
// Run: npm run check:admin-permissions   (needs a MongoDB; see MONGODB_URI below)
//
// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-permissions-check';

const PASSWORD = 'Password123';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Tag.syncIndexes();
  await Account.syncIndexes();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }

  async function makeAccount(email: string, role: AccountRole, permissions: Permission[] = []) {
    return Account.create({ email, passwordHash: PASSWORD, name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, permissions });
  }

  async function loginCookie(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    const first = res.setCookie?.split(';')[0] ?? '';
    if (!first.startsWith(`${SESSION_COOKIE_NAME}=`)) throw new Error(`login failed for ${email}: ${res.status}`);
    return first;
  }

  const superAcc = await makeAccount('super@example.com', 'superadmin');
  const pollAcc = await makeAccount('poll@example.com', 'admin', ['poll:manage']);
  const tagAcc = await makeAccount('tag@example.com', 'admin', ['tag:manage']);
  const bothAcc = await makeAccount('both@example.com', 'admin', ['poll&tag:manage']);
  const bareAcc = await makeAccount('bare@example.com', 'admin'); // an Admin from before roles were split
  await makeAccount('vendor@example.com', 'user');

  const cookies = {
    super: await loginCookie('super@example.com'),
    poll: await loginCookie('poll@example.com'),
    tag: await loginCookie('tag@example.com'),
    both: await loginCookie('both@example.com'),
    bare: await loginCookie('bare@example.com'),
    vendor: await loginCookie('vendor@example.com')
  };
  type Who = keyof typeof cookies;

  // ===================================================================== A. what each role may call
  // allowed[who] : may this caller get past the permission check? (A refused call is 403.)
  const roleAccess: Record<Who, { poll: boolean; tag: boolean; anyAdmin: boolean; staff: boolean }> = {
    super: { poll: true, tag: true, anyAdmin: true, staff: true },
    poll: { poll: true, tag: false, anyAdmin: true, staff: false },
    tag: { poll: false, tag: true, anyAdmin: true, staff: false },
    both: { poll: true, tag: true, anyAdmin: true, staff: false },
    bare: { poll: false, tag: false, anyAdmin: true, staff: false },
    vendor: { poll: false, tag: false, anyAdmin: false, staff: false }
  };

  const calls: { area: 'poll' | 'tag' | 'anyAdmin' | 'staff'; label: string; method: string; path: (who: Who) => string; body?: (who: Who) => unknown }[] = [
    { area: 'poll', label: 'run history', method: 'GET', path: () => '/admin/ingestion/runs' },
    { area: 'poll', label: 'read the schedule', method: 'GET', path: () => '/admin/ingestion/settings' },
    { area: 'poll', label: 'change the schedule', method: 'PATCH', path: () => '/admin/ingestion/settings', body: who => ({ pollIntervalMinutes: { super: 720, poll: 240, tag: 480, both: 360, bare: 600, vendor: 840 }[who] }) },
    { area: 'poll', label: 'Poll Now (all sites)', method: 'POST', path: () => '/admin/gov-sites/poll-all' },
    { area: 'poll', label: 'Poll Now (one site)', method: 'POST', path: () => '/admin/gov-sites/000000000000000000000000/poll', body: () => ({}) },
    { area: 'tag', label: 'tag list', method: 'GET', path: () => '/admin/tags' },
    { area: 'tag', label: 'create a tag', method: 'POST', path: () => '/admin/tags', body: who => ({ name: `Tag by ${who}`, facet: 'keyword' }) },
    { area: 'tag', label: 'work list (tag curation)', method: 'GET', path: () => '/admin/works' },
    { area: 'tag', label: 'set the tags on a work', method: 'PUT', path: () => '/admin/works/000000000000000000000000/tags', body: () => ({ tagIds: [] }) },
    { area: 'anyAdmin', label: 'dashboard', method: 'GET', path: () => '/admin/dashboard' },
    { area: 'anyAdmin', label: 'poll status (for the in-progress banner)', method: 'GET', path: () => '/admin/ingestion/status' },
    { area: 'anyAdmin', label: 'vendor accounts', method: 'GET', path: () => '/admin/accounts' },
    { area: 'anyAdmin', label: 'department list', method: 'GET', path: () => '/admin/gov-sites' },
    { area: 'staff', label: 'admin editor list', method: 'GET', path: () => '/admin/staff' }
  ];

  const roleNames: Record<Who, string> = { super: 'Super Admin', poll: 'Poll Admin', tag: 'Tag Admin', both: 'Poll and Tag Admin', bare: 'Admin with no role yet', vendor: 'vendor' };
  const order: Who[] = ['poll', 'tag', 'both', 'bare', 'super', 'vendor'];
  let expectedInterval = 1440;
  const createdTagsBy: Who[] = [];

  for (const call_ of calls) {
    for (const who of order) {
      const allowed = roleAccess[who][call_.area];
      const res = await call(call_.method, call_.path(who), cookies[who], call_.body?.(who));
      const pass = allowed ? res.status !== 403 && res.status !== 401 : res.status === 403;
      record(pass, `${roleNames[who]} ${allowed ? 'can' : 'is refused'}: ${call_.label}`, `${res.status}`);

      if (allowed && call_.label === 'change the schedule' && res.status === 200) expectedInterval = (call_.body!(who) as { pollIntervalMinutes: number }).pollIntervalMinutes;
      if (allowed && call_.label === 'create a tag' && res.status === 201) createdTagsBy.push(who);
    }
  }

  // A refused call must not have done anything -- this is what catches a permission check that runs AFTER the handler.
  const tagNames = (await Tag.find({ name: /^Tag by / })).map(t => t.name).sort();
  record(
    JSON.stringify(tagNames) === JSON.stringify(createdTagsBy.map(w => `Tag by ${w}`).sort()),
    'refused tag creations created nothing (only Tag, Poll-and-Tag and Super Admin made tags)',
    tagNames.join(', ')
  );
  const settings = await call('GET', '/admin/ingestion/settings', cookies.super);
  record(settings.json?.data?.pollIntervalMinutes === expectedInterval, 'refused schedule changes changed nothing', `${settings.json?.data?.pollIntervalMinutes} vs ${expectedInterval}`);

  record((await call('GET', '/tags')).status === 200, 'the public tag list stays public (no sign-in, no role)');
  record((await call('GET', '/admin/tags')).status === 401, 'a visitor still gets 401 (not 403) on the tag admin API');

  const me = await call('GET', '/auth/me', cookies.poll);
  record(Array.isArray(me.json?.data?.permissions) && me.json.data.permissions.includes('poll:manage'), 'the signed-in account carries its permissions (the admin UI hides boxes with them)', JSON.stringify(me.json?.data?.permissions));

  // ===================================================================== B. the admin editor
  const staffList = await call('GET', '/admin/staff?pageSize=50', cookies.super);
  const byEmail = (email: string) => staffList.json.data.items.find((a: { email: string }) => a.email === email);
  record(byEmail('poll@example.com')?.permission === 'poll:manage', 'editor lists a Poll Admin as poll:manage');
  record(byEmail('tag@example.com')?.permission === 'tag:manage', 'editor lists a Tag Admin as tag:manage');
  record(byEmail('both@example.com')?.permission === 'poll&tag:manage', 'editor lists a Poll and Tag Admin as poll&tag:manage');
  record(byEmail('bare@example.com')?.permission === null, 'editor lists an Admin with no role yet as null');
  record(byEmail('super@example.com')?.permission === null && byEmail('super@example.com')?.role === 'superadmin', 'editor lists a Super Admin with no admin role');

  const twoSeparate = await makeAccount('two@example.com', 'admin', ['poll:manage', 'tag:manage']);
  record(
    (await call('GET', `/admin/staff/${twoSeparate._id}`, cookies.super)).json?.data?.permission === 'poll&tag:manage',
    'poll:manage + tag:manage held separately is reported as Poll and Tag Admin'
  );

  const noRole = await call('POST', '/admin/staff', cookies.super, { name: 'No Role', email: 'norole@example.com' });
  record(noRole.status === 400, 'creating an Admin without choosing a role is rejected', String(noRole.status));
  const badRole = await call('POST', '/admin/staff', cookies.super, { name: 'Bad Role', email: 'badrole@example.com', permission: 'poll:everything' });
  record(badRole.status === 400, 'an unknown role value is rejected', String(badRole.status));
  const superRole = await call('POST', '/admin/staff', cookies.super, { name: 'Sneaky', email: 'sneaky@example.com', permission: 'tag:manage', role: 'superadmin' });
  record(superRole.status === 400, 'an account role field is still rejected (no way to create a Super Admin here)', String(superRole.status));

  const made = await call('POST', '/admin/staff', cookies.super, { name: 'Nida', email: 'nida@example.com', permission: 'poll:manage' });
  const madeDoc = await Account.findOne({ email: 'nida@example.com' });
  record(
    made.status === 201 && made.json?.data?.admin?.permission === 'poll:manage' && madeDoc?.role === 'admin' && JSON.stringify(madeDoc.permissions) === '["poll:manage"]',
    'creating a Poll Admin stores role admin + poll:manage and reports it back',
    `${made.status} ${JSON.stringify(made.json?.data?.admin?.permission)} ${JSON.stringify(madeDoc?.permissions)}`
  );

  const madeId = String(madeDoc?._id);
  const changed = await call('PATCH', `/admin/staff/${madeId}`, cookies.super, { permission: 'poll&tag:manage' });
  record(changed.status === 200 && changed.json?.data?.permission === 'poll&tag:manage' && JSON.stringify((await Account.findById(madeId))?.permissions) === '["poll&tag:manage"]', 'the editor can change an Admin\'s role (replaces it, never stacks)');
  record((await call('PATCH', `/admin/staff/${madeId}`, cookies.super, { permission: 'nope' })).status === 400, 'changing to an unknown role is rejected');
  record((await call('PATCH', `/admin/staff/${madeId}`, cookies.super, {})).status === 400, 'an empty update is still rejected');
  record((await call('PATCH', `/admin/staff/${madeId}`, cookies.super, { name: 'Nida Renamed' })).json?.data?.permission === 'poll&tag:manage', 'renaming leaves the role alone');
  const onSuper = await call('PATCH', `/admin/staff/${superAcc._id}`, cookies.super, { permission: 'tag:manage' });
  record(onSuper.status === 403 && (await Account.findById(superAcc._id))?.permissions.length === 0, 'a Super Admin\'s role cannot be changed from the editor');
  for (const who of ['poll', 'tag', 'both', 'bare'] as const) {
    const r = await call('PATCH', `/admin/staff/${(await Account.findOne({ email: `${who}@example.com` }))?._id}`, cookies[who], { permission: 'poll&tag:manage' });
    record(r.status === 403, `${roleNames[who]} cannot hand out roles (editor is Super Admin only)`, String(r.status));
  }

  // ===================================================================== C. a role change applies on the next request
  const pollBefore = await call('GET', '/admin/ingestion/runs', cookies.poll);
  const pollTagBefore = await call('GET', '/admin/tags', cookies.poll);
  await call('PATCH', `/admin/staff/${pollAcc._id}`, cookies.super, { permission: 'tag:manage' });
  const pollAfter = await call('GET', '/admin/ingestion/runs', cookies.poll);
  const pollTagAfter = await call('GET', '/admin/tags', cookies.poll);
  record(pollBefore.status === 200 && pollTagBefore.status === 403, 'before the change: the Poll Admin can poll and cannot manage tags');
  record(pollAfter.status === 403 && pollTagAfter.status === 200, 'after the editor makes them a Tag Admin: the SAME session loses polling and gains tags immediately', `${pollAfter.status}/${pollTagAfter.status}`);

  // ===================================================================== D. the account model
  const stripped = await Account.create({ email: 'super3@example.com', passwordHash: PASSWORD, name: 'Super Three', type: 'individual', role: 'superadmin', permissions: ['poll:manage'] });
  record(stripped.permissions.length === 0, 'a Super Admin never keeps admin-role permissions');
  const bogus = await Account.create({ email: 'bogus@example.com', passwordHash: PASSWORD, name: 'Bogus', type: 'individual', role: 'admin', permissions: ['everything' as Permission] }).then(
    () => 'created',
    (e: Error) => e.name
  );
  record(bogus === 'ValidationError', 'the database refuses a role value that is not one of the three', bogus);
  void bareAcc;
  void tagAcc;
  void bothAcc;

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
