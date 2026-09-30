import { Router } from 'express';
import * as adminDashboardController from '../controllers/adminDashboard.controller';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) -- read-only
// summary for the admin landing page.
export const adminDashboardRouter = Router();

adminDashboardRouter.get('/', asyncHandler(adminDashboardController.get));
