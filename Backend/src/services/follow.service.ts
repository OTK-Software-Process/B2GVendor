import { Types } from 'mongoose';
import { Account, IAccount } from '../models/account.model';
import { Follow, IFollow } from '../models/follow.model';
import { Tag, ITag } from '../models/tag.model';
import { AppError } from '../utils/AppError';

function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export async function followTag(accountId: string, tagId: string): Promise<IFollow> {
  const tag = await Tag.findOne({ _id: tagId, retired: false });
  if (!tag) throw AppError.notFound('Tag not found.');

  return Follow.findOneAndUpdate(
    { accountId: toObjectId(accountId), tagId: tag._id },
    { $setOnInsert: { accountId: toObjectId(accountId), tagId: tag._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// Idempotent: a tag the user does not follow, or one an Admin has since retired,
// is simply "already unfollowed" (200) -- a user must always be able to drop a
// follow. Only an id that belongs to no tag at all is a mistake (404), as it is
// for following or pausing one.
export async function unfollowTag(accountId: string, tagId: string): Promise<void> {
  const { deletedCount } = await Follow.deleteOne({ accountId: toObjectId(accountId), tagId: toObjectId(tagId) });
  if (deletedCount === 0 && !(await Tag.exists({ _id: tagId }))) throw AppError.notFound('Tag not found.');
}

export async function listFollowedTags(accountId: string): Promise<ITag[]> {
  const follows = await Follow.find({ accountId: toObjectId(accountId) }).select('tagId');
  const tagIds = follows.map(follow => follow.tagId);
  return Tag.find({ _id: { $in: tagIds } }).sort({ facet: 1, name: 1 });
}

// account/notifications/settings' "Per-Tag Pause" toggle -- see
// Follow.paused and notification.service.ts's notifyNewWorkMatches, which
// excludes a paused follow from matching entirely.
export async function setTagPaused(accountId: string, tagId: string, paused: boolean): Promise<IFollow> {
  const follow = await Follow.findOneAndUpdate(
    { accountId: toObjectId(accountId), tagId: toObjectId(tagId) },
    { $set: { paused } },
    { new: true }
  );
  if (!follow) throw AppError.notFound('You are not following this tag.');
  return follow;
}

export async function listPausedTagIds(accountId: string): Promise<string[]> {
  const follows = await Follow.find({ accountId: toObjectId(accountId), paused: true }).select('tagId');
  return follows.map(follow => follow.tagId.toString());
}

export async function listFollowersOfTag(tagId: string): Promise<IAccount[]> {
  const tag = await Tag.findById(tagId);
  if (!tag) throw AppError.notFound('Tag not found.');

  const follows = await Follow.find({ tagId: tag._id }).select('accountId');
  const accountIds = follows.map(follow => follow.accountId);
  return Account.find({ _id: { $in: accountIds }, status: 'active' }).sort({ name: 1 });
}
