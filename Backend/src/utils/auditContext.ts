import { AsyncLocalStorage } from 'async_hooks';
import { IAccount } from '../models/account.model';

// Per-request context for the audit log. It is set once by the middleware at
// the start of a request and read by audit.log() wherever that is called from,
// so services and controllers never have to pass the actor, IP or user agent
// down the call chain -- and a caller can never spoof them.

export interface AuditActor {
  /** "user" = a signed-in account, "system" = background work, "anonymous" = nobody signed in. */
  type: 'user' | 'system' | 'anonymous';
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  /** For system actors: which process acted, e.g. "ingestion-worker". */
  label?: string;
}

export interface AuditContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
  request?: { method: string; path: string };
  /**
   * Resolved lazily: the account is only known after the auth middleware has
   * run, which is AFTER this context was created.
   */
  getActor: () => AuditActor | undefined;
  /** True inside audit.withoutAuto(): the automatic plugin stays quiet so a manual audit.log() is the only row. */
  suppressAuto?: boolean;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** A snapshot of who an account is, taken at the moment of the action. */
export function actorFromAccount(account: IAccount): AuditActor {
  return {
    type: 'user',
    id: account._id.toString(),
    email: account.email,
    name: account.name,
    role: account.role
  };
}
