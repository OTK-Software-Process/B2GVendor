import { Router } from 'express';
import * as adminStaffController from '../controllers/adminStaff.controller';
import { requireSuperAdmin } from '../middlewares/requireRole';
import { validate } from '../middlewares/validate.middleware';
import { createAdminSchema, listStaffQuerySchema, updateAdminSchema } from '../validators/adminStaff.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there). Managing
// other admins is a higher-risk action than anything else in the panel, so the
// WHOLE router is Super Admin only -- enforced here on the server, not merely
// hidden in the UI (SRS 5.3).
export const adminStaffRouter = Router();

adminStaffRouter.use(requireSuperAdmin);

adminStaffRouter.get('/', validate(listStaffQuerySchema, 'query'), asyncHandler(adminStaffController.list));
adminStaffRouter.post('/', validate(createAdminSchema), asyncHandler(adminStaffController.create));
adminStaffRouter.get('/:id', asyncHandler(adminStaffController.getById));
adminStaffRouter.patch('/:id', validate(updateAdminSchema), asyncHandler(adminStaffController.update));
adminStaffRouter.patch('/:id/suspend', asyncHandler(adminStaffController.suspend));
adminStaffRouter.patch('/:id/reactivate', asyncHandler(adminStaffController.reactivate));
adminStaffRouter.post('/:id/sign-out', asyncHandler(adminStaffController.signOutEverywhere));
adminStaffRouter.post('/:id/password-link', asyncHandler(adminStaffController.sendPasswordLink));
adminStaffRouter.delete('/:id', asyncHandler(adminStaffController.remove));
