import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/requireRole';
import { validate } from '../middlewares/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/apiResponse';
import * as followService from '../services/follow.service';
import { followTagParamsSchema, setTagPausedSchema } from '../validators/follow.validator';
import { AppError } from '../utils/AppError';

export const followRouter = Router();
followRouter.use(requireAuth);

followRouter.get('/tags', asyncHandler(async (req, res) => {
  if (!req.account) throw AppError.notAuthenticated();
  ok(res, await followService.listFollowedTags(req.account._id.toString()));
}));

followRouter.post(
  '/tags/:tagId',
  validate(followTagParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    if (!req.account) throw AppError.notAuthenticated();
    const follow = await followService.followTag(req.account._id.toString(), req.params.tagId);
    ok(res, follow);
  })
);

followRouter.delete(
  '/tags/:tagId',
  validate(followTagParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    if (!req.account) throw AppError.notAuthenticated();
    await followService.unfollowTag(req.account._id.toString(), req.params.tagId);
    ok(res, { unfollowed: true });
  })
);

followRouter.patch(
  '/tags/:tagId/pause',
  validate(followTagParamsSchema, 'params'),
  validate(setTagPausedSchema),
  asyncHandler(async (req, res) => {
    if (!req.account) throw AppError.notAuthenticated();
    const follow = await followService.setTagPaused(req.account._id.toString(), req.params.tagId, req.body.paused);
    ok(res, follow);
  })
);

followRouter.get(
  '/tags/:tagId/followers',
  requireAdmin,
  validate(followTagParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    ok(res, await followService.listFollowersOfTag(req.params.tagId));
  })
);
