import { Router } from "express";
import * as ingestionRunController from "../controllers/ingestionRun.controller";
import { validate } from "../middlewares/validate.middleware";
import { listRunsQuerySchema } from "../validators/ingestionRun.validator";
import { asyncHandler } from "../utils/asyncHandler";
import { requirePermission } from "../middlewares/requirePermission";

// Mounted under /admin (requireAuth + requireAdmin applied there) -- FR-N1.7:
// run history, viewable in the admin panel, filterable by site/source/status.
export const ingestionRouter = Router();

ingestionRouter.get(
  "/runs",
  requirePermission("poll&tag:manage", "poll:manage"),
  validate(listRunsQuerySchema, "query"),
  asyncHandler(ingestionRunController.list),
);
ingestionRouter.get(
  "/runs/:id",
  requirePermission("poll&tag:manage", "poll:manage"),
  asyncHandler(ingestionRunController.getById),
);
ingestionRouter.get(
  "/jobs/:id",
  requirePermission("poll&tag:manage", "poll:manage"),
  asyncHandler(ingestionRunController.getPollJob),
);
