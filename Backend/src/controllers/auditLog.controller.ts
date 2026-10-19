import { Request, Response } from 'express';
import * as auditLogService from '../services/auditLog.service';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { ListAuditLogQuery } from '../validators/auditLog.validator';

function viewerOf(req: Request): auditLogService.AuditViewer {
  if (!req.account) throw AppError.notAuthenticated();
  return { role: req.account.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  ok(res, await auditLogService.listAuditLog(viewerOf(req), req.query as unknown as ListAuditLogQuery));
}

export async function filters(req: Request, res: Response): Promise<void> {
  ok(res, await auditLogService.getAuditFilters(viewerOf(req)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  ok(res, await auditLogService.getAuditLogEntry(viewerOf(req), req.params.id));
}
