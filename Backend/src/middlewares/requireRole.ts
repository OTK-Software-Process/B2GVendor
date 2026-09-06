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
    next();
  };
}

export const requireAdmin = requireRole('admin', 'superadmin');

export const requireSuperAdmin = requireRole('superadmin');
