import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { generateRawToken, hashToken } from '../utils/crypto';
import { SESSION_TTL_MS } from '../config/cookie';

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

  // A session made by a correct PASSWORD for an account that has two-step
  // verification on is only a "challenge": it may do nothing except answer the
  // second factor (POST /auth/mfa/verify), and it lasts minutes. The answer ends it
  // and starts a new, full session -- so the token that goes on to be used after
  // the second factor was never one that existed before it (no fixation).
  mfaPending?: boolean;
  // When a second factor was checked for this (full) session.
  mfaVerifiedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

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
    mfaPending: { type: Boolean },
    mfaVerifiedAt: { type: Date },
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

export { SESSION_TTL_MS };

export const Session: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);
