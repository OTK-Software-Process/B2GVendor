import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/requireRole';
import { govSiteRouter } from './govSite.routes';
import { adminTagRouter } from './tag.routes';
import { ingestionRouter } from './ingestion.routes';

export const adminRouter = Router();

// Every admin sub-route requires at least Admin; individual routes tighten
// further to Super Admin where the spec calls for it (see govSite.routes.ts).
adminRouter.use(requireAuth, requireAdmin);

adminRouter.use('/gov-sites', govSiteRouter);
adminRouter.use('/tags', adminTagRouter);
adminRouter.use('/ingestion', ingestionRouter);
