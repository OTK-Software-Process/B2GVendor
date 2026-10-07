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
}

/** >>> One line per audited model goes here. <<< */
export const AUDITED_MODELS: Record<string, AuditRegistration> = {
  // Filled in as each model is brought under audit.
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
