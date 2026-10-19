import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type IngestionSource = 'rss' | 'data_go_th';
export type IngestionRunStatus = 'running' | 'success' | 'partial' | 'failed';
// Per-item outcome, same vocabulary as upsertWorkFromRssItem's return value
// (plus 'failed', recorded from the catch around that call) and
// enrichWorkFromContractRecord's boolean (true -> 'updated', false -> 'skipped').
export type IngestionItemStatus = 'new' | 'updated' | 'skipped' | 'failed';

// One row per TOR/announcement actually looked at during a run -- what an
// admin needs to answer "which item had the problem?" instead of just a
// pass/fail count. Kept small and un-indexed: a run's item count is bounded
// by the feed itself (e-GP returns at most ~20 items per announce type per
// poll), so this never grows unbounded.
export interface IIngestionRunItemResult {
  title: string;
  projectId?: string;
  announceType?: string;
  status: IngestionItemStatus;
  message?: string;
}

export interface IIngestionRun extends Document {
  siteId: Types.ObjectId;
  source: IngestionSource;
  triggeredBy: 'scheduler' | Types.ObjectId; // Account._id when manually triggered

  status: IngestionRunStatus;
  // 'data_go_th' runs only -- the resource_id actually queried, whether it
  // came from GovSite.dataGoThResourceId directly or was resolved dynamically
  // via package_show (see dataGoThResource.service.ts). Recorded so an admin
  // looking at run history can see which dataset a run actually hit, since
  // that can now change between runs without any config edit.
  resolvedResourceId?: string;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
  errorLog: string[];
  // Per-item breakdown -- see IIngestionRunItemResult above.
  itemResults: IIngestionRunItemResult[];

  startedAt: Date;
  finishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const IngestionRunItemResultSchema = new Schema<IIngestionRunItemResult>(
  {
    title: { type: String, required: true },
    projectId: { type: String },
    announceType: { type: String },
    status: { type: String, enum: ['new', 'updated', 'skipped', 'failed'], required: true },
    message: { type: String }
  },
  { _id: false }
);

const IngestionRunSchema = new Schema<IIngestionRun>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite', required: true, index: true },
    source: { type: String, enum: ['rss', 'data_go_th'], required: true, index: true },
    triggeredBy: { type: Schema.Types.Mixed, required: true },

    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running', required: true, index: true },
    resolvedResourceId: { type: String, trim: true },
    fetchedCount: { type: Number, default: 0 },
    newCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    errorLog: { type: [String], default: [] },
    itemResults: { type: [IngestionRunItemResultSchema], default: [] },

    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

IngestionRunSchema.index({ siteId: 1, startedAt: -1 });

export const IngestionRun: Model<IIngestionRun> =
  mongoose.models.IngestionRun || mongoose.model<IIngestionRun>('IngestionRun', IngestionRunSchema);
