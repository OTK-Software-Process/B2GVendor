import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { generateRawToken, hashToken } from '../utils/crypto';

export interface ISession extends Document {
  accountId: Types.ObjectId;
  tokenHash: string;

  userAgent?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  location?: string;

  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SessionSchema = new Schema<ISession>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },

    userAgent: { type: String, maxlength: 512 },
    browser: { type: String, maxlength: 100 },
    os: { type: String, maxlength: 100 },
    ipAddress: { type: String, maxlength: 64 },
    location: { type: String, maxlength: 120 },

    lastActiveAt: { type: Date, default: Date.now, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.tokenHash;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ accountId: 1, revokedAt: 1, lastActiveAt: -1 });

export function issueSessionToken(): { raw: string; tokenHash: string } {
  const raw = generateRawToken(32);
  return { raw, tokenHash: hashToken(raw) };
}

export function hashSessionToken(raw: string): string {
  return hashToken(raw);
}

export const Session: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);
