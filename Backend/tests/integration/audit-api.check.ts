// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import mongoose, { Types } from 'mongoose';
import { AUDITED_MODELS } from '../../src/audit/registry';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { createSession } from '../../src/services/session.service';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-audit-api-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Account.init(), AuditLog.init()]);

  // Seed data is written directly so every field is controlled; the real
  // registry is switched off while fixtures are created and restored for the
  // end-to-end section at the bottom.
  const realRegistry = { ...AUDITED_MODELS };
  for (const name of Object.keys(AUDITED_MODELS)) delete AUDITED_MODELS[name];

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + p, {
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
    return { status: res.status, json, text };
  }
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const cookieFor = async (a: { _id: Types.ObjectId }) => `${SESSION_COOKIE_NAME}=${(await createSession(a._id, {})).rawToken}`;

  const superAcc = await mk('super@example.com', 'superadmin');
  const adminAcc = await mk('admin@example.com', 'admin', { permissions: ['poll&tag:manage'] });
  const vendorAcc = await mk('vendor@example.com', 'user');
  const superCookie = await cookieFor(superAcc);
  const adminCookie = await cookieFor(adminAcc);
  const vendorCookie = await cookieFor(vendorAcc);

  // ------------------------------------------------------------------ seed data
  const superActor = { type: 'user', id: superAcc._id.toString(), email: 'super@example.com', name: 'Name super', role: 'superadmin' };
  const adminActor = { type: 'user', id: adminAcc._id.toString(), email: 'admin@example.com', name: 'Name admin', role: 'admin' };
  const systemActor = { type: 'system', label: 'ingestion-worker' };
  const anonActor = { type: 'anonymous' };
  const T0 = Date.parse('2026-10-01T00:00:00.000Z');
  const kinds = [
    { action: 'tag.create', entityType: 'tag' },
    { action: 'tag.rename', entityType: 'tag' },
    { action: 'account.suspend', entityType: 'account', role: 'user' },
    { action: 'account.reactivate', entityType: 'account', role: 'user' },
    { action: 'work.tags_update', entityType: 'work' }
  ];
  const seed: any[] = [];
  const row = (over: Record<string, unknown>) => ({
    action: 'tag.create', entityType: 'tag', entityId: 'x', entityLabel: 'Label', actor: adminActor, changes: [{ path: 'name', after: 'x' }],
    createdAt: new Date(T0), ...over
  });
  for (let i = 0; i < 60; i++) {
    const k = kinds[i % kinds.length];
    seed.push(row({
      action: k.action, entityType: k.entityType, entityId: `ent-${i}`, entityLabel: `Label ${i}`,
      actor: [superActor, adminActor, systemActor][i % 3],
      metadata: k.role ? { role: k.role, source: 'auto' } : { source: 'auto' },
      createdAt: new Date(T0 + i * 60_000)
    }));
  }
  const bigChanges = Array.from({ length: 30 }, (_, i) => ({ path: `field${String(i).padStart(2, '0')}`, before: i, after: i + 1 }));
  seed.push(
    row({ action: 'account.suspend', entityType: 'account', entityId: 'vend-1', entityLabel: 'vendor1@example.com', metadata: { role: 'user' }, ip: '203.0.113.45', userAgent: 'UA/1.0', requestId: 'req-1', request: { method: 'PATCH', path: '/api/v1/admin/accounts/vend-1/suspend' }, createdAt: new Date(T0 + 100 * 60_000) }),
    // staff rows: Super Admin only
    row({ action: 'account.create', entityType: 'account', entityId: 'staff-1', entityLabel: 'staff1@example.com', metadata: { role: 'admin' }, actor: superActor, createdAt: new Date(T0 + 101 * 60_000) }),
    row({ action: 'account.permission_change', entityType: 'account', entityId: 'staff-1', entityLabel: 'staff1@example.com', metadata: { role: 'admin' }, actor: superActor, createdAt: new Date(T0 + 102 * 60_000) }),
    row({ action: 'account.sign_out_all', entityType: 'account', entityId: 'staff-1', entityLabel: 'staff1@example.com', metadata: { role: 'admin', sessionsRevoked: 2 }, actor: superActor, createdAt: new Date(T0 + 103 * 60_000) }),
    row({ action: 'account.delete', entityType: 'account', entityId: 'staff-2', entityLabel: 'former-super@example.com', metadata: { role: 'superadmin' }, actor: superActor, createdAt: new Date(T0 + 104 * 60_000) }),
    row({ action: 'tag.update', entityType: 'tag', entityId: 'tag-big', entityLabel: 'Big change', changes: bigChanges, createdAt: new Date(T0 + 105 * 60_000) }),
    row({ action: 'account.create', entityType: 'account', entityId: 'self-1', entityLabel: 'self@example.com', metadata: { role: 'user' }, actor: anonActor, createdAt: new Date(T0 + 106 * 60_000) }),
    row({ action: 'tag.create', entityType: 'tag', entityId: 'weird', entityLabel: 'Odd (name) [x] *+?', createdAt: new Date(T0 + 107 * 60_000) }),
    // identical timestamps: pagination must not duplicate or skip these
    ...Array.from({ length: 5 }, (_, i) => row({ action: 'tag.create', entityId: `tie-${i}`, entityLabel: `Tie ${i}`, createdAt: new Date(T0 + 200 * 60_000) })),
    // date boundary rows
    row({ entityId: 'd1', entityLabel: 'Day start', createdAt: new Date('2026-09-15T00:00:00.000Z') }),
    row({ entityId: 'd2', entityLabel: 'Day end', createdAt: new Date('2026-09-15T23:59:59.000Z') }),
    row({ entityId: 'd3', entityLabel: 'Next day', createdAt: new Date('2026-09-16T00:00:00.000Z') })
  );
  await AuditLog.collection.insertMany(seed); // test setup only: bypasses the application guard on purpose
  const staffRows = seed.filter(r => r.entityType === 'account' && ['admin', 'superadmin'].includes(r.metadata?.role));
  const total = seed.length;
  const visibleToAdmin = total - staffRows.length;

  // ===================================================================== access
  const urls = ['/admin/audit-log', '/admin/audit-log/filters', `/admin/audit-log/${new Types.ObjectId()}`];
  record((await Promise.all(urls.map(u => call('GET', u)))).every(r => r.status === 401), 'a visitor gets 401 on every audit-log endpoint');
  record((await Promise.all(urls.map(u => call('GET', u, vendorCookie)))).every(r => r.status === 403), 'a vendor gets 403 on every audit-log endpoint');
  const adminList = await call('GET', '/admin/audit-log', adminCookie);
  const superList = await call('GET', '/admin/audit-log', superCookie);
  record(adminList.status === 200 && superList.status === 200, 'an Admin and a Super Admin can both review the log (SRS 2.3)');

  // ================================================================== read-only
  const before = await AuditLog.countDocuments({});
  const verbs: [string, string][] = [['POST', ''], ['PUT', ''], ['PATCH', ''], ['DELETE', ''], ['POST', '/filters'], ['DELETE', '/filters']];
  const someId = String((await AuditLog.findOne({}))!._id);
  const writes = [...verbs.map(([m, s]) => call(m, `/admin/audit-log${s}`, superCookie, {})), ...['POST', 'PUT', 'PATCH', 'DELETE'].map(m => call(m, `/admin/audit-log/${someId}`, superCookie, { action: 'hacked' }))];
  const writeResults = await Promise.all(writes);
  record(writeResults.every(r => r.status === 404), 'READ-ONLY: POST / PUT / PATCH / DELETE on every audit-log URL are not routes (404), even for a Super Admin', writeResults.map(r => r.status).join());
  record((await AuditLog.countDocuments({})) === before && (await AuditLog.findById(someId))!.action !== 'hacked', '...and nothing in the log changed');

  // ============================================================ list + pagination
  record(superList.json.data.total === total && superList.json.data.page === 1 && superList.json.data.pageSize === 25 && superList.json.data.items.length === 25, `the list defaults to page 1, 25 per page, and reports the total (${total})`, `${superList.json?.data?.total}`);
  const times = superList.json.data.items.map((i: any) => Date.parse(i.createdAt));
  record(times.every((t: number, i: number) => i === 0 || times[i - 1] >= t), 'newest first by default');
  const oldest = await call('GET', '/admin/audit-log?sort=oldest&pageSize=3', superCookie);
  record(oldest.json.data.items[0].entityId === 'd1', 'sort=oldest puts the oldest entry first');

  const seen = new Set<string>();
  let dupes = 0;
  const pageSize = 7;
  const pages = Math.ceil(total / pageSize);
  for (let p = 1; p <= pages; p++) {
    const res = await call('GET', `/admin/audit-log?pageSize=${pageSize}&page=${p}`, superCookie);
    for (const item of res.json.data.items) {
      if (seen.has(item.id)) dupes++;
      seen.add(item.id);
    }
  }
  record(seen.size === total && dupes === 0, 'walking every page returns each entry exactly once (no duplicates, none skipped), even with 5 entries sharing one timestamp', `${seen.size}/${total}, ${dupes} duplicates`);
  record((await call('GET', `/admin/audit-log?pageSize=7&page=${pages + 1}`, superCookie)).json.data.items.length === 0, 'a page past the end is empty, not an error');
  record((await call('GET', '/admin/audit-log?pageSize=101', superCookie)).status === 400, 'page size is capped at 100');
  record((await call('GET', '/admin/audit-log?pageSize=100', superCookie)).status === 200, '...100 itself is allowed');
  record((await call('GET', '/admin/audit-log?page=0', superCookie)).status === 400, 'page 0 is rejected');
  record((await call('GET', '/admin/audit-log?page=abc', superCookie)).status === 400, 'a non-numeric page is rejected');
  record((await call('GET', '/admin/audit-log?role=admin', superCookie)).status === 400, 'unknown query parameters are rejected (strict)');
  record((await call('GET', '/admin/audit-log?sort=random', superCookie)).status === 400, 'an unknown sort is rejected');

  // ===================================================================== filters
  const idsOf = (res: any) => res.json.data.items.map((i: any) => i.entityId);
  const count = async (qs: string, cookie = superCookie) => (await call('GET', `/admin/audit-log?${qs}&pageSize=100`, cookie)).json.data.total;

  record((await count('action=account.suspend')) === seed.filter(r => r.action === 'account.suspend').length, 'filter: one action');
  record((await count('action=account.suspend,tag.rename')) === seed.filter(r => ['account.suspend', 'tag.rename'].includes(r.action)).length, 'filter: several actions, comma-separated');
  record((await count('entityType=tag')) === seed.filter(r => r.entityType === 'tag').length, 'filter: entity type');
  record((await count('entityType=tag,work')) === seed.filter(r => ['tag', 'work'].includes(r.entityType)).length, 'filter: several entity types');
  record((await count('entityId=staff-1')) === 3, 'filter: entity id (the history of one entity)');
  record((await count('action=account.suspend&entityType=account&entityId=vend-1')) === 1, 'filters combine (AND)');
  record((await count('action=does.not.exist')) === 0, 'a filter that matches nothing returns total 0');

  record((await count(`actor=${superAcc._id}`)) === seed.filter(r => r.actor.id === superAcc._id.toString()).length, 'filter: actor by account id');
  record((await count('actor=ADMIN@example.com')) === seed.filter(r => r.actor.email === 'admin@example.com').length, 'filter: actor by email (case-insensitive)');
  record((await count('actor=ingestion-worker')) === seed.filter(r => r.actor.label === 'ingestion-worker').length, 'filter: system actor by its label');
  record((await count('actor=anonymous')) === seed.filter(r => r.actor.type === 'anonymous').length, 'filter: "anonymous" actor');

  record((await count('from=2026-09-15&to=2026-09-15')) === 2, 'date range: a plain day covers that WHOLE day (00:00:00 through 23:59:59), not the next one', String(await count('from=2026-09-15&to=2026-09-15')));
  record((await count('from=2026-09-15T00:00:00.000Z&to=2026-09-15T23:59:58.000Z')) === 1, 'date range: exact timestamps are respected to the second');
  record((await count('from=2026-09-16')) === total - 2, 'date range: "from" alone (everything from that day on)');
  record((await count('to=2026-09-15')) === 2, 'date range: "to" alone (everything up to the end of that day)');
  record((await count('from=2026-09-15T00:00:00.000Z&to=2026-09-15T00:00:00.000Z')) === 1, 'date range: both ends are inclusive');
  record((await call('GET', '/admin/audit-log?from=not-a-date', superCookie)).status === 400, 'an invalid "from" date is rejected');
  record((await call('GET', '/admin/audit-log?to=2026-13-45', superCookie)).status === 400, 'an impossible "to" date is rejected');
  record((await call('GET', '/admin/audit-log?from=2026-10-02&to=2026-10-01', superCookie)).status === 400, '"from" after "to" is rejected');
  record((await count('action=tag.create&from=2026-09-15&to=2026-09-16')) === 3, 'dates combine with the other filters');

  // ===================================================================== search
  record((await count('q=Label 7')) === seed.filter(r => /label 7/i.test(r.entityLabel)).length, 'search: entity label');
  record((await count('q=vendor1@')) === 1, 'search: part of a label/email');
  record((await count('q=SUPER@EXAMPLE')) === seed.filter(r => r.actor.email === 'super@example.com').length, 'search: actor email, case-insensitive');
  record((await count('q=Name admin')) === seed.filter(r => r.actor.name === 'Name admin').length, 'search: actor name');
  record((await count('q=sign_out')) === 1, 'search: action name');
  record((await count('q=ent-12')) === 1, 'search: entity id');
  record((await count('q=' + encodeURIComponent('(name) [x] *+?'))) === 1, 'search: regex characters are treated literally (no error, no wildcard)');
  record((await call('GET', '/admin/audit-log?q=' + encodeURIComponent('(((['), superCookie)).status === 200, 'search: a malformed regex cannot break the endpoint');
  record((await count('q=zzzzzzz')) === 0, 'search: no match -> total 0');
  record((await count('q=tie&action=tag.create')) === 5, 'search combines with filters');

  // ================================================================ item shape
  const sample = (await call('GET', '/admin/audit-log?entityId=vend-1', superCookie)).json.data.items[0];
  record(sample.action === 'account.suspend' && sample.entityLabel === 'vendor1@example.com' && sample.actor.email === 'admin@example.com' && sample.requestId === 'req-1' && sample.request.path.endsWith('/suspend') && sample.userAgent === 'UA/1.0' && sample.metadata.role === 'user', 'an entry carries action, entity, actor, request id/path, user agent and metadata');
  record(sample.ip === '203.0.xx.xx', 'the IP address is MASKED (203.0.xx.xx), like the sessions list', sample.ip);
  const allText = (await Promise.all(Array.from({ length: pages }, (_, i) => call('GET', `/admin/audit-log?pageSize=${pageSize}&page=${i + 1}`, superCookie)))).map(r => r.text).join('');
  record(!allText.includes('203.0.113.45') && !allText.includes('"__v"'), 'the full IP and internal fields (__v) never appear in any list response, even for a Super Admin');
  const big = (await call('GET', '/admin/audit-log?entityId=tag-big', superCookie)).json.data.items[0];
  record(big.changeCount === 30 && big.changes.length === 20 && big.changesCutShort === true, 'the list shows at most 20 changes per entry and says it was cut short (changeCount 30)');
  const detail = await call('GET', `/admin/audit-log/${big.id}`, superCookie);
  record(detail.status === 200 && detail.json.data.changes.length === 30 && detail.json.data.changesCutShort === false, 'the detail endpoint returns ALL 30 changes');
  record(detail.json.data.id === big.id && detail.json.data.ip === undefined, 'the detail endpoint returns the same entry (and masks IP too)');
  record((await call('GET', `/admin/audit-log/${new Types.ObjectId()}`, superCookie)).status === 404, 'detail: unknown id -> 404');
  record((await call('GET', '/admin/audit-log/not-an-id', superCookie)).status === 404, 'detail: malformed id -> 404');

  // ================================================================== role scope
  record(superList.json.data.total === total && adminList.json.data.total === visibleToAdmin, `a Super Admin sees all ${total} entries; a regular Admin sees ${visibleToAdmin} (staff-account entries hidden)`, `${superList.json.data.total} vs ${adminList.json.data.total}`);
  const staffActions = ['account.permission_change', 'account.sign_out_all', 'account.delete'];
  record((await count(`action=${staffActions.join(',')}`, adminCookie)) === 0 && (await count(`action=${staffActions.join(',')}`, superCookie)) === 3, 'a regular Admin cannot reach staff rows through the action filter');
  record((await count('entityId=staff-1', adminCookie)) === 0 && (await count('q=staff1@', adminCookie)) === 0 && (await count('q=former-super', adminCookie)) === 0, '...nor by entity id or by searching for the staff member\'s email');
  record((await count('entityType=account', adminCookie)) === seed.filter(r => r.entityType === 'account' && !['admin', 'superadmin'].includes(r.metadata?.role)).length, '...while vendor-account entries stay visible to them');
  const staffId = String((await AuditLog.findOne({ entityId: 'staff-1' }))!._id);
  record((await call('GET', `/admin/audit-log/${staffId}`, adminCookie)).status === 404 && (await call('GET', `/admin/audit-log/${staffId}`, superCookie)).status === 200, 'a staff entry is 404 (not 403: its existence is not confirmed) for an Admin, 200 for a Super Admin');
  record(adminList.text.indexOf('staff1@example.com') === -1 && !adminList.text.includes('former-super'), 'no trace of staff rows in an Admin\'s list response');

  // ============================================================ the filters endpoint
  const fSuper = (await call('GET', '/admin/audit-log/filters', superCookie)).json.data;
  const fAdmin = (await call('GET', '/admin/audit-log/filters', adminCookie)).json.data;
  const expectedActions = [...new Set(seed.map(r => r.action))].sort();
  record(JSON.stringify(fSuper.actions) === JSON.stringify(expectedActions), 'filters: lists exactly the distinct actions found in the data, sorted', fSuper.actions.join());
  record(JSON.stringify(fSuper.entityTypes) === JSON.stringify([...new Set(seed.map(r => r.entityType))].sort()), 'filters: lists exactly the distinct entity types found in the data, sorted', fSuper.entityTypes.join());
  record(staffActions.every(a => fSuper.actions.includes(a)) && staffActions.every(a => !fAdmin.actions.includes(a)), 'filters: staff-only actions are listed for a Super Admin but not for a regular Admin');
  const keys = fSuper.actors.map((a: any) => a.key);
  record(new Set(keys).size === keys.length && keys.includes(superAcc._id.toString()) && keys.includes(adminAcc._id.toString()) && keys.includes('ingestion-worker') && keys.includes('anonymous'), 'filters: actors are de-duplicated and cover users, the system worker and anonymous', keys.join());
  const adminOption = fSuper.actors.find((a: any) => a.key === adminAcc._id.toString());
  record(adminOption?.email === 'admin@example.com' && adminOption?.role === 'admin' && adminOption?.type === 'user', 'filters: each actor option has email, name, role and type for display');
  record((await count(`actor=${encodeURIComponent(adminOption.key)}`)) === seed.filter(r => r.actor.id === adminAcc._id.toString()).length, 'filters: an actor option\'s "key" works directly as the "actor" filter');

  // A brand-new kind of event and entity: no code change, it just appears.
  await AuditLog.collection.insertOne(row({ action: 'gadget.explode', entityType: 'gadget', entityId: 'g1', entityLabel: 'Gadget 1', createdAt: new Date(T0 + 300 * 60_000) }));
  const fNew = (await call('GET', '/admin/audit-log/filters', adminCookie)).json.data;
  record(fNew.actions.includes('gadget.explode') && fNew.entityTypes.includes('gadget'), 'filters: a NEW action and entity type appear as soon as they are recorded, with no code change');
  record((await count('entityType=gadget&action=gadget.explode')) === 1, '...and they are immediately filterable');

  // ====================================================== reading writes nothing
  const rowsBefore = await AuditLog.countDocuments({});
  await Promise.all([call('GET', '/admin/audit-log', superCookie), call('GET', '/admin/audit-log/filters', superCookie), call('GET', `/admin/audit-log/${someId}`, superCookie)]);
  record((await AuditLog.countDocuments({})) === rowsBefore, 'reading the log does not write to it');

  // ============================================ end to end: real action -> log -> API
  Object.assign(AUDITED_MODELS, realRegistry);
  await AuditLog.collection.deleteMany({});
  const vend = await mk('real-vendor@example.com', 'user');
  await AuditLog.collection.deleteMany({});
  await call('PATCH', `/admin/accounts/${vend._id}/suspend`, adminCookie);
  const created = await call('POST', '/admin/staff', superCookie, { name: 'Real Staff', email: 'real-staff@example.com', permission: 'tag:manage' });
  const staffAcct = created.json.data.admin.id;
  await call('PATCH', `/admin/staff/${staffAcct}`, superCookie, { permission: 'poll:manage' });
  await call('POST', `/admin/staff/${staffAcct}/sign-out`, superCookie);
  await call('POST', `/admin/staff/${staffAcct}/password-link`, superCookie);
  const asAdmin = (await call('GET', '/admin/audit-log?pageSize=100', adminCookie)).json.data;
  const asSuper = (await call('GET', '/admin/audit-log?pageSize=100', superCookie)).json.data;
  const suspendRow = asAdmin.items.find((i: any) => i.action === 'account.suspend');
  record(!!suspendRow && suspendRow.entityLabel === 'real-vendor@example.com' && suspendRow.actor.email === 'admin@example.com' && suspendRow.changes[0].path === 'status', 'END TO END: a real suspend through the admin API shows up in the audit-log API with the right actor and diff');
  record(asAdmin.items.every((i: any) => i.metadata?.role !== 'admin') && asAdmin.total === 1, 'END TO END: the same session of staff actions (create, permission change, sign-out, password link) is INVISIBLE to a regular Admin', `admin sees ${asAdmin.total}`);
  record(['account.create', 'account.permission_change', 'account.sign_out_all', 'account.password_link_sent'].every(a => asSuper.items.some((i: any) => i.action === a)), 'END TO END: ...and all of it is visible to the Super Admin (including the manual events, which carry the role)', asSuper.items.map((i: any) => i.action).join());
  const fRealAdmin = (await call('GET', '/admin/audit-log/filters', adminCookie)).json.data;
  record(!fRealAdmin.actions.includes('account.permission_change') && fRealAdmin.actions.includes('account.suspend'), 'END TO END: the filter list for the Admin leaves out staff-only actions too');

  // ================================================================ performance
  await AuditLog.collection.deleteMany({});
  const bulk = Array.from({ length: 4000 }, (_, i) => row({ action: kinds[i % 5].action, entityType: kinds[i % 5].entityType, entityId: `p-${i}`, entityLabel: `Perf ${i}`, createdAt: new Date(T0 + i * 1000) }));
  await AuditLog.collection.insertMany(bulk);
  const t0 = Date.now();
  const perf = await call('GET', '/admin/audit-log?action=tag.create&from=2026-10-01&to=2026-10-02&pageSize=50&q=perf', superCookie);
  const perfFilters = await call('GET', '/admin/audit-log/filters', superCookie);
  const ms = Date.now() - t0;
  record(perf.status === 200 && perfFilters.status === 200 && ms < 2500, 'with 4,000 entries, a filtered+searched list and the filters call finish quickly', `${ms} ms`);

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
