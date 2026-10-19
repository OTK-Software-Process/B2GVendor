import cookieParser from 'cookie-parser';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { AUDITED_MODELS } from '../../src/audit/registry';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { auditContextMiddleware } from '../../src/middlewares/auditContext.middleware';
import { requireAuth } from '../../src/middlewares/auth.middleware';
import { Account } from '../../src/models/account.model';
import { AuditLog } from '../../src/models/auditLog.model';
import { Tag } from '../../src/models/tag.model';
import { audit } from '../../src/services/audit.service';
import { createSession } from '../../src/services/session.service';
import { diffSnapshots, REDACTED, sanitizeFreeform } from '../../src/utils/auditDiff';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-audit-core-check';

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const paths = (changes: { path: string }[]) => changes.map(c => c.path).join(',');

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  // This check tests the MANUAL audit.log() API, so it starts from an empty registry:
  // otherwise creating its fixture accounts would add automatic rows. The real
  // registry is covered end to end by audit-registry.check.ts.
  for (const name of Object.keys(AUDITED_MODELS)) delete AUDITED_MODELS[name];

  // ============================================================== diff (pure)
  const create = diffSnapshots(undefined, { name: 'Bridge', facet: 'keyword', aliases: ['a'] });
  record(
    paths(create.changes) === 'aliases,facet,name' && create.changes.every(c => !('before' in c)),
    'create: every field is reported, with only an "after"',
    JSON.stringify(create.changes)
  );
  const remove = diffSnapshots({ name: 'Bridge', facet: 'keyword' }, undefined);
  record(paths(remove.changes) === 'facet,name' && remove.changes.every(c => !('after' in c)), 'delete: every field is reported, with only a "before"');

  const update = diffSnapshots({ name: 'A', status: 'active', phone: '081' }, { name: 'A', status: 'suspended', phone: '081' });
  record(paths(update.changes) === 'status' && update.changes[0].before === 'active' && update.changes[0].after === 'suspended', 'update: only the changed field is reported');
  record(diffSnapshots({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }).changes.length === 0, 'identical snapshots produce no changes');
  record(
    paths(diffSnapshots({ businessProfile: { companyName: 'X', taxId: '1' } }, { businessProfile: { companyName: 'Y', taxId: '1' } }).changes) === 'businessProfile.companyName',
    'nested objects are compared field by field (dotted path)'
  );
  record(
    paths(diffSnapshots({ _id: 1, __v: 1, createdAt: 'a', updatedAt: 'a', name: 'x' }, { _id: 2, __v: 2, createdAt: 'b', updatedAt: 'b', name: 'y' }).changes) === 'name',
    '_id, __v, createdAt and updatedAt are ignored as noise'
  );
  const oid = new Types.ObjectId();
  const typed = diffSnapshots({ when: new Date('2026-01-01T00:00:00Z'), ref: oid }, { when: new Date('2026-02-01T00:00:00Z'), ref: new Types.ObjectId() });
  record(typeof typed.changes.find(c => c.path === 'when')?.after === 'string' && typeof typed.changes.find(c => c.path === 'ref')?.after === 'string', 'Dates and ObjectIds are stored as plain strings');
  const docChange = diffSnapshots(new Tag({ name: 'Old', facet: 'keyword' }), new Tag({ name: 'New', facet: 'keyword' }));
  record(paths(docChange.changes) === 'name', 'Mongoose documents can be passed straight in', paths(docChange.changes));
  const arr = diffSnapshots({ tags: ['a', 'b'] }, { tags: ['a', 'c'] });
  record(arr.changes.length === 1 && JSON.stringify(arr.changes[0].before) === '["a","b"]' && JSON.stringify(arr.changes[0].after) === '["a","c"]', 'arrays are recorded as whole before/after values');
  record(diffSnapshots({ tags: ['a', 'b'] }, { tags: ['a', 'b'] }).changes.length === 0, 'an unchanged array is not reported');
  const nul = diffSnapshots({ phone: undefined }, { phone: null });
  record(nul.changes.length === 1 && nul.changes[0].after === null && !('before' in nul.changes[0]), 'a field going from absent to null is a change');
  record(paths(diffSnapshots('old', 'new').changes) === 'value', 'a bare (non-object) value is recorded under "value"');
  const weirdKeys = diffSnapshots(undefined, { 'a.b': 1, $set: 2 });
  record(paths(weirdKeys.changes) === '_set,a_b', 'keys with "." or a leading "$" are made safe for Mongo', paths(weirdKeys.changes));

  // --- secrets
  const secretBefore = { passwordHash: '$2a$10$REALHASHBEFORE', tokenHash: 'tok-before', apiKey: 'key-before', nested: { clientSecret: 'sec-before', authorization: 'Bearer abc' }, name: 'x' };
  const secretAfter = { passwordHash: '$2a$10$REALHASHAFTER', tokenHash: 'tok-after', apiKey: 'key-after', nested: { clientSecret: 'sec-after', authorization: 'Bearer def' }, name: 'y' };
  const redacted = diffSnapshots(secretBefore, secretAfter);
  const blob = JSON.stringify(redacted);
  record(!/REALHASH|tok-|key-|sec-|Bearer/.test(blob), 'no secret value (password hash, token, key, secret, authorization) ever appears in the output', blob.length > 0 ? 'checked' : '');
  const pw = redacted.changes.find(c => c.path === 'passwordHash');
  record(pw?.before === REDACTED && pw?.after === REDACTED && pw?.redacted === true, 'a changed secret is still reported, as [REDACTED] on both sides');
  record(redacted.changes.find(c => c.path === 'nested.clientSecret')?.redacted === true, 'secrets are caught at any depth');
  record(diffSnapshots({ passwordHash: 'same' }, { passwordHash: 'same' }).changes.length === 0, 'an unchanged secret is not reported at all');
  const extra = diffSnapshots({ phone: '0811111111' }, { phone: '0822222222' }, { redact: ['phone'] });
  record(extra.changes[0].before === REDACTED && !JSON.stringify(extra).includes('08'), 'extra redact names are honoured');
  record(diffSnapshots({ keep: 1, drop: 1 }, { keep: 2, drop: 2 }, { ignore: ['drop'] }).changes.map(c => c.path).join() === 'keep', 'extra ignore names are honoured');
  const freeform = sanitizeFreeform({ reason: 'cleanup', password: 'hunter2', deep: { token: 'abc', ok: 1 }, 'bad.key': 1 }) as Record<string, any>;
  record(freeform.password === REDACTED && freeform.deep.token === REDACTED && freeform.deep.ok === 1 && freeform.reason === 'cleanup', 'free-form metadata gets the same secret masking');

  // --- size limits
  const big = diffSnapshots({ note: 'a' }, { note: 'x'.repeat(5000) });
  record(big.truncated === true && String(big.changes[0].after).length < 2100, 'a huge value is cut and flagged truncated');
  const many = diffSnapshots({}, Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`f${String(i).padStart(3, '0')}`, i])));
  record(many.changes.length === 100 && many.truncated === true, 'more than 100 changes are cut at 100 and flagged truncated', String(many.changes.length));

  // ================================================== audit.log (service)
  const adminAcc = await Account.create({ email: 'admin@example.com', passwordHash: 'Password123', name: 'Admin One', type: 'individual', role: 'admin', status: 'active' });
  const adminB = await Account.create({ email: 'admin-b@example.com', passwordHash: 'Password123', name: 'Admin Two', type: 'individual', role: 'admin', status: 'active' });
  const targetId = new Types.ObjectId();

  const t0 = Date.now();
  const row = await audit.log({
    action: 'account.suspend',
    entity: { type: 'account', id: targetId, label: 'vendor@example.com' },
    before: { status: 'active', passwordHash: 'REAL-HASH-1' },
    after: { status: 'suspended', passwordHash: 'REAL-HASH-1' },
    metadata: { reason: 'spam' }
  });
  const t1 = Date.now();
  record(!!row && row.action === 'account.suspend' && row.entityType === 'account' && row.entityId === targetId.toString() && row.entityLabel === 'vendor@example.com', 'audit.log writes a row (ObjectId id stored as a string)');
  record(paths(row!.changes) === 'status' && row!.changes[0].before === 'active' && row!.changes[0].after === 'suspended', 'the row holds the field-level diff');
  record(row!.metadata?.reason === 'spam', 'metadata is stored');
  record(row!.createdAt.getTime() >= t0 - 5 && row!.createdAt.getTime() <= t1 + 5, 'the timestamp is set by the server at write time');
  record((await AuditLog.countDocuments({})) === 1, 'exactly one row was written');

  const free = await audit.log({ action: 'weird.thing/ไทย 123 !?', entity: { type: 'made-up-entity', id: 'any-id' } });
  record(free?.action === 'weird.thing/ไทย 123 !?' && free?.entityType === 'made-up-entity', 'action and entityType are free strings: anything is accepted, no list to update');
  record(AuditLog.schema.path('action').options.enum === undefined && AuditLog.schema.path('entityType').options.enum === undefined, 'the schema has no enum on action or entityType');

  const tagDoc = await Tag.create({ name: 'Bridges', facet: 'keyword' });
  const viaDoc = await audit.log({ action: 'tag.create', entity: tagDoc, after: tagDoc });
  record(viaDoc?.entityType === 'tag' && viaDoc?.entityId === tagDoc._id.toString() && viaDoc?.entityLabel === 'Bridges', 'passing a Mongoose document infers the entity type, id and label');
  record(viaDoc!.changes.some(c => c.path === 'name' && c.after === 'Bridges') && !viaDoc!.changes.some(c => c.path === '_id'), '...and a document works as the "after" snapshot');

  // --- unchanged updates
  const countBefore = await AuditLog.countDocuments({});
  const noop = await audit.log({ action: 'account.update', entity: { type: 'account', id: 'x1' }, before: { name: 'A' }, after: { name: 'A' } });
  record(noop === null && (await AuditLog.countDocuments({})) === countBefore, 'an update that changed nothing is not logged');
  const forced = await audit.log({ action: 'account.update', entity: { type: 'account', id: 'x1' }, before: { name: 'A' }, after: { name: 'A' }, force: true });
  record(!!forced && forced.changes.length === 0, 'force:true logs it anyway');
  const eventOnly = await audit.log({ action: 'account.password_link_sent', entity: { type: 'account', id: 'x1' } });
  record(!!eventOnly && eventOnly.changes.length === 0, 'an event with no before/after (e.g. "link sent") is always logged');
  const createNoBefore = await audit.log({ action: 'x.create', entity: { type: 'x', id: '1' }, before: null, after: { a: 1 } });
  record(createNoBefore?.changes.length === 1, 'before:null counts as a create, not an unchanged update');

  // --- secrets never reach the database
  const dbText = JSON.stringify(await AuditLog.find({}).lean());
  record(!dbText.includes('REAL-HASH-1'), 'the secret value is not in any stored row');
  const mdRow = await audit.log({ action: 'a.b', entity: { type: 'x', id: '2' }, metadata: { 'bad.key': 1, password: 'hunter2', note: 'ok' } });
  record(mdRow!.metadata?.password === REDACTED && mdRow!.metadata?.bad_key === 1 && !JSON.stringify(await AuditLog.find({}).lean()).includes('hunter2'), 'metadata secrets are masked and unsafe keys renamed');

  // --- validation: never throws by default, throws on request
  const realError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  const badAction = await audit.log({ action: '  ', entity: { type: 'x', id: '1' } });
  const badType = await audit.log({ action: 'a', entity: { type: '', id: '1' } });
  const badId = await audit.log({ action: 'a', entity: { type: 'x', id: '' } });
  const longAction = await audit.log({ action: 'a'.repeat(101), entity: { type: 'x', id: '1' } });
  console.error = realError;
  record([badAction, badType, badId, longAction].every(r => r === null), 'invalid input returns null instead of throwing (the admin action it describes is not broken)');
  record(errors.length === 4, 'each failure is reported to the server log', String(errors.length));
  let strictThrew = false;
  console.error = () => undefined;
  try {
    await audit.log({ action: '', entity: { type: 'x', id: '1' }, strict: true });
  } catch {
    strictThrew = true;
  }
  console.error = realError;
  record(strictThrew, 'strict:true throws on failure');

  // --- caller cannot choose actor/time
  const spoof = await audit.log({
    action: 'spoof.try', entity: { type: 'x', id: '3' },
    ...({ actor: { type: 'user', email: 'ceo@example.com' }, createdAt: new Date('2000-01-01'), ip: '1.2.3.4' } as object)
  });
  record(spoof?.actor.type === 'system' && spoof.actor.email === undefined && spoof.createdAt.getFullYear() >= 2026 && spoof.ip === undefined, 'actor, ip and createdAt passed by a caller are ignored');

  // --- no request context
  record(row!.actor.type === 'system' && row!.actor.label === 'system', 'outside a request (scripts, worker) the actor is "system"');
  const asSys = await audit.asSystem('ingestion-worker', () => audit.log({ action: 'poll.run', entity: { type: 'run', id: 'r1' } }));
  record(asSys?.actor.type === 'system' && asSys.actor.label === 'ingestion-worker', 'audit.asSystem(label, fn) names the background actor');

  // --- append-only
  const victim = row!;
  const expectThrow = async (label: string, fn: () => unknown) => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    record(threw, `append-only: ${label} is refused`);
  };
  await expectThrow('updateOne', () => AuditLog.updateOne({ _id: victim._id }, { action: 'hacked' }));
  await expectThrow('updateMany', () => AuditLog.updateMany({}, { action: 'hacked' }));
  await expectThrow('findOneAndUpdate', () => AuditLog.findOneAndUpdate({ _id: victim._id }, { action: 'hacked' }));
  await expectThrow('replaceOne', () => AuditLog.replaceOne({ _id: victim._id }, { action: 'hacked' } as object));
  await expectThrow('deleteOne', () => AuditLog.deleteOne({ _id: victim._id }));
  await expectThrow('deleteMany', () => AuditLog.deleteMany({}));
  await expectThrow('findOneAndDelete', () => AuditLog.findOneAndDelete({ _id: victim._id }));
  await expectThrow('document.save() on an existing row', async () => {
    const doc = await AuditLog.findById(victim._id);
    doc!.action = 'hacked';
    await doc!.save();
  });
  await expectThrow('document.deleteOne()', async () => (await AuditLog.findById(victim._id))!.deleteOne());
  const intact = await AuditLog.findById(victim._id);
  record(intact?.action === 'account.suspend' && (await AuditLog.countDocuments({})) > 0, 'after all of that, the original row is untouched');

  // ============================================ request context (real HTTP)
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(auditContextMiddleware);
  const loggedRoute = async (req: express.Request, res: express.Response) => {
    await sleep(Math.floor(Math.random() * 40)); // interleave concurrent requests
    await Account.findOne({ email: String(req.headers['x-caller']) });
    const first = await audit.log({
      action: 'test.first', entity: { type: 'probe', id: String(req.headers['x-caller']) },
      metadata: { caller: String(req.headers['x-caller']) },
      ...({ actor: { type: 'user', email: 'evil@example.com' }, ip: '9.9.9.9' } as object)
    });
    await sleep(Math.floor(Math.random() * 20));
    const second = await audit.log({ action: 'test.second', entity: { type: 'probe', id: String(req.headers['x-caller']) } });
    res.json({ first: first?._id, second: second?._id });
  };
  app.post('/t/log', requireAuth, loggedRoute);
  app.post('/t/anon', loggedRoute);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const callRoute = async (path: string, token: string | null, caller: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AuditTest/1.0', 'x-caller': caller, ...(token ? { Cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}) },
      body: '{}'
    });
    return { status: res.status, json: (await res.json()) as { first?: string; second?: string } };
  };

  await AuditLog.collection.deleteMany({}); // test setup only: bypasses the application guard on purpose
  const sessA = await createSession(adminAcc._id, {});
  const sessB = await createSession(adminB._id, {});

  const one = await callRoute('/t/log?search=secret-term', sessA.rawToken, 'admin@example.com');
  const a1 = await AuditLog.findById(one.json.first);
  const a2 = await AuditLog.findById(one.json.second);
  record(a1?.actor.type === 'user' && a1.actor.id === adminAcc._id.toString() && a1.actor.email === 'admin@example.com' && a1.actor.name === 'Admin One' && a1.actor.role === 'admin', 'a request is attributed to the signed-in account (id, email, name, role), found automatically');
  record(/127\.0\.0\.1|::1/.test(a1?.ip ?? ''), 'the real client IP is recorded, not the one the caller tried to pass', a1?.ip);
  record(a1?.userAgent === 'AuditTest/1.0', 'the user agent is recorded');
  record(a1?.request?.method === 'POST' && a1.request.path === '/t/log', 'the request method and path are recorded, WITHOUT the query string', JSON.stringify(a1?.request));
  record(/^[0-9a-f-]{36}$/.test(a1?.requestId ?? '') && a1?.requestId === a2?.requestId, 'two audit rows from one request share a request id');
  record(a1?.actor.email !== 'evil@example.com' && a1?.ip !== '9.9.9.9', 'an actor/ip a handler tries to inject is ignored');

  const two = await callRoute('/t/log', sessA.rawToken, 'admin@example.com');
  const b1 = await AuditLog.findById(two.json.first);
  record(b1?.requestId !== a1?.requestId, 'a different request gets a different request id');

  const anon = await callRoute('/t/anon', null, 'nobody@example.com');
  const an = await AuditLog.findById(anon.json.first);
  record(an?.actor.type === 'anonymous' && an.actor.id === undefined, 'a request with nobody signed in is recorded as "anonymous"');

  // The important one: many overlapping requests must never swap actors.
  const calls = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? { token: sessA.rawToken, caller: 'admin@example.com' } : { token: sessB.rawToken, caller: 'admin-b@example.com' }));
  const outcomes = await Promise.all(calls.map(c => callRoute('/t/log', c.token, c.caller)));
  record(outcomes.every(o => o.status === 200), '40 simultaneous requests all succeeded');
  const probeRows = await AuditLog.find({ 'metadata.caller': { $exists: true }, createdAt: { $gte: new Date(t1) } }).lean();
  const concurrent = probeRows.filter(r => outcomes.some(o => String(o.json.first) === String(r._id)));
  const mixedUp = concurrent.filter(r => r.actor.email !== (r.metadata as { caller: string }).caller);
  record(concurrent.length === 40 && mixedUp.length === 0, 'with 40 overlapping requests, every row has ITS OWN request\'s actor (none swapped)', `${concurrent.length} rows, ${mixedUp.length} mismatched`);
  const secondRows = await AuditLog.find({ _id: { $in: outcomes.map(o => o.json.second) } }).lean();
  record(secondRows.length === 40 && secondRows.every(r => r.actor.email === r.entityId), 'the second log call in each request (after more awaits) also keeps the right actor');
  server.close();

  // ===================================================== wiring in createApp
  const realApp = createApp() as unknown as { _router: { stack: { handle: { name: string } }[] } };
  const names = realApp._router.stack.map(layer => layer.handle?.name);
  const ctxIndex = names.indexOf('auditContextMiddleware');
  record(ctxIndex !== -1, 'createApp() installs the audit context middleware');
  record(ctxIndex > names.indexOf('cookieParser') && ctxIndex < names.indexOf('router'), 'it runs after the body/cookie parsers and before the routes');

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
