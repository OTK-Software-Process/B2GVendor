import { Router } from "express";
import * as tagController from "../controllers/tag.controller";
import { validate } from "../middlewares/validate.middleware";
import {
  createTagSchema,
  listTagsQuerySchema,
  setIngestionFilterSchema,
} from "../validators/tag.validator";
import { asyncHandler } from "../utils/asyncHandler";
import { requirePermission } from "../middlewares/requirePermission";

// Public read -- mounted at /tags (Visitors browse/search the taxonomy
// without logging in; following a tag still requires auth, enforced in N3's
// account routes, not here).
export const tagRouter = Router();
tagRouter.get(
  "/",
  validate(listTagsQuerySchema, "query"),
  asyncHandler(tagController.list),
  requirePermission("tag:manage"),
);

// Admin-only mutations -- mounted under /admin (requireAuth + requireAdmin
// applied there). No merge endpoint by design (FR-N3.4): duplicates are
// retired, not merged.
export const adminTagRouter = Router();
adminTagRouter.post(
  "/",
  validate(createTagSchema),
  asyncHandler(tagController.create),
  requirePermission("tag:manage", "poll&tag:manage"),
);
adminTagRouter.patch(
  "/:id/retire",
  asyncHandler(tagController.retire),
  requirePermission("tag:manage", "poll&tag:manage"),
);
// Flags/unflags this tag as an ingestion topic filter -- see
// Tag.includeInIngestionFilter and ingestion.service.ts's inScopeTagIds.
adminTagRouter.patch(
  "/:id/ingestion-filter",
  validate(setIngestionFilterSchema),
  asyncHandler(tagController.setIngestionFilter),
  requirePermission("tag:manage", "poll&tag:manage"),
);
