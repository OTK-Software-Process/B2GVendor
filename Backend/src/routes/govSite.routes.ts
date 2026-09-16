import { Router } from 'express';
import * as govSiteController from '../controllers/govSite.controller';
import { validate } from '../middlewares/validate.middleware';
import { createGovSiteSchema, updateGovSiteSchema, pollSiteSchema } from '../validators/govSite.validator';
import { requireSuperAdmin } from '../middlewares/requireRole';
import { asyncHandler } from '../utils/asyncHandler';

// Fully public -- E4/FR-E4.1: a Visitor browses the government site
// directory (and drills into a site's works) without logging in. Mutating
// and polling actions stay admin-gated below.
export const govSiteRouter = Router();
govSiteRouter.get('/', asyncHandler(govSiteController.list));
govSiteRouter.get('/:id', asyncHandler(govSiteController.getById));

// Mounted under /admin (requireAuth + requireAdmin applied there) --
// FR-N1.9: regular Admins can view the site list and trigger polls; only
// Super Admin may add/edit a site (source configuration).
export const adminGovSiteRouter = Router();
adminGovSiteRouter.post('/', requireSuperAdmin, validate(createGovSiteSchema), asyncHandler(govSiteController.create));
adminGovSiteRouter.patch('/:id', requireSuperAdmin, validate(updateGovSiteSchema), asyncHandler(govSiteController.update));

adminGovSiteRouter.post('/poll-all', asyncHandler(govSiteController.pollAll));
adminGovSiteRouter.post('/:id/poll', validate(pollSiteSchema), asyncHandler(govSiteController.pollOne));
