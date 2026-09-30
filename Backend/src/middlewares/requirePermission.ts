import { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasPermission, Permission } from '../models/account.model';
import { AppError } from '../utils/AppError';

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const account = req.account;
    if (!account) {
      next(AppError.notAuthenticated());
      return;
    }
    if (!permissions.some((permission) => hasPermission(account, permission))) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}