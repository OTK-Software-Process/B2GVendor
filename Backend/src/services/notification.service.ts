import { Types } from 'mongoose';
import { Account } from '../models/account.model';
import { Follow } from '../models/follow.model';
import { IWork, WorkStatus } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { GovSite } from '../models/govSite.model';
import { Notification, INotification } from '../models/notification.model';
import { AppError } from '../utils/AppError';
import { sendNewWorkMatchEmail, sendDailyDigestEmail } from './email.service';
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
    // A paused follow (account/notifications/settings' per-tag mute) is
    // excluded from matching entirely -- no in-app notification, no email.
    const follows = await Follow.find({ tagId: { $in: uniqueTagIds }, paused: { $ne: true } }).select('accountId tagId');
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

      // In-app notification (above) always happens regardless of
      // preferences -- only the EMAIL is gated by account/notifications/
      // settings: off entirely if emailNotificationsEnabled is false, or
      // deferred to the daily digest (sendDailyDigests below) rather than
      // sent here if the account is on 'daily' frequency. The Notification
      // doc's includedInDigest stays false either way it's later picked up
      // for 'daily', and is simply never looked at for 'instant'.
      if (!account.emailNotificationsEnabled) continue;
      if (account.notificationFrequency === 'daily') continue;

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

// Runs once daily (see worker.ts's cron) -- sends ONE summary email per
// account that's on 'daily' frequency and has emailNotificationsEnabled,
// covering every match since the last digest (Notification.includedInDigest
// == false). Accounts with nothing new are skipped entirely -- no empty
// "you have 0 new matches" email. Best-effort per account, matching
// notifyNewWorkMatches's pattern -- one account's email failure must not
// stop the rest, and a failure never blocks re-trying tomorrow (the
// underlying Notification docs are only marked included after a successful
// send).
export async function sendDailyDigests(): Promise<number> {
  const accounts = await Account.find({ notificationFrequency: 'daily', emailNotificationsEnabled: true, status: 'active' });
  let sent = 0;

  for (const account of accounts) {
    try {
      const pending = await Notification.find({ accountId: account._id, includedInDigest: false }).sort({ createdAt: 1 });
      if (pending.length === 0) continue;

      await sendDailyDigestEmail(
        account.email,
        account.name,
        pending.map(n => ({ workId: n.workId.toString(), workTitle: n.workTitle, agencyName: n.agencyName, matchedTags: n.matchedTags }))
      );

      await Notification.updateMany({ _id: { $in: pending.map(n => n._id) } }, { $set: { includedInDigest: true } });
      sent += 1;
    } catch (err) {
      logger.warn('notification', `Failed to send daily digest to ${account.email}`, err);
    }
  }

  return sent;
}
