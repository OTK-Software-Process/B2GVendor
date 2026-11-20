import { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE_NAME } from '../config/cookie';
import { env } from '../config/env';
import { Account, IAccount } from '../models/account.model';
import { Session, hashSessionToken } from '../models/session.model';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

const MINUTE = 60 * 1000;

export const IDLE_TIMEOUT_MESSAGE = 'Your session ended after a period of inactivity. Please sign in again.';

/** How long a session of this account may go without a request (ASVS V7.3.1). */
export function idleTimeoutMs(account: Pick<IAccount, 'role'>): number {
  const staff = account.role === 'admin' || account.role === 'superadmin';
  return (staff ? env.SESSION_IDLE_MINUTES_STAFF : env.SESSION_IDLE_MINUTES_VENDOR) * MINUTE;
}

// Requests the website makes ON ITS OWN, not because the person did anything:
// the admin screens ask "is a poll running?" every few seconds. They are served
// normally but do not count as activity -- otherwise an admin tab left open
// would keep its session alive for ever and the inactivity timeout would never
// trigger. Matched on the path below /api/v1, method GET.
const BACKGROUND_PATHS = new Set(['/admin/ingestion/status']);

function isBackgroundRequest(req: Request): boolean {
  return req.method === 'GET' && BACKGROUND_PATHS.has(req.originalUrl.split('?')[0].replace(/^\/api\/v1/, ''));
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw AppError.notAuthenticated();
    }

    const session = await Session.findOne({ tokenHash: hashSessionToken(raw) });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw AppError.notAuthenticated();
    }

    const account = await Account.findById(session.accountId);
    if (!account) {
      throw AppError.notAuthenticated();
    }
    if (account.status === 'suspended') {
      throw AppError.accountSuspended();
    }

    // Inactivity timeout: too long since this session's last real request ->
    // it is ended on the server (not just refused), so the token is dead even if
    // the browser keeps it.
    const now = new Date();
    const lastActive = session.lastActiveAt ?? session.createdAt ?? now;
    if (now.getTime() - lastActive.getTime() > idleTimeoutMs(account)) {
      await Session.updateOne({ _id: session._id, revokedAt: { $exists: false } }, { revokedAt: now });
      logger.security('info', 'auth.session.idle_timeout', { accountId: String(account._id), role: account.role, sessionId: String(session._id), idleMinutes: Math.round((now.getTime() - lastActive.getTime()) / 60000) });
      throw AppError.notAuthenticated(IDLE_TIMEOUT_MESSAGE);
    }

    req.account = account;
    req.authSession = session;

    if (!isBackgroundRequest(req)) {
      session.lastActiveAt = now;
      await Session.updateOne({ _id: session._id }, { lastActiveAt: now });
    }

    next();
  } catch (err) {
    next(err);
  }
}
