import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { AnnounceType } from './govSite.model';

// Status is derived only from the e-GP RSS announce-type signal (FR-N4.4) --
// data.go.th enrichment never sets this, it has no status field at all.
export type WorkStatus =
  | 'PLANNED'        // P0 / 15
  | 'DRAFT_TOR'      // B0
  | 'BIDDING'        // D0
  | 'CANCELLED'      // D1
  | 'AMENDED'        // D2
  | 'AWARDED';       // W0

export const STATUS_BY_ANNOUNCE_TYPE: Record<AnnounceType, WorkStatus> = {
  P0: 'PLANNED',
  '15': 'PLANNED',
  B0: 'DRAFT_TOR',
  D0: 'BIDDING',
  D1: 'CANCELLED',
  D2: 'AMENDED',
  W0: 'AWARDED',
  W1: 'CANCELLED',
  W2: 'AMENDED'
};

export type TorLinkType = 'pdf' | 'html' | 'other';

export interface ITorFile {
  announceType: AnnounceType; // which lifecycle stage this document belongs to
  linkType: TorLinkType;
  sourceUrl: string; // the RSS <link> as-is
  storageKey?: string; // set once a 'pdf' link has been downloaded and stored
  filename?: string;
  downloadedAt?: Date;
  // Set when a later item for the SAME announceType arrives with a different
  // link (e.g. a corrected/re-issued document) -- lets the frontend show
  // only the current document per stage while still keeping history.
  supersededAt?: Date;
}

export interface IStatusHistoryEntry {
  status: WorkStatus;
  announceType: AnnounceType;
  changedAt: Date;
  note?: string;
}

export interface IWork extends Document {
  siteId: Types.ObjectId;
  projectId: string; // the e-GP project identifier -- stable key for upsert

  title: string;
  status: WorkStatus;
  announceType: AnnounceType;
  pubDate?: Date;

  torFiles: ITorFile[];
  statusHistory: IStatusHistoryEntry[];

  // data.go.th enrichment (optional, filled in after award -- FR-N1.3a)
  budget?: number;
  contractNumber?: string;
  contractDate?: Date;
  winnerName?: string;
  winnerTin?: string;
  enrichedAt?: Date;

  tags: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

const TorFileSchema = new Schema<ITorFile>(
  {
    announceType: { type: String, required: true },
    linkType: { type: String, enum: ['pdf', 'html', 'other'], required: true },
    sourceUrl: { type: String, required: true },
    storageKey: { type: String },
    filename: { type: String },
    downloadedAt: { type: Date },
    supersededAt: { type: Date }
  },
  { _id: false }
);

const StatusHistorySchema = new Schema<IStatusHistoryEntry>(
  {
    status: { type: String, required: true },
    announceType: { type: String, required: true },
    changedAt: { type: Date, required: true, default: Date.now },
    note: { type: String }
  },
  { _id: false }
);

const WorkSchema = new Schema<IWork>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite', required: true, index: true },
    projectId: { type: String, required: true, trim: true },

    title: { type: String, required: true, trim: true },
    status: { type: String, required: true, index: true },
    announceType: { type: String, required: true },
    pubDate: { type: Date },

    torFiles: { type: [TorFileSchema], default: [] },
    statusHistory: { type: [StatusHistorySchema], default: [] },

    budget: { type: Number, min: 0 },
    contractNumber: { type: String, trim: true },
    contractDate: { type: Date },
    winnerName: { type: String, trim: true },
    winnerTin: { type: String, trim: true, index: true },
    enrichedAt: { type: Date },

    tags: { type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], default: [] }
  },
  { timestamps: true }
);

// Stable upsert key -- FR-N1.4: correlates RSS items and data.go.th
// enrichment records for the same site to the same work.
WorkSchema.index({ siteId: 1, projectId: 1 }, { unique: true });
WorkSchema.index({ title: 'text' });
WorkSchema.index({ tags: 1 });

export const Work: Model<IWork> = mongoose.models.Work || mongoose.model<IWork>('Work', WorkSchema);
