import mongoose, { Model, Schema, Types, Document } from 'mongoose';
import { WorkStatus } from './work.model';

export interface INotification extends Document {
  accountId: Types.ObjectId;
  workId: Types.ObjectId;
  workTitle: string;
  agencyName: string;
  budget?: number;
  method: string;
  status: WorkStatus;
  statusLabel: string;
  matchedTags: string[];
  ingestedDate: Date;
  read: boolean;
  // Whether this notification has already gone out in a daily digest email
  // (see notification.service.ts's sendDailyDigests) -- prevents the same
  // match being re-sent in tomorrow's digest. Irrelevant for accounts on
  // 'instant' frequency, whose email (if any) already went out immediately
  // at creation time -- this only tracks the deferred 'daily' path.
  includedInDigest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true, index: true },
    workTitle: { type: String, required: true },
    agencyName: { type: String, required: true },
    budget: { type: Number, min: 0 },
    method: { type: String, required: true },
    status: { type: String, required: true },
    statusLabel: { type: String, required: true },
    matchedTags: { type: [String], default: [] },
    ingestedDate: { type: Date, required: true },
    read: { type: Boolean, default: false, index: true },
    includedInDigest: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

NotificationSchema.index({ accountId: 1, workId: 1 }, { unique: true });
NotificationSchema.index({ accountId: 1, createdAt: -1 });

export const Notification: Model<INotification> =
  mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);
