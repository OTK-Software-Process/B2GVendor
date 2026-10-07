import mongoose from 'mongoose';
import { AuditChange } from '../utils/auditDiff';

// THE audit registry: which models are audited automatically, and how.
//
// Adding a model to the audit log is one line in AUDITED_MODELS below -- the
// model file itself is not touched:
//
//   Gadget: {},                                   // defaults are fine
//   Account: { label: 'email', redact: ['phone'] }, // with options
//
// The key is the Mongoose MODEL NAME (the string passed to mongoose.model()).
// Every create, update and delete of a registered model is then recorded with a
// field-level diff, who did it, and when -- including secrets masked.

export type AuditOperation = 'create' | 'update' | 'delete';

export interface AuditActionContext {
  operation: AuditOperation;
  entityType: string;
  /** The field-level diff that is about to be recorded. */
  changes: AuditChange[];
  before?: unknown;
  after?: unknown;
  /** The WHOLE entity as last known (after a create/update, before a delete), not just the watched fields. */
  snapshot: Record<string, unknown>;
}

export interface AuditRegistration {
  /** Name used in the log. Default: the model name with a lowercase first letter ("Account" -> "account"). */
  entityType?: string;
  /** Which operations to record. Default: all three. */
  operations?: readonly AuditOperation[];
  /** Fields to leave out of the diff, on top of _id, __v, createdAt, updatedAt. */
  ignore?: readonly string[];
  /** Fields to mask as [REDACTED], on top of the built-in secret names (password, token, hash, ...). */
  redact?: readonly string[];
  /** Human-readable name of an entity: a field name (default: email, then name, then title) or a function. */
  label?: string | ((snapshot: Record<string, unknown>) => string | undefined);
  /**
   * Gives an event a readable name. Default: "<entityType>.<operation>", e.g.
   * "account.update". Return undefined to keep the default. Example: turn a
   * status change into "account.suspend".
   */
  action?: (context: AuditActionContext) => string | undefined;
  /**
   * Audit ONLY these top-level fields; changes to anything else are ignored, and
   * an update that touches none of them records nothing. For models that other
   * code writes constantly (e.g. Work, saved by the ingestion worker) where only
   * a few fields are an admin's business.
   */
  fields?: readonly string[];
  /**
   * Extra context stored in the row's metadata, e.g. human-readable names for ids
   * that appear in the diff. May be async. Must not throw (a failure drops the extras, not the row).
   */
  metadata?: (context: AuditActionContext) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
}

// ---------------------------------------------------------------------------
// Readable event names. Without these every change is just "<entity>.update";
// with them the log reads "account.suspend", "tag.retire", ...
// ---------------------------------------------------------------------------

function onlyPaths(changes: AuditChange[], allowed: string[]): boolean {
  return changes.length > 0 && changes.every(c => allowed.includes(c.path));
}

function accountAction({ operation, changes }: AuditActionContext): string | undefined {
  if (operation !== 'update') return undefined; // create / delete keep "account.create" / "account.delete"
  const status = changes.find(c => c.path === 'status');
  if (status) return status.after === 'suspended' ? 'account.suspend' : 'account.reactivate';
  if (changes.some(c => c.path === 'role')) return 'account.role_change';
  // What an admin may do (Poll Admin / Tag Admin / both): the most security-relevant edit on a staff account.
  if (changes.some(c => c.path === 'permissions')) return 'account.permission_change';
  if (onlyPaths(changes, ['passwordHash'])) return 'account.password_change';
  return undefined;
}

function tagAction({ operation, changes }: AuditActionContext): string | undefined {
  if (operation !== 'update') return undefined;
  const retired = changes.find(c => c.path === 'retired');
  if (retired && onlyPaths(changes, ['retired'])) return retired.after === true ? 'tag.retire' : 'tag.reactivate';
  if (onlyPaths(changes, ['name'])) return 'tag.rename';
  if (onlyPaths(changes, ['aliases'])) return 'tag.synonyms_update';
  if (onlyPaths(changes, ['includeInIngestionFilter'])) return 'tag.ingestion_filter_update';
  return undefined;
}

function workAction({ changes }: AuditActionContext): string | undefined {
  if (changes.some(c => c.path === 'tags')) return 'work.tags_update';
  if (onlyPaths(changes, ['ingestionRelevance'])) return 'work.visibility_update';
  return undefined;
}

// A work's tags are stored as ids, which mean nothing once a tag is renamed or
// retired. Record the NAMES of the tags added/removed as they were at that moment.
async function workTagNames({ changes }: AuditActionContext): Promise<Record<string, unknown> | undefined> {
  const change = changes.find(c => c.path === 'tags');
  if (!change) return undefined;
  const asIds = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
  const before = asIds(change.before);
  const after = asIds(change.after);
  const added = after.filter(id => !before.includes(id));
  const removed = before.filter(id => !after.includes(id));
  if (added.length === 0 && removed.length === 0) return undefined;

  // Looked up lazily by name: importing the Tag model here would compile it
  // before the audit plugin is installed.
  const Tag = mongoose.models.Tag;
  const found = Tag ? await Tag.find({ _id: { $in: [...added, ...removed] } }).select('name facet').lean() : [];
  const byId = new Map((found as unknown as { _id: unknown; name: string; facet: string }[]).map(t => [String(t._id), t]));
  const describe = (id: string) => ({ id, name: byId.get(id)?.name, facet: byId.get(id)?.facet });
  return { tagsAdded: added.map(describe), tagsRemoved: removed.map(describe) };
}

/** >>> One line per audited model goes here. <<< */
export const AUDITED_MODELS: Record<string, AuditRegistration> = {
  // Vendor AND admin accounts (same model; the role is recorded in metadata).
  // Contact data is masked: the log says a phone number changed, not what it is.
  Account: {
    label: 'email',
    redact: ['phone'],
    ignore: ['lockedUntil', 'passwordChangedAt'], // bookkeeping that changes with every password write
    action: accountAction,
    metadata: ({ snapshot }) => ({ role: snapshot.role, accountType: snapshot.type })
  },

  // The tag vocabulary and its synonyms (the `aliases` field), including site
  // tags created with a government site and tags proposed by the AI tagger.
  Tag: {
    label: 'name',
    action: tagAction
  },

  // Project-tag assignment ONLY. The ingestion worker saves works constantly
  // (status, documents, prices ...) -- none of that is an admin's edit -- so
  // just the tag list and public visibility are watched, and only updates.
  Work: {
    label: 'title',
    operations: ['update'],
    fields: ['tags', 'ingestionRelevance'],
    action: workAction,
    metadata: workTagNames
  }
};

// Models added while the process runs (tests, scripts) -- same rules, no file edit.
const runtime = new Map<string, AuditRegistration>();

export function registerAuditedModel(modelName: string, registration: AuditRegistration = {}): void {
  runtime.set(modelName, registration);
}

export function unregisterAuditedModel(modelName: string): void {
  runtime.delete(modelName);
}

export function getAuditRegistration(modelName: string): AuditRegistration | undefined {
  // The log never audits itself: that would record every audit row forever.
  if (modelName === 'AuditLog') return undefined;
  return runtime.get(modelName) ?? AUDITED_MODELS[modelName];
}

export function registeredModelNames(): string[] {
  return [...new Set([...Object.keys(AUDITED_MODELS), ...runtime.keys()])].filter(name => name !== 'AuditLog');
}
