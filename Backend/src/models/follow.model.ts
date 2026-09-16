import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export interface IFollow extends Document {
  accountId: Types.ObjectId;
  tagId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FollowSchema = new Schema<IFollow>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    tagId: { type: Schema.Types.ObjectId, ref: 'Tag', required: true, index: true }
  },
  { timestamps: true }
);

FollowSchema.index({ accountId: 1, tagId: 1 }, { unique: true });

export const Follow: Model<IFollow> = mongoose.models.Follow || mongoose.model<IFollow>('Follow', FollowSchema);
