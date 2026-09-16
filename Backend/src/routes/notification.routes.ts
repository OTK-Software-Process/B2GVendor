import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { notificationIdParamsSchema } from '../validators/notification.validator';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get('/', asyncHandler(notificationController.list));
notificationRouter.post('/read-all', asyncHandler(notificationController.markAllAsRead));
notificationRouter.patch(
  '/:id/read',
  validate(notificationIdParamsSchema, 'params'),
  asyncHandler(notificationController.markAsRead)
);
