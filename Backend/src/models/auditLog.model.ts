import mongoose, { Schema, Document, Model } from 'mongoose';
import { AuditChange } from '../utils/auditDiff';
import { AuditActor } from '../utils/auditContext';

// One row per audited event. Deliberately schema-flexible:
//   - `action` and `entityType` are FREE STRINGS (no enum), so a new kind of
//     event or a new audited model needs no change here.
//   - `changes` is a field-level before/after diff; `metadata` is any object.
// And append-only: nothing in the application edits or deletes a row, and the
// hooks below refuse if code ever tries to.

export interface IAuditLog extends Document {
  /** What happened, e.g. "account.suspend", "tag.create". Free string. */
  action: string;
  /** What kind of thing it happened to, e.g. "account", "tag", "work". Free string. */
  entityType: string;
  entityId: string;
  /** Human-readable name of the entity at that moment (email, tag name, ...), so a deleted entity is still recognisable. */
  entityLabel?: string;

  /** Who did it: a snapshot taken at the time, so the row survives the actor's deletion. */
  actor: AuditActor;
  ip?: string;
  userAgent?: string;
  /** Groups every row written by the same HTTP request. */
  requestId?: string;
  request?: { method: string; path: string };

  changes: AuditChange[];
  metadata?: Record<string, unknown>;
  /** True when changes or values were cut to stay within the size limits. */
  truncated?: boolean;

  createdAt: Date;
}

const ChangeSchema = new Schema<AuditChange>(
  {
    path: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    redacted: { type: Boolean }
  },
  { _id: false, minimize: false }
);

const ActorSchema = new Schema<AuditActor>(
  {
    type: { type: String, enum: ['user', 'system', 'anonymous'], required: true },
    id: { type: String, index: true },
    email: { type: String },
    name: { type: String },
    role: { type: String },
    label: { type: String }
  },
  { _id: false }
);

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, trim: true, maxlength: 100 },
    entityType: { type: String, required: true, trim: true, maxlength: 100 },
    entityId: { type: String, required: true, trim: true, maxlength: 100 },
    entityLabel: { type: String, trim: true, maxlength: 300 },

    actor: { type: ActorSchema, required: true },
    ip: { type: String, maxlength: 100 },
    userAgent: { type: String, maxlength: 512 },
    requestId: { type: String, maxlength: 64 },
    request: { type: new Schema({ method: String, path: String }, { _id: false }) },

    changes: { type: [ChangeSchema], default: [] },
    metadata: { type: Schema.Types.Mixed },
    truncated: { type: Boolean }
  },
  {
    // createdAt only: there is never an "updated" moment for an append-only log.
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false
  }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ 'actor.id': 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ requestId: 1 });

const APPEND_ONLY = 'Audit log entries are append-only and cannot be changed or deleted.';

// Application-level guard. (A database user with write access could still alter
// rows directly -- true tamper-proofing would need DB permissions or an external
// sink -- but nothing in this codebase can.)
AuditLogSchema.pre(
  ['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  function () {
    throw new Error(APPEND_ONLY);
  }
);
AuditLogSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error(APPEND_ONLY);
});
AuditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error(APPEND_ONLY));
  next();
});

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
