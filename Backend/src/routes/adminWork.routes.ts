import { Router } from 'express';
import * as adminWorkController from '../controllers/adminWork.controller';
import { validate } from '../middlewares/validate.middleware';
import { requireTagAccess } from '../middlewares/requirePermission';
import { listAdminWorksQuerySchema, setWorkTagsSchema } from '../validators/adminWork.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there). Works are
// ingested data -- the only thing an admin edits by hand here is which tags a
// work carries; status and every other field stay source-derived. Curating
// tags is the Tag Admin / Poll-and-Tag Admin role's work (Super Admin always
// passes).
export const adminWorkRouter = Router();
adminWorkRouter.use(requireTagAccess);

adminWorkRouter.get('/', validate(listAdminWorksQuerySchema, 'query'), asyncHandler(adminWorkController.list));
adminWorkRouter.get('/:id', asyncHandler(adminWorkController.getById));
adminWorkRouter.put('/:id/tags', validate(setWorkTagsSchema), asyncHandler(adminWorkController.setTags));
