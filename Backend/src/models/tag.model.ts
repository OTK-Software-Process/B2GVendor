import mongoose, { Schema, Document, Model } from 'mongoose';

export type TagFacet = 'site' | 'agency' | 'method' | 'category' | 'keyword';

export interface ITag extends Document {
  name: string;
  facet: TagFacet;
  aliases: string[];
  siteId?: mongoose.Types.ObjectId; // set when facet === 'site'
  retired: boolean;
  // Marks this tag as an ingestion topic filter (customer requirement,
  // e.g. "software"). When ANY tag has this set to true and
  // env.INGESTION_TOPIC_FILTER_ENABLED is on, ingestion.service.ts only
  // creates a NEW Work if the AI's resulting tags include at least one tag
  // flagged here -- see runRssPoll's inScopeTagIds. Deliberately data-driven
  // rather than a hardcoded tag name/id, and deliberately a set (not a
  // single tag) so a second topic can be added later without a code change.
  // Applies across every GovSite uniformly -- there is no per-site override.
  includeInIngestionFilter: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    facet: { type: String, enum: ['site', 'agency', 'method', 'category', 'keyword'], required: true, index: true },
    aliases: { type: [String], default: [] },
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite' },
    retired: { type: Boolean, default: false, index: true },
    includeInIngestionFilter: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

TagSchema.index({ name: 1, facet: 1 }, { unique: true });

export const Tag: Model<ITag> = mongoose.models.Tag || mongoose.model<ITag>('Tag', TagSchema);
