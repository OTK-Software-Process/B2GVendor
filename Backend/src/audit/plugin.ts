/* eslint-disable @typescript-eslint/no-explicit-any */
import { Model, Schema } from 'mongoose';
import { audit } from '../services/audit.service';
import { getAuditContext } from '../utils/auditContext';
import { AuditChange, diffSnapshots, toPlain } from '../utils/auditDiff';
import { logger } from '../utils/logger';
import { AuditOperation, AuditRegistration, getAuditRegistration } from './registry';

// Automatic audit capture. Installed ONCE as a global Mongoose plugin (see
// install.ts) it adds hooks to every schema, but each hook first asks the
// registry "is this model audited?" -- so turning auditing on for a model is a
// registry line, not a change to the model.
//
// What is recorded (when the model is registered):
//   create   save() of a new document, Model.create, insertMany, upserts
//   update   save() of an existing document, updateOne/updateMany,
//            findOneAndUpdate/Replace, replaceOne
//   delete   doc.deleteOne(), Model.deleteOne/deleteMany, findOneAndDelete
//
// Not captured: raw driver access (Model.collection.*) and bulkWrite -- they
// bypass Mongoose middleware. Use audit.log() by hand there.
//
// A failure here NEVER breaks the operation being audited.

const MAX_BULK = 200; // most documents one updateMany/deleteMany will log individually

const UPDATE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne'] as const;
const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const SINGLE_DOC_OPS = new Set<string>(['updateOne', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'findOneAndDelete']);

/** Marks a schema as covered, so verifyAuditSetup() can tell a model compiled before install. */
export const AUDIT_PLUGIN_FLAG = '$auditPlugin';

const hiddenCache = new WeakMap<Schema, string>();

// Fields declared `select: false` (e.g. a password hash) are left out of normal
// reads. The audit log still needs to SEE them change (it records "[REDACTED]"
// for a password change), so audit reads ask for them explicitly.
function hiddenSelection(schema: Schema): string {
  let cached = hiddenCache.get(schema);
  if (cached === undefined) {
    const names: string[] = [];
    schema.eachPath((path, type: any) => {
      if (type?.options?.select === false) names.push(`+${path}`);
    });
    cached = names.join(' ');
    hiddenCache.set(schema, cached);
  }
  return cached;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function configFor(modelName: string | undefined): AuditRegistration | undefined {
  if (!modelName) return undefined; // a sub-document schema, not a model
  if (getAuditContext()?.suppressAuto) return undefined; // inside audit.withoutAuto()
  return getAuditRegistration(modelName);
}

function wants(config: AuditRegistration, operation: AuditOperation): boolean {
  return !config.operations || config.operations.includes(operation);
}

function labelFor(config: AuditRegistration, snapshot: unknown): string | undefined {
  const plain = (toPlain(snapshot) ?? {}) as Record<string, unknown>;
  try {
    if (typeof config.label === 'function') return config.label(plain);
    const fields = config.label ? [config.label] : ['email', 'name', 'title'];
    const hit = fields.map(f => plain[f]).find(v => typeof v === 'string' && v.length > 0);
    return typeof hit === 'string' ? hit : undefined;
  } catch {
    return undefined; // a faulty label function must not lose the audit row
  }
}

async function safely(what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    logger.error('audit', `Automatic audit capture failed (${what}); the operation itself was not affected`, err);
  }
}

function restrictToFields(snapshot: unknown, fields: readonly string[] | undefined): unknown {
  if (!fields || snapshot === undefined || snapshot === null) return snapshot;
  return pickTopLevel(snapshot, new Set(fields));
}

async function record(
  modelName: string,
  config: AuditRegistration,
  operation: AuditOperation,
  id: unknown,
  rawBefore: unknown,
  rawAfter: unknown,
  labelSource: unknown = rawAfter ?? rawBefore
): Promise<void> {
  const entityType = config.entityType ?? lowerFirst(modelName);
  // A model registered with `fields` is audited on those fields only.
  const before = restrictToFields(rawBefore, config.fields);
  const after = restrictToFields(rawAfter, config.fields);

  let action = `${entityType}.${operation}`;
  let extra: Record<string, unknown> | undefined;
  if (config.action || config.metadata) {
    const { changes } = diffSnapshots(before, after, { redact: config.redact, ignore: config.ignore });
    // Nothing changed (so nothing will be logged): do not spend time on names or lookups.
    const unchanged = before != null && after != null && changes.length === 0;
    if (unchanged) return;
    const context = {
      operation,
      entityType,
      changes: changes as AuditChange[],
      before: toPlain(before),
      after: toPlain(after),
      snapshot: (toPlain(labelSource) ?? {}) as Record<string, unknown>
    };
    if (config.action) {
      try {
        action = config.action(context) ?? action;
      } catch {
        /* a faulty action resolver falls back to the default name */
      }
    }
    if (config.metadata) {
      try {
        extra = await config.metadata(context);
      } catch {
        /* faulty extras are dropped; the audit row itself is kept */
      }
    }
  }

  await audit.log({
    action,
    entity: { type: entityType, id, label: labelFor(config, labelSource) },
    before,
    after,
    redact: config.redact,
    ignore: config.ignore,
    metadata: { ...extra, source: 'auto', operation, model: modelName }
  });
}

// "name" and "businessProfile.companyName" -> only the top-level keys that were touched.
function pickTopLevel(snapshot: unknown, keys: Set<string>): Record<string, unknown> {
  const plain = (toPlain(snapshot) ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in plain) out[key] = plain[key];
  return out;
}

// For a model audited on specific fields, read only those fields (plus whatever
// is needed to label the row) instead of whole documents. Not done when the
// label is a function, since we cannot know which fields it reads.
function readProjection(config: AuditRegistration): string | undefined {
  if (!config.fields || typeof config.label === 'function') return undefined;
  const labelFields = config.label ? [config.label] : ['email', 'name', 'title'];
  return [...new Set([...config.fields, ...labelFields])].join(' ');
}

export function auditPlugin(schema: Schema): void {
  (schema as any)[AUDIT_PLUGIN_FLAG] = true;

  // ------------------------------------------------------------------- save
  schema.pre('save', async function (this: any) {
    const modelName: string | undefined = this.constructor?.modelName;
    const config = configFor(modelName);
    if (!config) return;
    const state: Record<string, unknown> = { wasNew: this.isNew };
    this.$locals.audit = state;
    if (this.isNew) return;

    await safely(`${modelName} save: reading previous state`, async () => {
      let touched = new Set<string>(this.modifiedPaths().map((p: string) => p.split('.')[0]));
      // A model watched on specific fields (e.g. Work) is saved very often by other
      // code: skip the extra read unless one of those fields is among the changes.
      if (config.fields) touched = new Set([...touched].filter(key => config.fields!.includes(key)));
      if (touched.size === 0) return;
      const Model = this.constructor as Model<any>;
      const sel = hiddenSelection(schema);
      const prior = await Model.findById(this._id).select(sel).lean();
      if (prior) {
        state.touched = touched;
        state.before = prior;
      }
    });
  });

  schema.post('save', async function (this: any, doc: any) {
    const state = doc.$locals?.audit as { wasNew?: boolean; touched?: Set<string>; before?: unknown } | undefined;
    const modelName: string | undefined = doc.constructor?.modelName;
    const config = configFor(modelName);
    if (!state || !config || !modelName) return;
    delete doc.$locals.audit;

    await safely(`${modelName} save`, async () => {
      if (state.wasNew) {
        if (wants(config, 'create')) await record(modelName, config, 'create', doc._id, undefined, doc);
        return;
      }
      if (!wants(config, 'update') || !state.touched || !state.before) return;
      // Compare only what this save touched: a hydrated document carries defaults
      // that older stored rows lack, and those are not real changes.
      await record(modelName, config, 'update', doc._id, pickTopLevel(state.before, state.touched), pickTopLevel(doc, state.touched), doc);
    });
  });

  // doc.deleteOne() needs no hook of its own: Mongoose runs it as a deleteOne
  // QUERY, so the query-style hooks below already see (and record) it. Hooking
  // the document as well would record every such delete twice.

  // --------------------------------------------------------------- insertMany
  schema.post('insertMany', async function (this: any, docs: any) {
    const modelName: string | undefined = this?.modelName;
    const config = configFor(modelName);
    if (!config || !modelName || !wants(config, 'create')) return;
    await safely(`${modelName} insertMany`, async () => {
      for (const doc of Array.isArray(docs) ? docs : [docs]) {
        await record(modelName, config, 'create', doc._id, undefined, doc);
      }
    });
  });

  // ----------------------------------------------- query-style updates/deletes
  // These do not load documents, so the hook reads the matching ones BEFORE the
  // write and AFTER it, then logs each affected document.
  schema.pre([...UPDATE_OPS, ...DELETE_OPS] as any, async function (this: any) {
    const modelName: string | undefined = this.model?.modelName;
    const config = configFor(modelName);
    if (!config) return;

    const op: string = this.op;
    const isDelete = (DELETE_OPS as readonly string[]).includes(op);
    if (isDelete ? !wants(config, 'delete') : !(wants(config, 'update') || wants(config, 'create'))) return;

    await safely(`${modelName} ${op}: reading previous state`, async () => {
      const single = SINGLE_DOC_OPS.has(op);
      let read = this.model.find(this.getFilter()).limit(single ? 1 : MAX_BULK + 1);
      const sel = hiddenSelection(this.model.schema);
      const projection = readProjection(config);
      if (projection) read = read.select(projection);
      if (sel) read = read.select(sel);
      const sort = this.getOptions?.().sort;
      if (single && sort) read = read.sort(sort);
      const found: any[] = await read.lean();
      const overflow = !single && found.length > MAX_BULK;
      this._audit = { config, isDelete, before: overflow ? found.slice(0, MAX_BULK) : found, overflow };
    });
  });

  schema.post([...UPDATE_OPS, ...DELETE_OPS] as any, async function (this: any, result: any) {
    const state = this._audit as { config: AuditRegistration; isDelete: boolean; before: any[]; overflow: boolean } | undefined;
    if (!state) return;
    this._audit = undefined;

    const Model = this.model as Model<any>;
    const modelName = Model.modelName;
    const { config, isDelete, before, overflow } = state;

    await safely(`${modelName} ${this.op}`, async () => {
      const ids = before.map(doc => doc._id);
      const sel = hiddenSelection(Model.schema);

      if (isDelete) {
        const stillThere = new Set((await Model.find({ _id: { $in: ids } }).select('_id').lean()).map((d: any) => String(d._id)));
        for (const doc of before) {
          if (!stillThere.has(String(doc._id))) await record(modelName, config, 'delete', doc._id, doc, undefined);
        }
      } else {
        let read = Model.find({ _id: { $in: ids } });
        const projection = readProjection(config);
        if (projection) read = read.select(projection);
        if (sel) read = read.select(sel);
        const afterById = new Map((await read.lean()).map((d: any) => [String(d._id), d]));
        if (wants(config, 'update')) {
          for (const doc of before) {
            const after = afterById.get(String(doc._id));
            if (after) await record(modelName, config, 'update', doc._id, doc, after);
          }
        }
        // An upsert that inserted a new document.
        const upsertedId = result?.upsertedId ?? (before.length === 0 && this.getOptions?.().upsert ? result?._id : undefined);
        if (upsertedId && wants(config, 'create')) {
          let created = Model.findById(upsertedId);
          if (sel) created = created.select(sel);
          const doc: any = await created.lean();
          if (doc) await record(modelName, config, 'create', doc._id, undefined, doc);
        }
      }

      if (overflow) {
        const entityType = config.entityType ?? lowerFirst(modelName);
        await audit.log({
          action: `${entityType}.bulk_${isDelete ? 'delete' : 'update'}`,
          entity: { type: entityType, id: 'bulk' },
          metadata: { source: 'auto', model: modelName, note: `More than ${MAX_BULK} documents matched; only the first ${MAX_BULK} were logged individually.` }
        });
      }
    });
  });
}
