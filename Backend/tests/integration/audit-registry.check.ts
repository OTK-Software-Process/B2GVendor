// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { AUDITED_MODELS } from '../../src/audit/registry';
import { verifyAuditSetup } from '../../src/audit/install';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { GovSite } from '../../src/models/govSite.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { audit } from '../../src/services/audit.service';
import { createSession } from '../../src/services/session.service';

// Drives every Sprint 3 admin edit through the REAL HTTP API with the REAL
// registry, and checks what lands in the audit log. Uses its own throwaway
// database -- never touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-audit-registry-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}
const clearLog = () => AuditLog.collection.deleteMany({}); // test setup only: bypasses the application guard on purpose
const rows = () => AuditLog.find({}).sort({ createdAt: 1, _id: 1 }).lean();
const changePaths = (row: { changes: { path: string }[] }) => row.changes.map(c => c.path).sort().join(',');
const seenActions = new Set<string>();

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Tag.init(), Account.init(), AuditLog.init(), Work.init()]);

  // ------------------------------------------------------------- registry wiring
  record(Object.keys(AUDITED_MODELS).sort().join() === 'Account,Tag,Work', 'the registry audits exactly Account, Tag and Work', Object.keys(AUDITED_MODELS).join());
  record(verifyAuditSetup().length === 0, 'startup check: every registered model is really covered by the plugin (installed before the models loaded)', verifyAuditSetup().join(' | '));

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AuditRegistryCheck/1.0', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }
  const cookieFor = async (account: { _id: mongoose.Types.ObjectId }) => `${SESSION_COOKIE_NAME}=${(await createSession(account._id, {})).rawToken}`;
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });

  const superAcc = await mk('super@example.com', 'superadmin');
  // A regular admin needs a permission to reach the tag/work areas (Poll Admin / Tag Admin role split).
  const adminAcc = await mk('admin@example.com', 'admin', { permissions: ['poll&tag:manage'] });
  const superCookie = await cookieFor(superAcc);
  const adminCookie = await cookieFor(adminAcc);

  // =============================================================== VENDOR ACCOUNTS
  await clearLog();
  const created = await call('POST', '/admin/accounts', superCookie, { name: 'Somchai Jaidee', email: 'v1@example.com', phone: '0811111111' });
  const vendorId: string = created.json.data.vendor.id;
  let r = await rows();
  record(created.status === 201 && r.length === 1 && r[0].action === 'account.create', 'admin creates a vendor -> exactly one row "account.create"', r.map(x => x.action).join());
  record(r[0].actor.type === 'user' && r[0].actor.email === 'super@example.com' && r[0].actor.role === 'superadmin', '...attributed to the signed-in admin (snapshot of email and role)');
  record(r[0].entityType === 'account' && r[0].entityId === vendorId && r[0].entityLabel === 'v1@example.com', '...about the right entity, labelled by email');
  record(r[0].metadata?.role === 'user' && r[0].metadata?.accountType === 'individual' && r[0].metadata?.source === 'auto', '...with the target\'s role in metadata (tells a vendor from an admin)');
  record(!!r[0].requestId && r[0].request?.method === 'POST' && r[0].request?.path === '/api/v1/admin/accounts' && r[0].userAgent === 'AuditRegistryCheck/1.0', '...with request id, method, path and user agent');
  record(r[0].changes.find(c => c.path === 'passwordHash')?.redacted === true && r[0].changes.find(c => c.path === 'phone')?.after === '[REDACTED]', '...the password hash and phone are masked');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('PATCH', `/admin/accounts/${vendorId}`, superCookie, { name: 'Somchai J', phone: '0822222222' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.update' && changePaths(r[0]) === 'name,phone', 'editing a vendor -> "account.update" with just name and phone', changePaths(r[0] ?? { changes: [] }));
  record(r[0].changes.find(c => c.path === 'name')?.before === 'Somchai Jaidee' && r[0].changes.find(c => c.path === 'name')?.after === 'Somchai J', '...name shows before and after');
  record(r[0].changes.find(c => c.path === 'phone')?.before === '[REDACTED]' && r[0].entityLabel === 'v1@example.com', '...phone is masked on both sides, and the label survives (from the whole document)');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('PATCH', `/admin/accounts/${vendorId}/suspend`, adminCookie);
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.suspend' && changePaths(r[0]) === 'status', 'suspending -> a single readable row "account.suspend" (not a generic update)', r.map(x => x.action).join());
  record(r[0].changes[0].before === 'active' && r[0].changes[0].after === 'suspended' && r[0].actor.email === 'admin@example.com', '...status active -> suspended, by the regular admin who did it');
  r.forEach(x => seenActions.add(x.action));
  await clearLog();
  await call('PATCH', `/admin/accounts/${vendorId}/suspend`, adminCookie);
  record((await AuditLog.countDocuments({})) === 0, 'suspending an already-suspended account again records nothing (no noise)');

  await call('PATCH', `/admin/accounts/${vendorId}/reactivate`, adminCookie);
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.reactivate' && r[0].changes[0].after === 'active', 'reactivating -> "account.reactivate"');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  const link = await call('POST', `/admin/accounts/${vendorId}/password-link`, superCookie);
  r = await rows();
  record(link.status === 200 && r.length === 1 && r[0].action === 'account.password_link_sent', 'sending a password link -> exactly one row "account.password_link_sent"', r.map(x => x.action).join());
  record(r[0].metadata?.emailSent === false && r[0].metadata?.reason === 'smtp_not_configured' && r[0].entityLabel === 'v1@example.com', '...records whether the email actually went out');
  record(!JSON.stringify(r).match(/reset-password\/|tokenHash/i), '...and never the link or token itself');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  const voucher = await Account.findById(vendorId);
  await createSession(voucher!._id, {}); // give the vendor something to cascade-delete
  await call('DELETE', `/admin/accounts/${vendorId}`, superCookie);
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.delete' && r[0].entityLabel === 'v1@example.com', 'deleting a vendor -> exactly one row "account.delete" (the cascade of sessions/tokens is not logged separately)', r.map(x => x.action).join());
  record(r[0].changes.some(c => c.path === 'email' && c.before === 'v1@example.com' && !('after' in c)) && r[0].metadata?.role === 'user', '...keeps what the account looked like (before only)');
  record(r[0].changes.find(c => c.path === 'passwordHash')?.before === '[REDACTED]', '...with the password hash masked');
  r.forEach(x => seenActions.add(x.action));

  // ================================================================ ADMIN ACCOUNTS
  await clearLog();
  const madeAdmin = await call('POST', '/admin/staff', superCookie, { name: 'Napat', email: 'a1@example.com', permission: 'tag:manage' });
  const staffId: string = madeAdmin.json.data.admin.id;
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.create' && r[0].metadata?.role === 'admin', 'creating an admin -> "account.create" with role "admin" in metadata', JSON.stringify(r[0]?.metadata));
  record(JSON.stringify(r[0].changes.find(c => c.path === 'permissions')?.after) === '["tag:manage"]', '...and the permission it was given (Tag Admin)');

  await clearLog();
  await call('PATCH', `/admin/staff/${staffId}`, superCookie, { permission: 'poll:manage' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.permission_change' && changePaths(r[0]) === 'permissions', 'changing what an admin may do -> "account.permission_change"', r.map(x => x.action).join());
  record(JSON.stringify(r[0].changes[0].before) === '["tag:manage"]' && JSON.stringify(r[0].changes[0].after) === '["poll:manage"]', '...showing the old and new permission (Tag Admin -> Poll Admin)');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('PATCH', `/admin/staff/${staffId}`, superCookie, { name: 'Napat K' });
  await call('PATCH', `/admin/staff/${staffId}/suspend`, superCookie);
  await call('PATCH', `/admin/staff/${staffId}/reactivate`, superCookie);
  r = await rows();
  record(r.map(x => x.action).join() === 'account.update,account.suspend,account.reactivate', 'editing / suspending / reactivating an admin -> update, suspend, reactivate', r.map(x => x.action).join());
  record(r.every(x => x.metadata?.role === 'admin' && x.actor.email === 'super@example.com'), '...all marked as an admin account, done by the super admin');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  const staffDoc = await Account.findById(staffId);
  await createSession(staffDoc!._id, {});
  await createSession(staffDoc!._id, {});
  await clearLog();
  const signOut = await call('POST', `/admin/staff/${staffId}/sign-out`, superCookie);
  r = await rows();
  record(signOut.status === 200 && r.length === 1 && r[0].action === 'account.sign_out_all' && r[0].metadata?.sessionsRevoked === 2, 'sign out everywhere -> "account.sign_out_all" recording how many sessions were ended', JSON.stringify(r[0]?.metadata));
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('POST', `/admin/staff/${staffId}/password-link`, superCookie);
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.password_link_sent', 'sending an admin a password link -> "account.password_link_sent"');

  await clearLog();
  await call('DELETE', `/admin/staff/${staffId}`, superCookie);
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.delete' && r[0].metadata?.role === 'admin', 'deleting an admin -> "account.delete" with role "admin"');

  // ===================================================== SELF-SERVICE (not an admin)
  await clearLog();
  const reg = await call('POST', '/auth/register', undefined, { name: 'Wipa Srisuk', email: 'self@example.com', password: 'SecretPass123', confirmPassword: 'SecretPass123', type: 'individual' });
  const selfCookie = (reg.setCookie ?? '').split(';')[0];
  r = await rows();
  record(reg.status === 201 && r.length === 1 && r[0].action === 'account.create' && r[0].actor.type === 'anonymous', 'a vendor registering themselves -> "account.create" by "anonymous" (nobody was signed in yet)', r[0]?.actor.type);
  record(r[0].request?.path === '/api/v1/auth/register', '...with the registration path');

  await clearLog();
  await call('PATCH', '/account/profile', selfCookie, { name: 'Wipa S' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'account.update' && r[0].actor.email === 'self@example.com' && r[0].entityLabel === 'self@example.com', 'a user editing their own profile -> "account.update" by themselves');

  await clearLog();
  await call('PATCH', '/account/notification-settings', selfCookie, { notificationFrequency: 'daily' });
  r = await rows();
  record(r.length === 1 && changePaths(r[0]) === 'notificationFrequency' && r[0].changes[0].before === 'instant' && r[0].changes[0].after === 'daily', 'changing notification settings is recorded (instant -> daily)');

  await clearLog();
  const pw = await call('POST', '/account/change-password', selfCookie, { currentPassword: 'SecretPass123', newPassword: 'BrandNewPass456', confirmNewPassword: 'BrandNewPass456' });
  r = await rows();
  record(pw.status === 200 && r.length === 1 && r[0].action === 'account.password_change', 'changing a password -> "account.password_change"', r.map(x => x.action).join());
  record(changePaths(r[0]) === 'passwordHash' && r[0].changes[0].before === '[REDACTED]' && r[0].changes[0].after === '[REDACTED]', '...only the masked hash (the bookkeeping timestamp is left out)', changePaths(r[0]));
  r.forEach(x => seenActions.add(x.action));

  // ===================================================================== TAGS
  await clearLog();
  const tagRes = await call('POST', '/admin/tags', adminCookie, { name: 'Bridges', facet: 'keyword', aliases: ['bridge'] });
  const tagId: string = tagRes.json.data._id;
  r = await rows();
  record(tagRes.status === 201 && r.length === 1 && r[0].action === 'tag.create' && r[0].entityLabel === 'Bridges' && r[0].actor.email === 'admin@example.com', 'creating a tag -> "tag.create" labelled with its name');
  record(r[0].changes.some(c => c.path === 'aliases' && JSON.stringify(c.after) === '["bridge"]'), '...including its synonyms');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}`, adminCookie, { name: 'Bridges & Roads' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.rename' && r[0].changes[0].before === 'Bridges' && r[0].changes[0].after === 'Bridges & Roads', 'renaming -> "tag.rename" (before/after)');
  r.forEach(x => seenActions.add(x.action));
  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}`, adminCookie, { aliases: ['bridge', 'road'] });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.synonyms_update' && JSON.stringify(r[0].changes[0].before) === '["bridge"]' && JSON.stringify(r[0].changes[0].after) === '["bridge","road"]', 'editing synonyms -> "tag.synonyms_update" with the old and new list');
  r.forEach(x => seenActions.add(x.action));
  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}`, adminCookie, { name: 'Bridges, Roads', aliases: ['bridge'] });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.update' && changePaths(r[0]) === 'aliases,name', 'changing name AND synonyms together -> a plain "tag.update"');
  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}`, adminCookie, { name: 'Bridges, Roads' });
  record((await AuditLog.countDocuments({})) === 0, 'saving a tag with nothing changed records nothing');

  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}/retire`, adminCookie);
  await call('PATCH', `/admin/tags/${tagId}/reactivate`, adminCookie);
  r = await rows();
  record(r.map(x => x.action).join() === 'tag.retire,tag.reactivate' && r[0].changes[0].before === false && r[0].changes[0].after === true, 'retire / reactivate -> "tag.retire" then "tag.reactivate"', r.map(x => x.action).join());
  r.forEach(x => seenActions.add(x.action));
  await clearLog();
  await call('PATCH', `/admin/tags/${tagId}/ingestion-filter`, adminCookie, { value: true });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.ingestion_filter_update', 'toggling the ingestion filter -> "tag.ingestion_filter_update"');
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('POST', '/admin/gov-sites', superCookie, { name: 'Test Site', shortCode: 'TST', deptId: '9999' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.create' && r[0].entityLabel === 'Test Site' && r[0].changes.some(c => c.path === 'facet' && c.after === 'site'), 'adding a government site records the site tag that comes with it (the site itself is not audited)', r.map(x => x.action + ':' + x.entityLabel).join());

  // ======================================================= PROJECT-TAG ASSIGNMENT
  const site = (await GovSite.findOne({ shortCode: 'TST' }))!;
  const siteTag = (await Tag.findOne({ facet: 'site' }))!;
  const tA = await Tag.create({ name: 'Alpha', facet: 'category' });
  const tB = await Tag.create({ name: 'Beta', facet: 'category' });
  const tSoftware = await Tag.create({ name: 'Software', facet: 'category', includeInIngestionFilter: true });
  const work = await Work.create({
    siteId: site._id, projectId: 'P-1', title: 'Repair road lighting', status: 'BIDDING', announceType: 'B0',
    statusHistory: [{ status: 'BIDDING', announceType: 'B0' }], tags: [siteTag._id]
  });
  const workId = work._id.toString();
  record((await AuditLog.countDocuments({ entityType: 'work' })) === 0, 'creating a work (what the ingestion worker does all day) records nothing');

  await clearLog();
  const put1 = await call('PUT', `/admin/works/${workId}/tags`, adminCookie, { tagIds: [tA._id.toString(), tB._id.toString()] });
  r = await rows();
  record(put1.status === 200 && r.length === 1 && r[0].action === 'work.tags_update' && r[0].entityLabel === 'Repair road lighting' && r[0].actor.email === 'admin@example.com', 'admin sets a work\'s tags -> ONE row "work.tags_update" labelled with the work title', r.map(x => x.action).join());
  record(changePaths(r[0]) === 'tags', '...only the tag list is in the diff (the internal "excludedTags" list is not)', changePaths(r[0]));
  record(
    JSON.stringify(r[0].metadata?.tagsAdded?.map((t: any) => t.name).sort()) === '["Alpha","Beta"]' && r[0].metadata?.tagsRemoved?.length === 0,
    '...and metadata holds the tag NAMES added (so the row still reads right after a tag is renamed)',
    JSON.stringify(r[0].metadata?.tagsAdded?.map((t: any) => t.name))
  );
  r.forEach(x => seenActions.add(x.action));

  await clearLog();
  await call('PUT', `/admin/works/${workId}/tags`, adminCookie, { tagIds: [tA._id.toString()] });
  r = await rows();
  record(r.length === 1 && r[0].metadata?.tagsRemoved?.map((t: any) => t.name).join() === 'Beta' && r[0].metadata?.tagsAdded?.length === 0, 'removing a tag records its name under "tagsRemoved"');
  await clearLog();
  await call('PUT', `/admin/works/${workId}/tags`, adminCookie, { tagIds: [tA._id.toString()] });
  record((await AuditLog.countDocuments({})) === 0, 'saving the same tags again records nothing');

  // topic filter ON: an in-scope tag also changes the work's public visibility
  (env as { INGESTION_TOPIC_FILTER_ENABLED: boolean }).INGESTION_TOPIC_FILTER_ENABLED = true;
  await clearLog();
  await call('PUT', `/admin/works/${workId}/tags`, adminCookie, { tagIds: [tA._id.toString(), tSoftware._id.toString()] });
  r = await rows();
  record(r.length === 1 && r[0].action === 'work.tags_update' && changePaths(r[0]) === 'ingestionRelevance,tags', 'with the topic filter on, the change in public visibility is recorded in the same row', changePaths(r[0] ?? { changes: [] }));
  record(r[0].changes.find(c => c.path === 'ingestionRelevance')?.after === 'shown', '...ingestionRelevance became "shown"');
  (env as { INGESTION_TOPIC_FILTER_ENABLED: boolean }).INGESTION_TOPIC_FILTER_ENABLED = false;

  // the ingestion worker's own writes
  await clearLog();
  await audit.asSystem('ingestion-worker', async () => {
    const w = await Work.findById(workId);
    w!.tags.push(tB._id);
    await w!.save();
  });
  r = await rows();
  record(r.length === 1 && r[0].action === 'work.tags_update' && r[0].actor.type === 'system' && r[0].actor.label === 'ingestion-worker', 'a tag the ingestion worker adds IS recorded, attributed to "ingestion-worker"');
  await clearLog();
  await audit.asSystem('ingestion-worker', async () => {
    const w = await Work.findById(workId);
    w!.status = 'AWARDED';
    w!.title = 'Repair road lighting (awarded)';
    w!.budget = 1000;
    await w!.save();
    await Work.updateOne({ _id: workId }, { $set: { description: 'new summary' } });
    await Work.create({ siteId: site._id, projectId: 'P-2', title: 'Another', status: 'BIDDING', announceType: 'B0', statusHistory: [{ status: 'BIDDING', announceType: 'B0' }] });
  });
  record((await AuditLog.countDocuments({})) === 0, 'the worker\'s everyday writes (status, title, price, description, new works) record NOTHING -- no flood');

  // =========================================================== the isDocument fix
  const acctDoc = (await Account.findOne({ email: 'self@example.com' }))!;
  await clearLog();
  const viaDoc = await audit.log({ action: 'test.account_entity', entity: acctDoc });
  record(viaDoc?.entityType === 'account' && viaDoc.entityId === acctDoc._id.toString() && viaDoc.entityLabel === 'self@example.com', 'an Account document works as an audit entity even though Account has its own "type" field');

  // ================================================================ GLOBAL CHECKS
  const allRows = await AuditLog.find({}).lean();
  const expected = [
    'account.create', 'account.update', 'account.suspend', 'account.reactivate', 'account.password_link_sent', 'account.delete',
    'account.sign_out_all', 'account.password_change', 'account.permission_change',
    'tag.create', 'tag.rename', 'tag.synonyms_update', 'tag.retire', 'tag.reactivate', 'tag.ingestion_filter_update',
    'work.tags_update'
  ];
  const missing = expected.filter(a => !seenActions.has(a) && a !== 'account.delete');
  record(missing.length === 0, 'every readable action name in the plan was produced by a real edit', missing.join() || 'all produced');
  record(!allRows.some(x => x.action === 'account.update' && x.changes.some(c => c.path === 'status')), 'no status change was ever logged as a vague "account.update"');

  // --- the secret sweep, over EVERYTHING in the collection (including the setup rows)
  await clearLog();
  const ctxCookie = superCookie;
  await call('POST', '/admin/accounts', ctxCookie, { name: 'Sweep Test', email: 'sweep@example.com', phone: '0833333333' });
  const sweepAcc = (await Account.findOne({ email: 'sweep@example.com' }).select('+passwordHash'))!;
  await Account.updateOne({ _id: sweepAcc._id }, { $set: { passwordHash: 'DirectWriteSecret789' } });
  await call('PATCH', `/admin/accounts/${sweepAcc._id}`, ctxCookie, { phone: '0844444444' });
  const sweep = JSON.stringify([...(await AuditLog.find({}).lean()), ...allRows]);
  const forbidden = ['Password123', 'SecretPass123', 'BrandNewPass456', 'DirectWriteSecret789', '0811111111', '0822222222', '0833333333', '0844444444', '$2a$', '$2b$', '$2y$'];
  const leaked = forbidden.filter(s => sweep.includes(s));
  record(leaked.length === 0, 'SECRET SWEEP: no password, hash or phone number appears anywhere in the audit log', leaked.join() || 'clean');
  const pwEntries = (await AuditLog.find({}).lean()).flatMap(x => x.changes).filter(c => /password/i.test(c.path));
  record(pwEntries.length > 0 && pwEntries.every(c => c.redacted === true && (c.before === undefined || c.before === '[REDACTED]') && (c.after === undefined || c.after === '[REDACTED]')), 'every password-related entry is masked ([REDACTED] or absent)', `${pwEntries.length} entries`);
  record(allRows.every(x => !!x.actor && ['user', 'system', 'anonymous'].includes(x.actor.type)), 'every row has an actor');

  // --- wiring in source
  const workerSrc = fs.readFileSync(path.join(__dirname, '../../src/worker.ts'), 'utf8');
  record(/audit\.asSystem\('ingestion-worker',\s*\(\)\s*=>\s*executePollJob\(job\)\)/.test(workerSrc), 'the worker runs every poll as the named system actor "ingestion-worker"');

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
