import { AccountRole } from '../models/account.model';
import { AuditLog } from '../models/auditLog.model';
import { AppError } from '../utils/AppError';
import { maskIpAddress } from '../utils/userAgent';
import { ListAuditLogQuery } from '../validators/auditLog.validator';

// Read side of the audit log. Strictly READ-ONLY: nothing here (or anywhere
// reachable from the API) writes to, edits or deletes a row.
//
// Nothing is hard-coded about WHAT is audited: the filter lists are computed
// from the rows themselves, so a new action or entity type shows up the moment
// it is first recorded.

export interface AuditViewer {
  role: AccountRole;
}

const LIST_CHANGES_CAP = 20; // changes shown inline per row in the list; the detail endpoint returns all
const MAX_ACTORS = 200;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// What this viewer may see. Rows about STAFF accounts (an admin created,
// suspended, given a different permission ...) are Super-Admin only: a regular
// Admin cannot open the staff directory, so the log must not leak it. Entries
// carry the target's role in metadata.role, which is what this keys on.
function scopeFor(viewer: AuditViewer): Record<string, unknown> {
  if (viewer.role === 'superadmin') return {};
  return { $nor: [{ entityType: 'account', 'metadata.role': { $in: ['admin', 'superadmin'] } }] };
}

export interface AuditLogView {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  actor: { type: string; id?: string; email?: string; name?: string; role?: string; label?: string };
  /** Masked (a.b.xx.xx), like the sessions list: the full address stays in the database only. */
  ip?: string;
  userAgent?: string;
  requestId?: string;
  request?: { method?: string; path?: string };
  changeCount: number;
  changes: { path: string; before?: unknown; after?: unknown; redacted?: boolean }[];
  /** True when the list cut `changes` short: the detail endpoint has them all. */
  changesCutShort: boolean;
  metadata?: Record<string, unknown>;
  /** True when the log itself had to trim values/changes to stay within size limits. */
  truncated?: boolean;
}

function toView(row: any, allChanges: boolean): AuditLogView {
  const changes: AuditLogView['changes'] = row.changes ?? [];
  const shown = allChanges ? changes : changes.slice(0, LIST_CHANGES_CAP);
  return {
    id: String(row._id),
    createdAt: row.createdAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    actor: {
      type: row.actor?.type,
      id: row.actor?.id,
      email: row.actor?.email,
      name: row.actor?.name,
      role: row.actor?.role,
      label: row.actor?.label
    },
    ip: maskIpAddress(row.ip),
    userAgent: row.userAgent,
    requestId: row.requestId,
    request: row.request,
    changeCount: changes.length,
    changes: shown,
    changesCutShort: shown.length < changes.length,
    metadata: row.metadata,
    truncated: row.truncated || undefined
  };
}

function buildQuery(viewer: AuditViewer, f: ListAuditLogQuery): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [scopeFor(viewer)];

  if (f.actor) {
    const actor = f.actor;
    clauses.push(
      actor === 'anonymous'
        ? { 'actor.type': 'anonymous' }
        : { $or: [{ 'actor.id': actor }, { 'actor.email': actor.toLowerCase() }, { 'actor.label': actor }] }
    );
  }
  if (f.action?.length) clauses.push({ action: { $in: f.action } });
  if (f.entityType?.length) clauses.push({ entityType: { $in: f.entityType } });
  if (f.entityId) clauses.push({ entityId: f.entityId });
  if (f.from || f.to) {
    clauses.push({ createdAt: { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) } });
  }
  if (f.q) {
    const pattern = new RegExp(escapeRegExp(f.q), 'i');
    clauses.push({
      $or: [{ entityLabel: pattern }, { entityId: pattern }, { 'actor.email': pattern }, { 'actor.name': pattern }, { action: pattern }, { entityType: pattern }]
    });
  }

  const real = clauses.filter(c => Object.keys(c).length > 0);
  return real.length === 0 ? {} : real.length === 1 ? real[0] : { $and: real };
}

export async function listAuditLog(viewer: AuditViewer, filter: ListAuditLogQuery) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 25;
  const query = buildQuery(viewer, filter);
  const direction = filter.sort === 'oldest' ? 1 : -1;

  const [rows, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: direction, _id: direction }) // _id breaks ties so pages never overlap or skip
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AuditLog.countDocuments(query)
  ]);

  return { items: rows.map(row => toView(row, false)), total, page, pageSize };
}

export async function getAuditLogEntry(viewer: AuditViewer, id: string): Promise<AuditLogView> {
  const row = await AuditLog.findOne({ $and: [{ _id: id }, scopeFor(viewer)].filter(c => Object.keys(c).length > 0) }).lean();
  if (!row) throw AppError.notFound('Audit log entry not found.');
  return toView(row, true);
}

export interface AuditActorOption {
  /** Pass this as the "actor" filter. */
  key: string;
  type: string;
  email?: string;
  name?: string;
  role?: string;
  label?: string;
}

// Distinct values that actually occur in the log, for the filter dropdowns.
// Computed from the data, so there is no list to keep up to date.
export async function getAuditFilters(viewer: AuditViewer) {
  const scope = scopeFor(viewer);

  const [actions, entityTypes, actorRows] = await Promise.all([
    AuditLog.distinct('action', scope),
    AuditLog.distinct('entityType', scope),
    AuditLog.aggregate<{ _id: { type: string; id?: string; label?: string }; email?: string; name?: string; role?: string }>([
      { $match: scope },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { type: '$actor.type', id: '$actor.id', label: '$actor.label' },
          // The latest snapshot of each actor wins (a name or role may have changed).
          email: { $first: '$actor.email' },
          name: { $first: '$actor.name' },
          role: { $first: '$actor.role' }
        }
      },
      { $limit: MAX_ACTORS }
    ])
  ]);

  const actors: AuditActorOption[] = actorRows
    .map(row => ({
      key: row._id.type === 'anonymous' ? 'anonymous' : (row._id.id ?? row._id.label ?? row.email ?? ''),
      type: row._id.type,
      email: row.email,
      name: row.name,
      role: row.role,
      label: row._id.label
    }))
    .filter(actor => actor.key)
    .sort((a, b) => (a.email ?? a.label ?? a.type).localeCompare(b.email ?? b.label ?? b.type));

  return {
    actions: (actions as string[]).sort(),
    entityTypes: (entityTypes as string[]).sort(),
    actors
  };
}
