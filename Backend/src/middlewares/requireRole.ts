import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AccountRole } from '../models/account.model';
import { AppError } from '../utils/AppError';

export function requireRole(...roles: AccountRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.account) {
      next(AppError.notAuthenticated());
      return;
    }
    if (!roles.includes(req.account.role)) {
      next(AppError.forbidden());
      return;
    }
    // Staff must use a second factor to use the admin area (ASVS V6.3.3). Until the
    // account has set one up, its session reaches nothing here but the setup, which
    // lives under /account/mfa and is not behind a role. Decided from the database
    // on every request, like the role itself.
    if (req.account.mfaSetupRequired) {
      next(AppError.mfaSetupRequired());
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin', 'superadmin');

export const requireSuperAdmin = requireRole('superadmin');
