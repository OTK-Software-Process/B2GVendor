import { inspect } from 'node:util';
import { getAuditContext } from './auditContext';

// Structured logging (ASVS V16.2.4, V16.4.1; the log inventory is docs/Security.md
// section 13).
//
// Every line is ONE JSON object on stdout (info) or stderr (warn, error):
//
//   {"time":"2026-11-20T10:00:00.000Z","level":"warn","scope":"security",
//    "event":"auth.login.failure","requestId":"…","ip":"203.0.113.9",
//    "reason":"invalid_credentials","email":"s***@example.com"}
//
// - JSON.stringify escapes CR, LF and every control character, so text taken
//   from a request (a URL, a header, an email) can never start a fake log line
//   (log injection, V16.4.1).
// - The line is passed as an ARGUMENT to a fixed '%s' format, never as the
//   format itself: console.log() expands %s / %d / %o in its first string (V1.3.10).
// - Inside a request, the request id and the signed-in actor's id and role are
//   added automatically, so every line of one request can be pulled together.
//   Never the actor's email or name: personal data is logged masked or not at all.
// - Docker collects stdout/stderr; Grafana Alloy ships it to Loki (compose).

type Level = 'info' | 'warn' | 'error';

const MAX_STRING = 4000;

/** An Error as plain JSON: name, message, code, stack. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: typeof err === 'string' ? err : safeInspect(err) };
  const out: Record<string, unknown> = { name: err.name, message: err.message };
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (err.stack) out.stack = err.stack.slice(0, MAX_STRING);
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = serializeError(cause);
  return out;
}

function safeInspect(value: unknown): string {
  try {
    return inspect(value, { depth: 3, breakLength: Infinity }).slice(0, MAX_STRING);
  } catch {
    return '[unprintable]';
  }
}

function contextFields(includeIp: boolean): Record<string, unknown> {
  const context = getAuditContext();
  if (!context) return {};
  const fields: Record<string, unknown> = {};
  if (context.requestId) fields.requestId = context.requestId;
  if (includeIp && context.ip) fields.ip = context.ip;
  try {
    const actor = context.getActor();
    if (actor && actor.type !== 'anonymous') {
      fields.actor = { type: actor.type, ...(actor.id ? { id: actor.id } : {}), ...(actor.role ? { role: actor.role } : {}), ...(actor.label ? { label: actor.label } : {}) };
    }
  } catch {
    // the actor is best effort
  }
  return fields;
}

function stringify(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record, (_key, value) => {
      if (value instanceof Error) return serializeError(value);
      if (typeof value === 'string' && value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…`;
      if (typeof value === 'bigint') return value.toString();
      return value;
    });
  } catch {
    return JSON.stringify({ time: record.time, level: record.level, scope: record.scope, msg: record.msg, meta: safeInspect(record.meta) });
  }
}

function write(level: Level, record: Record<string, unknown>): void {
  const line = stringify(record);
  if (level === 'error') console.error('%s', line);
  else if (level === 'warn') console.warn('%s', line);
  else console.log('%s', line);
}

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  const record: Record<string, unknown> = { time: new Date().toISOString(), level, scope, msg: message, ...contextFields(false) };
  if (meta instanceof Error) record.err = serializeError(meta);
  else if (meta !== undefined && meta !== null && meta !== '') record.meta = meta;
  write(level, record);
}

/**
 * A security event (ASVS V16.3): sign-ins, lockouts, refusals, session and
 * password changes, blocked or limited requests. `event` is a stable dotted name
 * the log store can alert on (docs/Security.md section 13 lists them); `fields`
 * must not hold secrets, and personal data only masked.
 */
function security(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  write(level, { time: new Date().toISOString(), level, scope: 'security', event, ...contextFields(true), ...fields });
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
  security
};
