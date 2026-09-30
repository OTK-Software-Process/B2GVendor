import { Router } from 'express';
import * as ingestionRunController from '../controllers/ingestionRun.controller';
import * as ingestionSettingsController from '../controllers/ingestionSettings.controller';
import { validate } from '../middlewares/validate.middleware';
import { listRunsQuerySchema } from '../validators/ingestionRun.validator';
import { updateIngestionSettingsSchema } from '../validators/ingestionSettings.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) -- FR-N1.7:
// run history, viewable in the admin panel, filterable by site/source/status.
export const ingestionRouter = Router();

ingestionRouter.get('/runs', validate(listRunsQuerySchema, 'query'), asyncHandler(ingestionRunController.list));
ingestionRouter.get('/runs/:id', asyncHandler(ingestionRunController.getById));
ingestionRouter.get('/jobs/:id', asyncHandler(ingestionRunController.getPollJob));
ingestionRouter.get('/status', asyncHandler(ingestionRunController.getStatus));

// FR-N1.2: the automatic schedule -- interval (default 24h, minimum 2h) and
// the pause/resume switch. Any Admin may change it; it's ingestion control,
// not source configuration (which stays Super Admin only).
ingestionRouter.get('/settings', asyncHandler(ingestionSettingsController.get));
ingestionRouter.patch(
  '/settings',
  validate(updateIngestionSettingsSchema),
  asyncHandler(ingestionSettingsController.update)
);
