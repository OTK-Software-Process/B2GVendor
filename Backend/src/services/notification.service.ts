import { Types } from 'mongoose';
import { Account } from '../models/account.model';
import { Follow } from '../models/follow.model';
import { IWork } from '../models/work.model';
import { Tag } from '../models/tag.model';
import { sendNewWorkMatchEmail } from './email.service';
import { logger } from '../utils/logger';

export async function notifyNewWorkMatches(work: IWork, tagIds: Types.ObjectId[]): Promise<void> {
  const uniqueTagIds = [...new Map(tagIds.map(tagId => [tagId.toString(), tagId])).values()];
  if (uniqueTagIds.length === 0) return;

  try {
    const follows = await Follow.find({ tagId: { $in: uniqueTagIds } }).select('accountId tagId');
    if (follows.length === 0) return;

    const accountIds = [...new Set(follows.map(follow => follow.accountId.toString()))];
    const accounts = await Account.find({ _id: { $in: accountIds }, status: 'active' });
    const tags = await Tag.find({ _id: { $in: uniqueTagIds } }).select('name');
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
