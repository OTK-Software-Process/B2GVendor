import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export interface IFollow extends Document {
  accountId: Types.ObjectId;
  tagId: Types.ObjectId;
  // Per-tag mute -- account/notifications/settings' "Per-Tag Pause" toggle.
  // A paused follow is excluded entirely from matching in
  // notification.service.ts's notifyNewWorkMatches (no in-app notification,
  // no email) -- the tag stays followed (still shows in "currently
  // followed", still affects nothing else), just silenced.
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FollowSchema = new Schema<IFollow>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    tagId: { type: Schema.Types.ObjectId, ref: 'Tag', required: true, index: true },
    paused: { type: Boolean, default: false }
  },
  { timestamps: true }
);

FollowSchema.index({ accountId: 1, tagId: 1 }, { unique: true });

export const Follow: Model<IFollow> = mongoose.models.Follow || mongoose.model<IFollow>('Follow', FollowSchema);
