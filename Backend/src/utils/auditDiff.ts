import { Types } from 'mongoose';

// Pure helpers behind the audit log: turn "before" and "after" into a list of
// field-level changes, with secrets masked and values capped. No database or
// request access here, so it is cheap to test exhaustively.

export const REDACTED = '[REDACTED]';

const MAX_CHANGES = 100;
const MAX_VALUE_CHARS = 2000;
const MAX_DEPTH = 8;

// Housekeeping fields that change on every save and say nothing about intent.
const DEFAULT_IGNORED = ['_id', '__v', 'createdAt', 'updatedAt'];

// Any field whose NAME contains one of these is never stored in clear text,
// whichever model it came from. Models can add their own on top (registry).
const SENSITIVE_FRAGMENTS = ['password', 'passwd', 'secret', 'token', 'hash', 'apikey', 'api_key', 'authorization', 'credential'];

export interface AuditChange {
  /** Dotted path of the field, e.g. "businessProfile.companyName". */
  path: string;
  /** Value before the change. Absent when the field did not exist. */
  before?: unknown;
  /** Value after the change. Absent when the field was removed. */
  after?: unknown;
  /** True when the real values were replaced by "[REDACTED]". */
  redacted?: boolean;
}

export interface DiffOptions {
  /** Extra field names/paths to mask, on top of the built-in sensitive names. */
  redact?: readonly string[];
  /** Extra field names/paths to leave out entirely, on top of _id, __v, createdAt, updatedAt. */
  ignore?: readonly string[];
}

export interface DiffResult {
  changes: AuditChange[];
  /** True when changes or values were cut to stay within the size limits. */
  truncated: boolean;
}

function sanitizeKey(key: string): string {
  // Mongo field names cannot safely contain "." or start with "$".
  return key.replace(/\./g, '_').replace(/^\$/, '_');
}

function isObjectId(value: unknown): boolean {
  return value instanceof Types.ObjectId || (typeof value === 'object' && value !== null && (value as { _bsontype?: string })._bsontype === 'ObjectId');
}

/**
 * Converts anything a model can hold (documents, ObjectIds, Dates, Maps, ...)
 * into plain JSON-safe data so two snapshots can be compared and stored.
 */
export function toPlain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isObjectId(value)) return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[binary]';
  if (depth > MAX_DEPTH) return '[nested too deep]';

  const maybeDoc = value as { toObject?: (opts: object) => unknown };
  if (typeof maybeDoc.toObject === 'function') {
    return toPlain(maybeDoc.toObject({ depopulate: true, virtuals: false, getters: false, minimize: false }), depth + 1);
  }
  if (Array.isArray(value)) return value.map(item => toPlain(item, depth + 1));
  if (value instanceof Set) return [...value].map(item => toPlain(item, depth + 1));
  if (value instanceof Map) {
    return toPlain(Object.fromEntries(value as Map<string, unknown>), depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const plain = toPlain(inner, depth + 1);
    if (plain !== undefined) out[sanitizeKey(key)] = plain;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Walks nested objects into "a.b.c" -> leaf. Arrays and empty objects are leaves.
function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  out.set(prefix, value);
}

function flattenSnapshot(snapshot: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (snapshot === undefined || snapshot === null) return out;
  // A bare value (not an object) is recorded under the path "value".
  flatten(isPlainObject(snapshot) ? snapshot : { value: snapshot }, '', out);
  out.delete(''); // an empty object produces no fields
  return out;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function matchesPattern(path: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const lower = path.toLowerCase();
  const last = lower.split('.').pop() ?? lower;
  return lower === p || lower.startsWith(`${p}.`) || last === p;
}

/** True when the field's name marks it as a secret, or a caller listed it. */
export function isSensitivePath(path: string, extra: readonly string[] = []): boolean {
  const last = (path.split('.').pop() ?? path).toLowerCase();
  return SENSITIVE_FRAGMENTS.some(fragment => last.includes(fragment)) || extra.some(pattern => matchesPattern(path, pattern));
}

function isIgnored(path: string, extra: readonly string[] = []): boolean {
  return DEFAULT_IGNORED.some(pattern => matchesPattern(path, pattern)) || extra.some(pattern => matchesPattern(path, pattern));
}

function capValue(value: unknown, flag: { truncated: boolean }): unknown {
  if (typeof value === 'string' && value.length > MAX_VALUE_CHARS) {
    flag.truncated = true;
    return `${value.slice(0, MAX_VALUE_CHARS)}...[truncated]`;
  }
  if (typeof value === 'object' && value !== null) {
    const json = JSON.stringify(value);
    if (json.length > MAX_VALUE_CHARS) {
      flag.truncated = true;
      return `[truncated: ${json.length} characters]`;
    }
  }
  return value;
}

/**
 * Field-level difference between two snapshots.
 *   - before undefined/null  -> every field of `after` is "created"
 *   - after undefined/null   -> every field of `before` is "removed"
 *   - otherwise only fields whose value actually changed are returned
 * Secrets are masked, noise fields are skipped, big values and long change
 * lists are cut (and `truncated` says so).
 */
export function diffSnapshots(before: unknown, after: unknown, options: DiffOptions = {}): DiffResult {
  const flag = { truncated: false };
  const beforeFlat = flattenSnapshot(toPlain(before));
  const afterFlat = flattenSnapshot(toPlain(after));
  const paths = [...new Set([...beforeFlat.keys(), ...afterFlat.keys()])].sort();

  const changes: AuditChange[] = [];
  for (const path of paths) {
    if (isIgnored(path, options.ignore)) continue;

    const hasBefore = beforeFlat.has(path);
    const hasAfter = afterFlat.has(path);
    const vb = beforeFlat.get(path);
    const va = afterFlat.get(path);
    if (hasBefore && hasAfter && stableStringify(vb) === stableStringify(va)) continue;

    if (changes.length >= MAX_CHANGES) {
      flag.truncated = true;
      break;
    }

    const redacted = isSensitivePath(path, options.redact);
    const change: AuditChange = { path };
    if (hasBefore) change.before = redacted ? REDACTED : capValue(vb, flag);
    if (hasAfter) change.after = redacted ? REDACTED : capValue(va, flag);
    if (redacted) change.redacted = true;
    changes.push(change);
  }

  return { changes, truncated: flag.truncated };
}

/** Cleans a free-form object (e.g. metadata): JSON-safe, safe keys, secrets masked. */
export function sanitizeFreeform(value: unknown, extraRedact: readonly string[] = []): unknown {
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}.${i}`));
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        out[key] = isSensitivePath(childPath, extraRedact) ? REDACTED : walk(inner, childPath);
      }
      return out;
    }
    return node;
  };
  const plain = toPlain(value);
  const flag = { truncated: false };
  return capValue(walk(plain, ''), flag);
}
