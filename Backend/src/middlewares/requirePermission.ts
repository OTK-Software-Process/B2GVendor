import { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasPermission, Permission, POLL_PERMISSIONS, TAG_PERMISSIONS } from '../models/account.model';
import { AppError } from '../utils/AppError';

// Super Admin always passes; a plain Admin passes only with one of the given
// permissions. Put it BEFORE the handler -- anything placed after a handler
// that already answered never runs.
export function requirePermission(...permissions: readonly Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const account = req.account;
    if (!account) {
      next(AppError.notAuthenticated());
      return;
    }
    if (!permissions.some(permission => hasPermission(account, permission))) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}

// The two areas an Admin role can be given: running/scheduling polls, and
// managing tags (the vocabulary and the tags on each work).
export const requirePollAccess = requirePermission(...POLL_PERMISSIONS);
export const requireTagAccess = requirePermission(...TAG_PERMISSIONS);
