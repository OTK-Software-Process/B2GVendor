import { Router } from 'express';
import * as adminAccountController from '../controllers/adminAccount.controller';
import { validate } from '../middlewares/validate.middleware';
import { createVendorSchema, listVendorsQuerySchema, updateVendorSchema } from '../validators/adminAccount.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) -- vendor
// account management, SRS FR-1.5. Only ever acts on vendor ("user") accounts.
export const adminAccountRouter = Router();

adminAccountRouter.get('/', validate(listVendorsQuerySchema, 'query'), asyncHandler(adminAccountController.list));
adminAccountRouter.post('/', validate(createVendorSchema), asyncHandler(adminAccountController.create));
adminAccountRouter.get('/:id', asyncHandler(adminAccountController.getById));
adminAccountRouter.patch('/:id', validate(updateVendorSchema), asyncHandler(adminAccountController.update));
adminAccountRouter.patch('/:id/suspend', asyncHandler(adminAccountController.suspend));
adminAccountRouter.patch('/:id/reactivate', asyncHandler(adminAccountController.reactivate));
adminAccountRouter.post('/:id/password-link', asyncHandler(adminAccountController.sendPasswordLink));
adminAccountRouter.delete('/:id', asyncHandler(adminAccountController.remove));
