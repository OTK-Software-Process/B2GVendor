import { Router } from 'express';
import * as auditLogController from '../controllers/auditLog.controller';
import { validate } from '../middlewares/validate.middleware';
import { listAuditLogQuerySchema } from '../validators/auditLog.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there): any admin may
// review the audit log (SRS 2.3). READ-ONLY by construction: there is no POST,
// PATCH, PUT or DELETE here, and the model itself refuses edits and deletes.
export const auditLogRouter = Router();

auditLogRouter.get('/', validate(listAuditLogQuerySchema, 'query'), asyncHandler(auditLogController.list));
// Before "/:id", or "filters" would be read as an id.
auditLogRouter.get('/filters', asyncHandler(auditLogController.filters));
auditLogRouter.get('/:id', asyncHandler(auditLogController.getById));
