import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/requireRole';
import { adminGovSiteRouter } from './govSite.routes';
import { adminTagRouter } from './tag.routes';
import { ingestionRouter } from './ingestion.routes';
import { dataGoThDiscoveryRouter } from './dataGoThDiscovery.routes';
import { adminDashboardRouter } from './adminDashboard.routes';
import { adminWorkRouter } from './adminWork.routes';
import { adminAccountRouter } from './adminAccount.routes';

export const adminRouter = Router();

// Every admin sub-route requires at least Admin; individual routes tighten
// further to Super Admin where the spec calls for it (see govSite.routes.ts).
adminRouter.use(requireAuth, requireAdmin);

adminRouter.use('/dashboard', adminDashboardRouter);
adminRouter.use('/gov-sites', adminGovSiteRouter);
adminRouter.use('/tags', adminTagRouter);
adminRouter.use('/works', adminWorkRouter);
adminRouter.use('/accounts', adminAccountRouter);
adminRouter.use('/ingestion', ingestionRouter);
adminRouter.use('/data-go-th', dataGoThDiscoveryRouter);
