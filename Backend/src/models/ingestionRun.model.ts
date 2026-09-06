import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type IngestionSource = 'rss' | 'data_go_th';
export type IngestionRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface IIngestionRun extends Document {
  siteId: Types.ObjectId;
  source: IngestionSource;
  triggeredBy: 'scheduler' | Types.ObjectId; // Account._id when manually triggered

  status: IngestionRunStatus;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
  errorLog: string[];

  startedAt: Date;
  finishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const IngestionRunSchema = new Schema<IIngestionRun>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite', required: true, index: true },
    source: { type: String, enum: ['rss', 'data_go_th'], required: true, index: true },
    triggeredBy: { type: Schema.Types.Mixed, required: true },

    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running', required: true, index: true },
    fetchedCount: { type: Number, default: 0 },
    newCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    errorLog: { type: [String], default: [] },

    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

IngestionRunSchema.index({ siteId: 1, startedAt: -1 });

export const IngestionRun: Model<IIngestionRun> =
  mongoose.models.IngestionRun || mongoose.model<IIngestionRun>('IngestionRun', IngestionRunSchema);
