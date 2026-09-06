import mongoose, { Schema, Document, Model } from 'mongoose';

// e-GP announce-type codes -- see testAPI/explore-egp-rss.ts for how these
// were confirmed live. B0/D0 are the spec's "essential minimum".
export type AnnounceType = 'P0' | '15' | 'B0' | 'D0' | 'W0' | 'D1' | 'W1' | 'D2' | 'W2';

export const ALL_ANNOUNCE_TYPES: readonly AnnounceType[] = [
  'P0', '15', 'B0', 'D0', 'W0', 'D1', 'W1', 'D2', 'W2'
] as const;

export interface IGovSite extends Document {
  name: string;
  nameEn?: string;
  shortCode: string;

  // Live source (e-GP RSS) -- required, this is the primary/essential source.
  deptId: string;
  announceTypes: AnnounceType[];

  // Historical/enrichment source (data.go.th) -- optional, not every site has
  // a resolvable CGD contract dataset (see ProjectDescription.md N1 notes).
  dataGoThOrgSlug?: string;
  dataGoThResourceId?: string;

  enabled: boolean;
  requestsPerMinute: number;
  pollIntervalMinutes?: number; // falls back to POLL_DEFAULT_INTERVAL_MINUTES
  nextPollAt?: Date; // maintained by the worker's scheduler loop

  createdAt: Date;
  updatedAt: Date;
}

const GovSiteSchema = new Schema<IGovSite>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    nameEn: { type: String, trim: true, maxlength: 200 },
    shortCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20, unique: true },

    deptId: { type: String, required: true, trim: true, unique: true },
    announceTypes: {
      type: [{ type: String, enum: ALL_ANNOUNCE_TYPES }],
      default: ['B0', 'D0']
    },

    dataGoThOrgSlug: { type: String, trim: true },
    dataGoThResourceId: { type: String, trim: true },

    enabled: { type: Boolean, default: true, required: true, index: true },
    requestsPerMinute: { type: Number, default: 60, min: 1, max: 600 },
    pollIntervalMinutes: { type: Number, min: 1 },
    nextPollAt: { type: Date, index: true }
  },
  { timestamps: true }
);

export const GovSite: Model<IGovSite> =
  mongoose.models.GovSite || mongoose.model<IGovSite>('GovSite', GovSiteSchema);
