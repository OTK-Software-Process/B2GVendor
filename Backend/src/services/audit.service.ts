import { AuditLog, IAuditLog } from '../models/auditLog.model';
import { AuditActor, getAuditContext, runWithAuditContext } from '../utils/auditContext';
import { diffSnapshots, sanitizeFreeform } from '../utils/auditDiff';
import { logger } from '../utils/logger';

// The audit log's one entry point:
//
//   await audit.log({
//     action: 'account.suspend',
//     entity: { type: 'account', id: account._id, label: account.email },
//     before: accountBefore,
//     after: accountAfter
//   });
//
// Who did it, from where, and when is filled in automatically from the current
// request (see utils/auditContext.ts) -- callers never pass it, and cannot fake it.

export interface AuditEntityRef {
  /** Free string: "account", "tag", "work", ... */
  type: string;
  id: unknown;
  /** Optional human-readable name (email, tag name, ...). */
  label?: string;
}

export interface AuditLogInput {
  /** Free string describing what happened, e.g. "account.suspend". */
  action: string;
  /** What it happened to: { type, id, label? } or a Mongoose document (type/id/label are inferred). */
  entity: AuditEntityRef | { _id: unknown; constructor: { modelName?: string } };
  /** State before the change (document or plain object). Omit for a create. */
  before?: unknown;
  /** State after the change. Omit for a delete. */
  after?: unknown;
  /** Anything extra worth recording, e.g. { reason: "..." }. Free-form. */
  metadata?: Record<string, unknown>;
  /** Extra field names/paths to mask, on top of the built-in secret names (password, token, hash, ...). */
  redact?: readonly string[];
  /** Extra field names/paths to leave out of the diff. */
  ignore?: readonly string[];
  /** Log even when before and after are identical. By default an unchanged update is not logged. */
  force?: boolean;
  /**
   * By default a failure to write the log is reported to the server log but does
   * NOT throw: the admin action it describes has already happened and cannot be
   * rolled back (no transactions), so failing the request would only mislead.
   * Set true for the rare caller that wants the error.
   */
  strict?: boolean;
}

const MAX_ACTION_LENGTH = 100;

function isDocument(entity: AuditLogInput['entity']): entity is { _id: unknown; constructor: { modelName?: string } } {
  return typeof entity === 'object' && entity !== null && '_id' in entity && !('type' in entity);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function resolveEntity(entity: AuditLogInput['entity']): { type: string; id: string; label?: string } {
  if (isDocument(entity)) {
    const doc = entity as unknown as Record<string, unknown> & { constructor: { modelName?: string } };
    const type = doc.constructor.modelName ? lowerFirst(doc.constructor.modelName) : '';
    const label = [doc.email, doc.name, doc.title].find(v => typeof v === 'string' && v.length > 0) as string | undefined;
    return { type, id: String(doc._id), label };
  }
  const ref = entity as AuditEntityRef;
  return { type: String(ref.type ?? ''), id: ref.id === undefined || ref.id === null ? '' : String(ref.id), label: ref.label };
}

function currentActor(): AuditActor {
  const context = getAuditContext();
  if (!context) return { type: 'system', label: 'system' }; // scripts, workers: no request
  return context.getActor() ?? { type: 'anonymous' };
}

export async function log(input: AuditLogInput): Promise<IAuditLog | null> {
  try {
    const action = String(input.action ?? '').trim();
    if (!action) throw new Error('audit.log: "action" is required');
    if (action.length > MAX_ACTION_LENGTH) throw new Error(`audit.log: "action" is longer than ${MAX_ACTION_LENGTH} characters`);

    const entity = resolveEntity(input.entity);
    if (!entity.type.trim()) throw new Error('audit.log: "entity.type" is required');
    if (!entity.id.trim()) throw new Error('audit.log: "entity.id" is required');

    const { changes, truncated } = diffSnapshots(input.before, input.after, { redact: input.redact, ignore: input.ignore });

    // An update that changed nothing is noise -- unless the caller insists.
    const isUpdate = input.before != null && input.after != null;
    if (isUpdate && changes.length === 0 && !input.force) return null;

    const context = getAuditContext();
    return await AuditLog.create({
      action,
      entityType: entity.type.trim(),
      entityId: entity.id.trim(),
      entityLabel: entity.label,
      actor: currentActor(),
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      request: context?.request,
      changes,
      metadata: input.metadata === undefined ? undefined : (sanitizeFreeform(input.metadata, input.redact) as Record<string, unknown>),
      truncated: truncated || undefined
    });
  } catch (err) {
    if (input.strict) throw err;
    logger.error('audit', `Failed to write audit log entry for "${input?.action}"`, err);
    return null;
  }
}

/**
 * Runs `fn` as a named background actor (e.g. the ingestion worker), for work
 * that has no signed-in user. Anything audited inside is attributed to
 * { type: "system", label }.
 */
export function asSystem<T>(label: string, fn: () => T): T {
  const base = getAuditContext();
  return runWithAuditContext({ ...base, getActor: () => ({ type: 'system', label }) }, fn);
}

export const audit = { log, asSystem };
