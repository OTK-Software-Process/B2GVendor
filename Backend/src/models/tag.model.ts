import mongoose, { Schema, Document, Model } from 'mongoose';

export type TagFacet = 'site' | 'agency' | 'method' | 'category' | 'keyword';

export interface ITag extends Document {
  name: string;
  facet: TagFacet;
  aliases: string[];
  siteId?: mongoose.Types.ObjectId; // set when facet === 'site'
  retired: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    facet: { type: String, enum: ['site', 'agency', 'method', 'category', 'keyword'], required: true, index: true },
    aliases: { type: [String], default: [] },
    siteId: { type: Schema.Types.ObjectId, ref: 'GovSite' },
    retired: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

TagSchema.index({ name: 1, facet: 1 }, { unique: true });

export const Tag: Model<ITag> = mongoose.models.Tag || mongoose.model<ITag>('Tag', TagSchema);
