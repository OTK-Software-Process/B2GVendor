import { Types } from 'mongoose';
import { Account } from '../models/account.model';
import { Follow } from '../models/follow.model';
import { IWork, WorkStatus } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { GovSite } from '../models/govSite.model';
import { Notification, INotification } from '../models/notification.model';
import { AppError } from '../utils/AppError';
import { sendNewWorkMatchEmail } from './email.service';
import { logger } from '../utils/logger';

export interface NotificationView {
  id: string;
  workId: string;
  workTitle: string;
  agencyName: string;
  budget: number;
  method: string;
  status: 'INVITATION' | 'BIDDING' | 'EVALUATION' | 'AWARDED' | 'CANCELLED';
  statusLabel: string;
  matchedTags: string[];
  ingestedDate: string;
  read: boolean;
}

const STATUS_FOR_UI: Record<WorkStatus, NotificationView['status']> = {
  PLANNED: 'INVITATION',
  DRAFT_TOR: 'INVITATION',
  BIDDING: 'BIDDING',
  CANCELLED: 'CANCELLED',
  AMENDED: 'EVALUATION',
  AWARDED: 'AWARDED'
};

function toNotificationView(notification: INotification): NotificationView {
  return {
    id: notification._id.toString(),
    workId: notification.workId.toString(),
    workTitle: notification.workTitle,
    agencyName: notification.agencyName,
    budget: notification.budget ?? 0,
    method: notification.method,
    status: STATUS_FOR_UI[notification.status],
    statusLabel: notification.statusLabel,
    matchedTags: notification.matchedTags,
    ingestedDate: notification.ingestedDate.toISOString(),
    read: notification.read
  };
}

export async function listNotifications(accountId: string): Promise<NotificationView[]> {
  const notifications = await Notification.find({ accountId }).sort({ createdAt: -1 }).limit(100);
  return notifications.map(toNotificationView);
}

export async function markNotificationAsRead(accountId: string, notificationId: string): Promise<NotificationView> {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, accountId },
    { $set: { read: true } },
    { new: true }
  );
  if (!notification) throw AppError.notFound('Notification not found.');
  return toNotificationView(notification);
}

export async function markAllNotificationsAsRead(accountId: string): Promise<{ updatedCount: number }> {
  const result = await Notification.updateMany({ accountId, read: false }, { $set: { read: true } });
  return { updatedCount: result.modifiedCount };
}

export async function notifyNewWorkMatches(work: IWork, tagIds: Types.ObjectId[]): Promise<void> {
  const uniqueTagIds = [...new Map(tagIds.map(tagId => [tagId.toString(), tagId])).values()];
  if (uniqueTagIds.length === 0) return;

  try {
    const follows = await Follow.find({ tagId: { $in: uniqueTagIds } }).select('accountId tagId');
    if (follows.length === 0) return;

    const accountIds = [...new Set(follows.map(follow => follow.accountId.toString()))];
    const accounts = await Account.find({ _id: { $in: accountIds }, status: 'active' });
    const tags = await Tag.find({ _id: { $in: uniqueTagIds } }).select('name');
    const site = await GovSite.findById(work.siteId).select('name');
    const tagNames = new Map(tags.map(tag => [tag._id.toString(), tag.name]));
    const accountById = new Map(accounts.map(account => [account._id.toString(), account]));

    for (const accountId of accountIds) {
      const account = accountById.get(accountId);
      if (!account) continue;

      const matchedTagNames = [...new Set(
        follows
          .filter(follow => follow.accountId.toString() === accountId)
          .map(follow => tagNames.get(follow.tagId.toString()))
          .filter((name): name is string => Boolean(name))
      )];
      if (matchedTagNames.length === 0) continue;

      await Notification.findOneAndUpdate(
        { accountId: account._id, workId: work._id },
        {
          $set: {
            workTitle: work.title,
            agencyName: site?.name ?? 'Government procurement',
            budget: work.budget,
            method: work.announceType,
            status: work.status,
            statusLabel: work.status,
            matchedTags: matchedTagNames,
            ingestedDate: work.createdAt
          },
          $setOnInsert: { read: false }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      try {
        await sendNewWorkMatchEmail(account.email, account.name, work._id.toString(), matchedTagNames);
      } catch (err) {
        logger.warn('notification', `Failed to notify ${account.email} about work ${work.projectId}`, err);
      }
    }
  } catch (err) {
    logger.warn('notification', `Failed to find followers for work ${work.projectId}`, err);
  }
}
