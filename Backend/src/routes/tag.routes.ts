import { Router } from 'express';
import * as tagController from '../controllers/tag.controller';
import { validate } from '../middlewares/validate.middleware';
import { createTagSchema, listTagsQuerySchema } from '../validators/tag.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Public read -- mounted at /tags (Visitors browse/search the taxonomy
// without logging in; following a tag still requires auth, enforced in N3's
// account routes, not here).
export const tagRouter = Router();
tagRouter.get('/', validate(listTagsQuerySchema, 'query'), asyncHandler(tagController.list));

// Admin-only mutations -- mounted under /admin (requireAuth + requireAdmin
// applied there). No merge endpoint by design (FR-N3.4): duplicates are
// retired, not merged.
export const adminTagRouter = Router();
adminTagRouter.post('/', validate(createTagSchema), asyncHandler(tagController.create));
adminTagRouter.patch('/:id/retire', asyncHandler(tagController.retire));
