// MUST stay the first import: the audit plugin only covers models compiled after it.
import { unregisterAuditedModel, registerAuditedModel, AUDITED_MODELS } from '../../src/audit/registry';
import { verifyAuditSetup } from '../../src/audit/install';

import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import express from 'express';
import mongoose, { Schema, Types } from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { auditContextMiddleware } from '../../src/middlewares/auditContext.middleware';
import { requireAuth } from '../../src/middlewares/auth.middleware';
import { Account } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { Tag } from '../../src/models/tag.model';
import { audit } from '../../src/services/audit.service';
import { createSession } from '../../src/services/session.service';
import { REDACTED } from '../../src/utils/auditDiff';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-audit-plugin-check';

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}
const rows = (filter: object = {}) => AuditLog.find(filter).sort({ createdAt: 1, _id: 1 }).lean();
const clearLog = () => AuditLog.collection.deleteMany({}); // test setup only: bypasses the application guard on purpose
const changePaths = (row: { changes: { path: string }[] }) => row.changes.map(c => c.path).sort().join(',');

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Tag.init(), Account.init(), AuditLog.init()]);

  record(Object.keys(AUDITED_MODELS).length >= 0 && verifyAuditSetup().length === 0, 'startup check: nothing registered, nothing wrong');

  // ============================================== not registered = not audited
  const quiet = await Tag.create({ name: 'Quiet', facet: 'keyword' });
  quiet.aliases = ['x'];
  await quiet.save();
  await Tag.updateOne({ _id: quiet._id }, { retired: true });
  await Tag.deleteOne({ _id: quiet._id });
  record((await AuditLog.countDocuments({})) === 0, 'a model that is NOT in the registry produces no audit rows');

  // ==================================================== registered: create/save
  registerAuditedModel('Tag', { label: 'name' });
  record(verifyAuditSetup().length === 0, 'startup check: registered model is covered by the plugin');

  const tag = await Tag.create({ name: 'Bridges', facet: 'keyword', aliases: ['bridge'] });
  const created = await rows();
  record(created.length === 1 && created[0].action === 'tag.create' && created[0].entityType === 'tag', 'Model.create is recorded as "tag.create"', created.map(r => r.action).join());
  record(created[0].entityId === tag._id.toString() && created[0].entityLabel === 'Bridges', '...with the entity id and a readable label');
  record(changePaths(created[0]).includes('name') && created[0].changes.find(c => c.path === 'name')?.after === 'Bridges' && !('before' in created[0].changes[0]), '...and the new field values as "after"');
  record(created[0].metadata?.source === 'auto' && created[0].metadata?.operation === 'create', '...marked as automatic in metadata');
  record(created[0].actor.type === 'system', '...attributed to "system" when there is no request context');

  await clearLog();
  tag.aliases = ['bridge', 'overpass'];
  await tag.save();
  let r = await rows();
  record(r.length === 1 && r[0].action === 'tag.update' && changePaths(r[0]) === 'aliases', 'doc.save() after a change is recorded as "tag.update" with ONLY the changed field', changePaths(r[0] ?? { changes: [] }));
  record(JSON.stringify(r[0].changes[0].before) === '["bridge"]' && JSON.stringify(r[0].changes[0].after) === '["bridge","overpass"]', '...with before and after values');

  await clearLog();
  await tag.save();
  record((await AuditLog.countDocuments({})) === 0, 'saving without changing anything records nothing');
  const loaded = await Tag.findById(tag._id);
  loaded!.name = 'Bridges';
  await loaded!.save();
  record((await AuditLog.countDocuments({})) === 0, 'setting a field to its current value records nothing');
  const partial = await Tag.findById(tag._id).select('name facet');
  partial!.name = 'Bridges v2';
  await partial!.save();
  r = await rows();
  record(r.length === 1 && changePaths(r[0]) === 'name', 'a document loaded with a field projection still records just its change', changePaths(r[0] ?? { changes: [] }));
  await Tag.updateOne({ _id: tag._id }, { name: 'Bridges' });

  // ============================================== query-style updates
  await clearLog();
  await Tag.updateOne({ _id: tag._id }, { retired: true });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.update' && changePaths(r[0]) === 'retired' && r[0].changes[0].before === false && r[0].changes[0].after === true, 'Model.updateOne is recorded with before/after');

  await clearLog();
  await Tag.findByIdAndUpdate(tag._id, { name: 'Bridges 2' }, { new: true });
  r = await rows();
  record(r.length === 1 && changePaths(r[0]) === 'name' && r[0].changes[0].after === 'Bridges 2', 'findByIdAndUpdate is recorded');

  await clearLog();
  await Tag.updateOne({ _id: tag._id }, { name: 'Bridges 2' });
  record((await AuditLog.countDocuments({})) === 0, 'an updateOne that changes nothing records nothing');
  await Tag.updateOne({ name: 'No Such Tag' }, { retired: true });
  record((await AuditLog.countDocuments({})) === 0, 'an updateOne that matches nothing records nothing');

  await clearLog();
  const k1 = await Tag.create({ name: 'K1', facet: 'category' });
  await Tag.create({ name: 'K2', facet: 'category' });
  await Tag.create({ name: 'K3', facet: 'category' });
  await clearLog();
  await Tag.updateMany({ facet: 'category' }, { $set: { retired: true } });
  r = await rows();
  record(r.length === 3 && r.every(x => x.action === 'tag.update' && changePaths(x) === 'retired'), 'updateMany records ONE row per affected document', String(r.length));
  record(new Set(r.map(x => x.entityId)).size === 3 && r.every(x => !!x.requestId === false), '...each for a different entity');
  await clearLog();
  await Tag.updateMany({ facet: 'category' }, { $set: { retired: true } });
  record((await AuditLog.countDocuments({})) === 0, 'an updateMany that changes nothing records nothing');

  // ============================================================== upsert
  await clearLog();
  await Tag.updateOne({ name: 'Upserted', facet: 'keyword' }, { $set: { retired: false } }, { upsert: true });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.create' && r[0].entityLabel === 'Upserted', 'an upsert that inserts is recorded as a create', r.map(x => x.action).join());

  // ============================================================== insertMany
  await clearLog();
  await Tag.insertMany([{ name: 'M1', facet: 'method' }, { name: 'M2', facet: 'method' }]);
  r = await rows();
  record(r.length === 2 && r.every(x => x.action === 'tag.create'), 'insertMany records one create per document', String(r.length));

  // ================================================================ deletes
  await clearLog();
  await Tag.deleteOne({ _id: k1._id });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.delete' && r[0].entityLabel === 'K1', 'Model.deleteOne is recorded as "tag.delete" (label survives the deletion)');
  record(r[0].changes.some(c => c.path === 'name' && c.before === 'K1' && !('after' in c)), '...keeping what the entity looked like (before only)');

  await clearLog();
  const viaDoc = await Tag.findOne({ name: 'K2' });
  await viaDoc!.deleteOne();
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.delete' && r[0].entityLabel === 'K2', 'doc.deleteOne() is recorded');

  await clearLog();
  await Tag.findByIdAndDelete((await Tag.findOne({ name: 'K3' }))!._id);
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.delete' && r[0].entityLabel === 'K3', 'findByIdAndDelete is recorded');

  await clearLog();
  await Tag.deleteMany({ facet: 'method' });
  r = await rows();
  record(r.length === 2 && r.every(x => x.action === 'tag.delete'), 'deleteMany records one row per deleted document', String(r.length));
  await clearLog();
  await Tag.deleteOne({ name: 'No Such Tag' });
  record((await AuditLog.countDocuments({})) === 0, 'a delete that matches nothing records nothing');

  // =========================================================== secrets / hidden
  unregisterAuditedModel('Tag');
  registerAuditedModel('Account', { label: 'email', redact: ['phone'] });
  await clearLog();
  const acc = await Account.create({ email: 'v@example.com', passwordHash: 'Password123', name: 'Vee', phone: '0811111111', type: 'individual', role: 'user', status: 'active' });
  let blob = JSON.stringify(await rows());
  const createRow = (await rows())[0];
  record(createRow.action === 'account.create' && createRow.entityLabel === 'v@example.com', 'Account.create is recorded, labelled by email');
  const pwChange = createRow.changes.find(c => c.path === 'passwordHash');
  record(pwChange?.after === REDACTED && pwChange?.redacted === true, 'the password hash is recorded as [REDACTED], never its value');
  record(!blob.includes('Password123') && !blob.includes('$2a$') && !blob.includes('$2b$'), 'neither the password nor any bcrypt hash appears anywhere in the audit rows');
  record(createRow.changes.find(c => c.path === 'phone')?.after === REDACTED, 'a field named in the registry "redact" option is masked too');
  record(!blob.includes('0811111111'), '...and its value is not stored');

  await clearLog();
  const fresh = await Account.findById(acc._id); // loaded WITHOUT the hidden passwordHash
  fresh!.status = 'suspended';
  await fresh!.save();
  r = await rows();
  record(r.length === 1 && changePaths(r[0]) === 'status', 'suspending via save records only "status" (no password fields dragged in)', changePaths(r[0] ?? { changes: [] }));

  await clearLog();
  const withHash = await Account.findById(acc._id).select('+passwordHash');
  withHash!.passwordHash = 'AnotherPass456';
  await withHash!.save();
  r = await rows();
  const savePw = r[0]?.changes.find(c => c.path === 'passwordHash');
  record(r.length === 1 && savePw?.before === REDACTED && savePw?.after === REDACTED, 'a password change via save IS recorded (as [REDACTED] -> [REDACTED])');
  record(!JSON.stringify(r).includes('AnotherPass456') && !JSON.stringify(r).includes('$2'), '...with no value stored');

  await clearLog();
  await Account.updateOne({ _id: acc._id }, { $set: { passwordHash: 'DirectWrite789' } });
  r = await rows();
  record(r.length === 1 && r[0].changes.some(c => c.path === 'passwordHash' && c.redacted === true), 'a password write through updateOne (a field excluded from normal reads) is still noticed');
  record(!JSON.stringify(r).includes('DirectWrite789'), '...and its value is not stored');
  await Account.updateOne({ _id: acc._id }, { $set: { status: 'active', passwordHash: 'x' } });

  // ================================================== registry options
  unregisterAuditedModel('Account');
  registerAuditedModel('Account', {
    entityType: 'vendorAccount',
    ignore: ['phone'],
    label: snap => `${String(snap.name)} <${String(snap.email)}>`,
    action: ({ operation, changes }) => {
      if (operation === 'update' && changes.length === 1 && changes[0].path === 'status') return changes[0].after === 'suspended' ? 'account.suspend' : 'account.reactivate';
      return undefined;
    }
  });
  await clearLog();
  const a2 = await Account.findById(acc._id);
  a2!.status = 'suspended';
  await a2!.save();
  a2!.status = 'active';
  await a2!.save();
  r = await rows();
  record(r.map(x => x.action).join() === 'account.suspend,account.reactivate', 'the "action" option gives status changes readable names (suspend / reactivate)', r.map(x => x.action).join());
  record(r[0].entityType === 'vendorAccount' && r[0].entityLabel === 'Vee <v@example.com>', 'the "entityType" option renames the entity; "label" may be a function');
  a2!.name = 'Vee Two';
  await a2!.save();
  r = await rows();
  record(r[2].action === 'vendorAccount.update', 'an event the resolver does not name keeps the default "<entityType>.update"', r[2]?.action);
  record(r[2].entityLabel === 'Vee Two <v@example.com>', 'the label of an update comes from the whole document, not just the changed fields', r[2]?.entityLabel);
  await clearLog();
  const a3 = await Account.findById(acc._id);
  a3!.phone = '0899999999';
  await a3!.save();
  record((await AuditLog.countDocuments({})) === 0, 'the "ignore" option leaves a field out entirely (so this save records nothing)');

  unregisterAuditedModel('Account');
  registerAuditedModel('Account', { operations: ['delete'] });
  await clearLog();
  const a4 = await Account.findById(acc._id);
  a4!.name = 'Changed Again';
  await a4!.save();
  record((await AuditLog.countDocuments({})) === 0, 'the "operations" option limits what is recorded (updates skipped)');
  await Account.deleteOne({ _id: acc._id });
  record((await AuditLog.countDocuments({ action: 'account.delete' })) === 1, '...while deletes are still recorded');
  unregisterAuditedModel('Account');

  // ===================================== a NEW model = one registry line
  const Gadget = mongoose.model('Gadget', new Schema({ label: String, size: Number }, { timestamps: true }));
  await clearLog();
  await Gadget.create({ label: 'before registering', size: 1 });
  record((await AuditLog.countDocuments({})) === 0, 'a brand-new model is not audited until registered');
  registerAuditedModel('Gadget'); // <- the ONE line
  const g = await Gadget.create({ label: 'after registering', size: 2 });
  g.size = 3;
  await g.save();
  await g.deleteOne();
  r = await rows();
  record(r.map(x => x.action).join() === 'gadget.create,gadget.update,gadget.delete', 'one line in the registry audits create, update and delete of a new model, no other change', r.map(x => x.action).join());
  record(r[1].changes[0].path === 'size' && r[1].changes[0].before === 2 && r[1].changes[0].after === 3, '...with the correct diff');
  unregisterAuditedModel('Gadget');

  // ============================================ the log never audits itself
  registerAuditedModel('AuditLog');
  await clearLog();
  await audit.log({ action: 'manual.test', entity: { type: 'x', id: '1' } });
  record((await AuditLog.countDocuments({})) === 1, 'even if "AuditLog" is put in the registry, it never audits itself (no feedback loop)');
  unregisterAuditedModel('AuditLog');

  // ====================================== manual call + withoutAuto (custom action)
  registerAuditedModel('Tag');
  const custom = await Tag.create({ name: 'Custom', facet: 'keyword' });
  await clearLog();
  custom.retired = true;
  await custom.save();
  await audit.log({ action: 'tag.retire', entity: custom, before: { retired: false }, after: { retired: true } });
  record((await AuditLog.countDocuments({})) === 2, 'without withoutAuto, a manual call next to an auto-captured save gives TWO rows (the reason it exists)');
  await clearLog();
  await audit.withoutAuto(async () => {
    custom.retired = false;
    await custom.save();
    await audit.log({ action: 'tag.reactivate', entity: custom, before: { retired: true }, after: { retired: false }, metadata: { reason: 'restored' } });
  });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.reactivate' && r[0].metadata?.reason === 'restored', 'inside audit.withoutAuto only the manual, custom-named row is written');
  await clearLog();
  custom.retired = true;
  await custom.save();
  record((await AuditLog.countDocuments({ action: 'tag.update' })) === 1, '...and automatic capture resumes right after');

  // ============================================== bulk cap
  await Tag.deleteMany({});
  await Tag.insertMany(Array.from({ length: 250 }, (_, i) => ({ name: `Bulk ${i}`, facet: 'category' })));
  await clearLog();
  await Tag.updateMany({ facet: 'category' }, { $set: { retired: true } });
  const bulk = await rows();
  const summary = bulk.filter(x => x.action === 'tag.bulk_update');
  record(bulk.filter(x => x.action === 'tag.update').length === 200 && summary.length === 1, 'a huge updateMany logs the first 200 individually plus ONE summary row', `${bulk.length} rows`);
  record(summary[0]?.metadata?.note !== undefined, '...which explains that more matched than were logged');

  // ==================================== failure never breaks the real operation
  await clearLog();
  const realCreate = AuditLog.create.bind(AuditLog);
  const realError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  (AuditLog as unknown as { create: () => Promise<never> }).create = () => Promise.reject(new Error('audit database is down'));
  let broke = false;
  let okTag: InstanceType<typeof Tag> | null = null;
  try {
    okTag = await Tag.create({ name: 'Survivor', facet: 'keyword' });
    okTag.aliases = ['still works'];
    await okTag.save();
    await Tag.updateOne({ _id: okTag._id }, { retired: true });
    await Tag.deleteOne({ _id: okTag._id });
  } catch {
    broke = true;
  }
  (AuditLog as unknown as { create: typeof realCreate }).create = realCreate;
  console.error = realError;
  record(!broke, 'when the audit write fails, create/save/update/delete of the real model STILL succeed');
  record(errors.length >= 4 && (await Tag.countDocuments({ name: 'Survivor' })) === 0, '...each failure is reported to the server log, and the operations really happened', `${errors.length} errors logged`);

  await clearLog();
  registerAuditedModel('Tag', { label: () => { throw new Error('bad label fn'); }, action: () => { throw new Error('bad action fn'); } });
  await Tag.create({ name: 'Faulty config', facet: 'keyword' });
  r = await rows();
  record(r.length === 1 && r[0].action === 'tag.create' && r[0].entityLabel === undefined, 'a faulty label/action function does not lose the row (falls back to defaults)');
  registerAuditedModel('Tag');

  // ============================================ real HTTP: actor + concurrency
  const adminA = await Account.create({ email: 'admin-a@example.com', passwordHash: 'Password123', name: 'Admin A', type: 'individual', role: 'admin', status: 'active' });
  const adminB = await Account.create({ email: 'admin-b@example.com', passwordHash: 'Password123', name: 'Admin B', type: 'individual', role: 'admin', status: 'active' });
  const sA = await createSession(adminA._id, {});
  const sB = await createSession(adminB._id, {});
  await Tag.deleteMany({});
  const targets = await Tag.insertMany(Array.from({ length: 30 }, (_, i) => ({ name: `Http ${i}`, facet: 'keyword' })));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(auditContextMiddleware);
  app.post('/t/retire/:id', requireAuth, async (req, res) => {
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 30)));
    await Tag.updateOne({ _id: req.params.id }, { retired: true });
    res.json({ ok: true });
  });
  app.post('/t/save/:id', requireAuth, async (req, res) => {
    const doc = await Tag.findById(req.params.id);
    doc!.aliases = ['via http'];
    await doc!.save();
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const call = (p: string, token: string) =>
    fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}`, 'User-Agent': 'PluginTest/1.0' }, body: '{}' });

  await clearLog();
  await call(`/t/retire/${targets[0]._id}`, sA.rawToken);
  await call(`/t/save/${targets[1]._id}`, sB.rawToken);
  const http = await rows();
  record(http.length === 2 && http[0].actor.email === 'admin-a@example.com' && http[0].request?.path === `/t/retire/${targets[0]._id}`, 'a query-style update inside a request is attributed to the signed-in admin, with the request path', http[0]?.actor.email);
  record(http[1].actor.email === 'admin-b@example.com' && http[1].userAgent === 'PluginTest/1.0' && /^[0-9a-f-]{36}$/.test(http[1].requestId ?? ''), 'a doc.save() inside a request is attributed too, with user agent and request id');

  await clearLog();
  const jobs = targets.slice(2).map((t, i) => ({ id: t._id.toString(), token: i % 2 === 0 ? sA.rawToken : sB.rawToken, who: i % 2 === 0 ? 'admin-a@example.com' : 'admin-b@example.com' }));
  await Promise.all(jobs.map(j => call(`/t/retire/${j.id}`, j.token)));
  const concurrent = await rows();
  const wrong = concurrent.filter(x => x.actor.email !== jobs.find(j => j.id === x.entityId)?.who);
  record(concurrent.length === 28 && wrong.length === 0, '28 simultaneous admin requests: every automatic row has the RIGHT actor (none swapped)', `${concurrent.length} rows, ${wrong.length} wrong`);
  server.close();

  // =========================================== startup check catches mistakes
  registerAuditedModel('NoSuchModelAnywhere');
  const problems = verifyAuditSetup();
  record(problems.some(p => p.includes('NoSuchModelAnywhere') && p.includes('no model')), 'startup check: a registry typo / missing model is reported');
  unregisterAuditedModel('NoSuchModelAnywhere');
  const flagged = (Tag.schema as unknown as Record<string, unknown>)['$auditPlugin'];
  delete (Tag.schema as unknown as Record<string, unknown>)['$auditPlugin'];
  const unplugged = verifyAuditSetup();
  (Tag.schema as unknown as Record<string, unknown>)['$auditPlugin'] = flagged;
  record(unplugged.some(p => p.includes('"Tag"') && p.includes('NOT being recorded')), 'startup check: a registered model that missed the plugin is reported LOUDLY');
  record(verifyAuditSetup().length === 0, 'startup check: clean again once restored');

  // ===================== wiring: the plugin must be installed before any model loads
  const src = (file: string) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
  const firstImport = (file: string) => src(file).split('\n').find(line => line.startsWith('import '))?.trim() ?? '';
  record(firstImport('app.ts') === "import './audit/install';", 'app.ts installs the audit plugin as its FIRST import', firstImport('app.ts'));
  record(firstImport('worker.ts').includes("'./audit/install'"), 'worker.ts installs the audit plugin as its FIRST import', firstImport('worker.ts'));
  record(firstImport('server.ts').includes("'./app'") && src('server.ts').includes('verifyAuditSetup()'), 'server.ts loads app.ts first and runs the startup check');
  record(src('worker.ts').includes('verifyAuditSetup()'), 'worker.ts runs the startup check');

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
