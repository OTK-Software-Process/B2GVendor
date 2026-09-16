import { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { ok } from '../utils/apiResponse';
import * as notificationService from '../services/notification.service';

function getAccountId(req: Request): string {
  if (!req.account) throw AppError.notAuthenticated();
  return req.account._id.toString();
}

export async function list(req: Request, res: Response): Promise<void> {
  ok(res, await notificationService.listNotifications(getAccountId(req)));
}

export async function markAsRead(req: Request, res: Response): Promise<void> {
  ok(res, await notificationService.markNotificationAsRead(getAccountId(req), req.params.id));
}

export async function markAllAsRead(req: Request, res: Response): Promise<void> {
  ok(res, await notificationService.markAllNotificationsAsRead(getAccountId(req)));
}
