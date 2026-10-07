import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { AnnounceType } from './govSite.model';
import { normalizeThaiSearchText } from '../utils/thaiSearch';

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

export type TorLinkType = 'pdf' | 'zip' | 'html' | 'other';

// Why a work has no price -- so the website can say something truthful
// instead of a bare "0" or blank. Only meaningful while `budget` is unset:
//   'not-stated'  -- we read the document text and it states no price
//   'unreadable'  -- a document was downloaded, but no text could be pulled
//                    out of it (scanned / image-only PDF; we do no OCR)
//   'no-document' -- nothing could be read: the link couldn't be fetched (or
//                    is a type we don't read), the download failed, or an
//                    e-GP HTML link answered with its "file not found" page
// Left unset on works ingested before this field existed; the UI then falls
// back to a generic "price not specified" message.
export type BudgetMissingReason = 'not-stated' | 'unreadable' | 'no-document';
export const BUDGET_MISSING_REASONS: readonly BudgetMissingReason[] = ['not-stated', 'unreadable', 'no-document'] as const;

// What kind of price `budget` holds. Unset (the normal case) = an estimated /
// reference price: a ราคากลาง or วงเงิน figure read from a TOR, or data.go.th's
// project budget. 'awarded' = the WINNING BID read from a winner announcement --
// a different number, so the website labels it "winning bid" instead of budget.
export type BudgetBasis = 'awarded';
export const BUDGET_BASES: readonly BudgetBasis[] = ['awarded'] as const;

export interface ITorFile {
  announceType: AnnounceType; // which lifecycle stage this document belongs to
  linkType: TorLinkType;
  sourceUrl: string; // the RSS <link> as-is -- shared by every file extracted from the same zip
  storageKey?: string; // set once a 'pdf' link (or a file extracted from a 'zip' link) has been downloaded and stored
  filename?: string;
  downloadedAt?: Date;
  // A 'zip' link can yield several PDFs. 'primary' is the one AI-analyzed
  // (draft TOR body); 'attachment' are the rest (cover sheets, annexes),
  // stored for download but not sent to Vertex AI. Undefined for plain
  // 'pdf'/'html'/'other' entries, which are always a single file.
  role?: 'primary' | 'attachment';
  // An 'html' entry has no storageKey (the page is read, not stored); for it
  // `downloadedAt` marks "the page was read". Counts the retry sweeps that
  // failed to read a still-unread html page, so one that keeps failing (removed,
  // or e-GP's "file not found") is given up on instead of retried forever;
  // `fetchAttemptedAt` spaces those retries out (see ingestion.service.ts).
  fetchAttempts?: number;
  fetchAttemptedAt?: Date;
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
  searchText?: string;
  // AI-generated summary of the TOR PDF's actual content (FR-3.2) -- only
  // present when a downloadable PDF was available and text extraction +
  // Vertex AI both succeeded; null/absent otherwise (title-only fallback).
  description?: string;
  status: WorkStatus;
  announceType: AnnounceType;
  pubDate?: Date;

  torFiles: ITorFile[];
  statusHistory: IStatusHistoryEntry[];

  // Pre-award: AI-extracted estimate (ราคากลาง/วงเงิน) read straight from
  // the TOR document text, set as soon as a work is created/updated --
  // see ingestion.service.ts. Post-award: overwritten with the real
  // contract price from data.go.th enrichment once that's available
  // (FR-N1.3a) -- enrichWorkFromContractRecord always wins when it has a
  // value, so this field converges from "estimate" to "actual" over time.
  budget?: number;
  // Set only while `budget` is still empty -- see BudgetMissingReason.
  budgetMissingReason?: BudgetMissingReason;
  // Set only when `budget` is a winning bid rather than an estimate -- see BudgetBasis.
  budgetBasis?: BudgetBasis;
  contractNumber?: string;
  contractDate?: Date;
  winnerName?: string;
  winnerTin?: string;
  enrichedAt?: Date;

  tags: Types.ObjectId[];
  // Tags an admin deliberately REMOVED from this work by hand. Ingestion
  // merges AI-proposed tags back in whenever a new document arrives, so
  // without this list the next poll would silently undo a manual removal --
  // ingestion.service.ts never re-adds a tag listed here. Set/cleared only by
  // adminWork.service.ts's setWorkTags.
  excludedTags: Types.ObjectId[];

  // Customer requirement: restrict the public site to one topic (e.g.
  // "software") -- see Tag.includeInIngestionFilter, computed once when the
  // work is first classified (ingestion.service.ts). 'shown' = at least one
  // of its tags is flagged in-scope; 'not-related' = none are. Undefined
  // means it was never evaluated (the filter was off, or this work predates
  // the feature) -- treated the SAME as 'shown' everywhere (work.service.ts
  // only ever excludes an EXPLICIT 'not-related', so existing/unfiltered
  // deployments are unaffected). Once set to 'not-related', later polls for
  // this same project skip re-downloading/re-analyzing its TOR documents
  // entirely (see retryMissingTorDownloads and the update branch of
  // upsertWorkFromRssItem) -- that's the whole point of persisting this
  // rather than re-deciding it on every poll.
  ingestionRelevance?: 'shown' | 'not-related';

  createdAt: Date;
  updatedAt: Date;
}

const TorFileSchema = new Schema<ITorFile>(
  {
    announceType: { type: String, required: true },
    linkType: { type: String, enum: ['pdf', 'zip', 'html', 'other'], required: true },
    sourceUrl: { type: String, required: true },
    storageKey: { type: String },
    filename: { type: String },
    downloadedAt: { type: Date },
    role: { type: String, enum: ['primary', 'attachment'] },
    fetchAttempts: { type: Number, min: 0 },
    fetchAttemptedAt: { type: Date },
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
    searchText: { type: String, select: false },
    description: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, required: true, index: true },
    announceType: { type: String, required: true },
    pubDate: { type: Date },

    torFiles: { type: [TorFileSchema], default: [] },
    statusHistory: { type: [StatusHistorySchema], default: [] },

    budget: { type: Number, min: 0 },
    budgetMissingReason: { type: String, enum: BUDGET_MISSING_REASONS },
    budgetBasis: { type: String, enum: BUDGET_BASES },
    contractNumber: { type: String, trim: true },
    contractDate: { type: Date },
    winnerName: { type: String, trim: true },
    winnerTin: { type: String, trim: true, index: true },
    enrichedAt: { type: Date },

    tags: { type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], default: [] },
    excludedTags: { type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], default: [] },

    ingestionRelevance: { type: String, enum: ['shown', 'not-related'], index: true }
  },
  { timestamps: true }
);

WorkSchema.pre('validate', function updateSearchText() {
  this.searchText = normalizeThaiSearchText(`${this.title}\n${this.description ?? ''}`);
});

// Stable upsert key -- FR-N1.4: correlates RSS items and data.go.th
// enrichment records for the same site to the same work.
WorkSchema.index({ siteId: 1, projectId: 1 }, { unique: true });
WorkSchema.index({ title: 'text', description: 'text' });
WorkSchema.index({ tags: 1 });

export const Work: Model<IWork> = mongoose.models.Work || mongoose.model<IWork>('Work', WorkSchema);
