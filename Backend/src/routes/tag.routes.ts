import { Router } from 'express';
import * as tagController from '../controllers/tag.controller';
import { validate } from '../middlewares/validate.middleware';
import { requireTagAccess } from '../middlewares/requirePermission';
import {
  checkDuplicatesSchema,
  createTagSchema,
  listAdminTagsQuerySchema,
  listTagsQuerySchema,
  setIngestionFilterSchema,
  updateTagSchema
} from '../validators/tag.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Public read -- mounted at /tags (Visitors browse/search the taxonomy
// without logging in; following a tag still requires auth, enforced in N3's
// account routes, not here).
export const tagRouter = Router();
tagRouter.get('/', validate(listTagsQuerySchema, 'query'), asyncHandler(tagController.list));

// Admin-only -- mounted under /admin (requireAuth + requireAdmin applied
// there). No merge endpoint by design (FR-N3.4): duplicates are retired, not
// merged.
//
// Managing the tag vocabulary belongs to the Tag Admin and Poll-and-Tag Admin
// roles (Super Admin always passes). The check runs BEFORE any handler: a
// requirePermission placed after the handler would never stop anything.
export const adminTagRouter = Router();
adminTagRouter.use(requireTagAccess);

adminTagRouter.get('/', validate(listAdminTagsQuerySchema, 'query'), asyncHandler(tagController.listAdmin));
adminTagRouter.post('/check-duplicates', validate(checkDuplicatesSchema), asyncHandler(tagController.checkDuplicates));
adminTagRouter.post('/', validate(createTagSchema), asyncHandler(tagController.create));
adminTagRouter.patch('/:id', validate(updateTagSchema), asyncHandler(tagController.update));
adminTagRouter.patch('/:id/retire', asyncHandler(tagController.retire));
adminTagRouter.patch('/:id/reactivate', asyncHandler(tagController.reactivate));
// Flags/unflags this tag as an ingestion topic filter -- see
// Tag.includeInIngestionFilter and ingestion.service.ts's inScopeTagIds.
adminTagRouter.patch(
  '/:id/ingestion-filter',
  validate(setIngestionFilterSchema),
  asyncHandler(tagController.setIngestionFilter)
);
