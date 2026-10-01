import { Router } from 'express';
import * as ingestionRunController from '../controllers/ingestionRun.controller';
import * as ingestionSettingsController from '../controllers/ingestionSettings.controller';
import { validate } from '../middlewares/validate.middleware';
import { requirePollAccess } from '../middlewares/requirePermission';
import { listRunsQuerySchema } from '../validators/ingestionRun.validator';
import { updateIngestionSettingsSchema } from '../validators/ingestionSettings.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted under /admin (requireAuth + requireAdmin applied there) -- FR-N1.7:
// run history, viewable in the admin panel, filterable by site/source/status.
//
// Running and scheduling ingestion belongs to the Poll Admin and Poll-and-Tag
// Admin roles (Super Admin always passes); a Tag Admin gets 403 here.
export const ingestionRouter = Router();

// Whether a poll is running right now. Open to every admin on purpose: it is
// the one fact every admin screen needs to show the "a poll is in progress"
// state, and it changes nothing.
ingestionRouter.get('/status', asyncHandler(ingestionRunController.getStatus));

ingestionRouter.get('/runs', requirePollAccess, validate(listRunsQuerySchema, 'query'), asyncHandler(ingestionRunController.list));
ingestionRouter.get('/runs/:id', requirePollAccess, asyncHandler(ingestionRunController.getById));
ingestionRouter.get('/jobs/:id', requirePollAccess, asyncHandler(ingestionRunController.getPollJob));

// FR-N1.2: the automatic schedule -- interval (default 24h, minimum 2h) and
// the pause/resume switch. Ingestion control, not source configuration (which
// stays Super Admin only).
ingestionRouter.get('/settings', requirePollAccess, asyncHandler(ingestionSettingsController.get));
ingestionRouter.patch(
  '/settings',
  requirePollAccess,
  validate(updateIngestionSettingsSchema),
  asyncHandler(ingestionSettingsController.update)
);
