import { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE_NAME } from '../config/cookie';
import { Account } from '../models/account.model';
import { Session, hashSessionToken } from '../models/session.model';
import { AppError } from '../utils/AppError';

const LAST_ACTIVE_REFRESH_MS = 60 * 1000;

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
    if (!account.emailVerified) {
      throw AppError.emailNotVerified();
    }

    req.account = account;
    req.authSession = session;

    const now = Date.now();
    if (now - session.lastActiveAt.getTime() > LAST_ACTIVE_REFRESH_MS) {
      session.lastActiveAt = new Date(now);
      await Session.updateOne({ _id: session._id }, { lastActiveAt: session.lastActiveAt });
    }

    next();
  } catch (err) {
    next(err);
  }
}
