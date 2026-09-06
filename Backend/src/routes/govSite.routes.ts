import { Router } from 'express';
import * as govSiteController from '../controllers/govSite.controller';
import { validate } from '../middlewares/validate.middleware';
import { createGovSiteSchema, updateGovSiteSchema, pollSiteSchema } from '../validators/govSite.validator';
import { requireSuperAdmin } from '../middlewares/requireRole';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) --
// FR-N1.9: regular Admins can view the site list and trigger polls;
// only Super Admin may add/edit a site (source configuration).
export const govSiteRouter = Router();

govSiteRouter.get('/', asyncHandler(govSiteController.list));
govSiteRouter.get('/:id', asyncHandler(govSiteController.getById));
govSiteRouter.post('/', requireSuperAdmin, validate(createGovSiteSchema), asyncHandler(govSiteController.create));
govSiteRouter.patch('/:id', requireSuperAdmin, validate(updateGovSiteSchema), asyncHandler(govSiteController.update));

govSiteRouter.post('/poll-all', asyncHandler(govSiteController.pollAll));
govSiteRouter.post('/:id/poll', validate(pollSiteSchema), asyncHandler(govSiteController.pollOne));
