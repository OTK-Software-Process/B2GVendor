import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type PollJobSource = 'rss' | 'data_go_th' | 'both';
export type PollJobStatus = 'queued' | 'running' | 'done' | 'failed';

// The queue row that lets the API container's "Poll Now" trigger reach the
// separate ingestion-worker container without either one calling the other
// directly -- the worker claims queued rows atomically (FR-N1.10:
// concurrency guard via queueing, not locking a shared in-memory flag).
export interface IPollJob extends Document {
  scope: 'site' | 'all';
  siteId?: Types.ObjectId; // required when scope === 'site'
  source: PollJobSource;
  requestedBy: 'scheduler' | Types.ObjectId;

  status: PollJobStatus;
  claimedAt?: Date;
  finishedAt?: Date;
  resultRunIds: Types.ObjectId[];
  error?: string;

  createdAt: Date;
  updatedAt: Date;
}

const PollJobSchema = new Schema<IPollJob>(
  {
    scope: { type: String, enum: ['site', 'all'], required: true },
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite' },
    source: { type: String, enum: ['rss', 'data_go_th', 'both'], required: true, default: 'both' },
    requestedBy: { type: Schema.Types.Mixed, required: true },

    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', required: true, index: true },
    claimedAt: { type: Date },
    finishedAt: { type: Date },
    resultRunIds: { type: [{ type: Schema.Types.ObjectId, ref: 'IngestionRun' }], default: [] },
    error: { type: String }
  },
  { timestamps: true }
);

PollJobSchema.pre('validate', function (next) {
  if (this.scope === 'site' && !this.siteId) {
    this.invalidate('siteId', 'siteId is required when scope is "site"');
  }
  next();
});

PollJobSchema.index({ status: 1, createdAt: 1 });

export const PollJob: Model<IPollJob> =
  mongoose.models.PollJob || mongoose.model<IPollJob>('PollJob', PollJobSchema);
