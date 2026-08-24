import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { generateRawToken, hashToken } from '../utils/crypto';

export type TokenPurpose = 'email_verification' | 'password_reset';

export interface IToken extends Document {
  accountId: Types.ObjectId;
  tokenHash: string;
  purpose: TokenPurpose;
  usedAt?: Date;
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

const TokenSchema = new Schema<IToken>(
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
    purpose: {
      type: String,
      enum: ['email_verification', 'password_reset'],
      required: true,
      index: true,
    },
    usedAt: { type: Date },
    expiresAt: { type: Date, required: true },
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

TokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
TokenSchema.index({ accountId: 1, purpose: 1, usedAt: 1 });

export function issueOneTimeToken(purpose: TokenPurpose): {
  raw: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const raw = generateRawToken(32);
  return {
    raw,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
  };
}

export function hashOneTimeToken(raw: string): string {
  return hashToken(raw);
}

export const Token: Model<IToken> =
  mongoose.models.Token || mongoose.model<IToken>('Token', TokenSchema);
