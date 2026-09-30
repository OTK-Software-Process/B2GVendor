import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import {
  DEFAULT_POLL_INTERVAL_MINUTES,
  MIN_POLL_INTERVAL_MINUTES,
  MAX_POLL_INTERVAL_MINUTES
} from '../config/polling';

export const INGESTION_SETTINGS_KEY = 'default';

// Admin-editable ingestion settings -- a singleton (exactly one document,
// key === 'default'), read by both the API (admin > Data Ingestion) and the
// worker's scheduler. Lives in Mongo rather than an env var so an admin can
// change it from the UI without a redeploy.
export interface IIngestionSettings extends Document {
  key: typeof INGESTION_SETTINGS_KEY;

  // How often every enabled site is polled automatically. A GovSite can still
  // carry its own pollIntervalMinutes override, which wins for that site.
  pollIntervalMinutes: number;
  // The pause/resume switch for the automatic schedule (FR-N1.2). Manual
  // "Poll Now" keeps working while paused.
  scheduleEnabled: boolean;

  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const IngestionSettingsSchema = new Schema<IIngestionSettings>(
  {
    key: { type: String, required: true, unique: true, default: INGESTION_SETTINGS_KEY },
    pollIntervalMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_POLL_INTERVAL_MINUTES,
      // The floor is enforced here as well as in the request validator, so no
      // code path (script, future endpoint) can persist a faster schedule.
      min: [MIN_POLL_INTERVAL_MINUTES, 'Polling interval cannot be lower than 2 hours.'],
      max: [MAX_POLL_INTERVAL_MINUTES, 'Polling interval cannot be longer than 30 days.']
    },
    scheduleEnabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Account' }
  },
  { timestamps: true }
);

export const IngestionSettings: Model<IIngestionSettings> =
  mongoose.models.IngestionSettings ||
  mongoose.model<IIngestionSettings>('IngestionSettings', IngestionSettingsSchema);
