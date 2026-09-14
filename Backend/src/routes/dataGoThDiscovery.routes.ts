import { Router } from 'express';
import * as controller from '../controllers/dataGoThDiscovery.controller';
import { validate } from '../middlewares/validate.middleware';
import {
  packageShowParamsSchema,
  packageSearchQuerySchema,
  datastoreSearchParamsSchema,
  datastoreSearchQuerySchema
} from '../validators/dataGoThDiscovery.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) -- a
// read-only exploration tool over data.go.th's own CKAN API. Not a
// source-config change (that's govSite.routes.ts), so it doesn't need
// Super Admin.
export const dataGoThDiscoveryRouter = Router();

dataGoThDiscoveryRouter.get(
  '/search',
  validate(packageSearchQuerySchema, 'query'),
  asyncHandler(controller.searchPackages)
);

dataGoThDiscoveryRouter.get(
  '/packages/:packageId',
  validate(packageShowParamsSchema, 'params'),
  asyncHandler(controller.showPackage)
);

dataGoThDiscoveryRouter.get(
  '/datastore/:resourceId',
  validate(datastoreSearchParamsSchema, 'params'),
  validate(datastoreSearchQuerySchema, 'query'),
  asyncHandler(controller.searchDatastore)
);
