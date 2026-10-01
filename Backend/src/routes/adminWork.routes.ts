import { Router } from 'express';
import * as adminWorkController from '../controllers/adminWork.controller';
import { validate } from '../middlewares/validate.middleware';
import { listAdminWorksQuerySchema, setWorkTagsSchema } from '../validators/adminWork.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there). Works are
// ingested data -- the only thing an admin edits by hand here is which tags a
// work carries; status and every other field stay source-derived.
export const adminWorkRouter = Router();

adminWorkRouter.get('/', validate(listAdminWorksQuerySchema, 'query'), asyncHandler(adminWorkController.list));
adminWorkRouter.get('/:id', asyncHandler(adminWorkController.getById));
adminWorkRouter.put('/:id/tags', validate(setWorkTagsSchema), asyncHandler(adminWorkController.setTags));
