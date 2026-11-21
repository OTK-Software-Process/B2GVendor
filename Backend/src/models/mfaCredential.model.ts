import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// An account's second factor: its authenticator secret, its recovery codes and its
// own failed-attempt counters (docs/Security.md section 15). A collection of its own,
// not fields on Account, for three reasons: no account query (and no audit diff,
// and no API view of an account) can ever carry a secret by accident; a leak of the
// accounts collection alone yields no seeds; and an account's second factor can be
// removed in one place.
//
// Only services/mfa.service.ts reads or writes it.

/** How an administrator established who they were resetting a second factor for (recorded in the audit log). */
export const IDENTITY_CHECKS = ['in_person', 'video_call', 'callback_to_known_number', 'other_documented'] as const;
export type IdentityCheck = (typeof IDENTITY_CHECKS)[number];

export interface IRecoveryCodeEntry {
  /** Four characters that name this code, so a sign-in checks ONE hash. Not secret. */
  id: string;
  /** Hash of the code's secret part (HMAC-SHA256 pre-hash, then bcrypt). The code itself is never stored. */
  hash: string;
  usedAt?: Date;
}

export interface IMfaCredential extends Document {
  accountId: Types.ObjectId;

  /** The active authenticator secret, AES-256-GCM encrypted and bound to the account (utils/secretBox.ts). */
  secretEnc?: string;
  /** Set when the factor became active. Absent while a setup is only pending. */
  enabledAt?: Date;

  /** A secret handed out during setup, not active until a code made from it is proven. */
  pendingSecretEnc?: string;
  pendingExpiresAt?: Date;

  /**
   * The highest 30-second step whose code was accepted. A code of this step or an
   * older one is refused, so a code (even one seen over a shoulder) works once
   * (ASVS V6.5.1).
   */
  lastUsedStep: number;

  recoveryCodes: IRecoveryCodeEntry[];
  recoveryCodesGeneratedAt?: Date;

  // Wrong-code lock, counted apart from the password's: a correct password must not
  // wipe it, or someone who knows the password could guess codes without end.
  failedCount?: number;
  lastFailedAt?: Date;
  lockedUntil?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const RecoveryCodeSchema = new Schema<IRecoveryCodeEntry>(
  {
    id: { type: String, required: true },
    hash: { type: String, required: true },
    usedAt: { type: Date }
  },
  { _id: false }
);

const MfaCredentialSchema = new Schema<IMfaCredential>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },

    secretEnc: { type: String, select: false },
    enabledAt: { type: Date },
    pendingSecretEnc: { type: String, select: false },
    pendingExpiresAt: { type: Date },

    lastUsedStep: { type: Number, default: 0 },

    recoveryCodes: { type: [RecoveryCodeSchema], default: [], select: false },
    recoveryCodesGeneratedAt: { type: Date },

    failedCount: { type: Number, default: 0 },
    lastFailedAt: { type: Date },
    lockedUntil: { type: Date }
  },
  {
    timestamps: true,
    // Whatever happens, nothing secret leaves through JSON.
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        for (const field of ['secretEnc', 'pendingSecretEnc', 'recoveryCodes', 'lastUsedStep', 'failedCount', 'lastFailedAt', 'lockedUntil', '_id', '__v']) delete ret[field];
        return ret;
      }
    }
  }
);

export const MfaCredential: Model<IMfaCredential> =
  mongoose.models.MfaCredential || mongoose.model<IMfaCredential>('MfaCredential', MfaCredentialSchema);
