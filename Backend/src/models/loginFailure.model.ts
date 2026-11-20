import { Schema, model, Document } from 'mongoose';

/**
 * Failed sign-ins for an email address that has NO account.
 *
 * A real account keeps its failure count and lock on the Account document
 * (services/loginLockout.service.ts). If an unknown address could never be
 * locked, "423 ACCOUNT_LOCKED after a few wrong passwords" would itself prove
 * the address has an account (ASVS V6.3.8). So unknown addresses are counted
 * and locked the same way, here, keyed by a hash of the address -- the address
 * itself is never stored.
 *
 * Rows expire on their own a little after the failures would be forgotten anyway.
 */
export interface ILoginFailure extends Document {
  emailHash: string;
  failedLoginCount: number;
  lastFailedLoginAt?: Date;
  lockedUntil?: Date;
}

const LoginFailureSchema = new Schema<ILoginFailure>({
  emailHash: { type: String, required: true, unique: true },
  failedLoginCount: { type: Number, default: 0 },
  lastFailedLoginAt: { type: Date },
  lockedUntil: { type: Date }
});

// 25 hours: failures older than 24 hours are forgotten (FORGET_AFTER_MS), and no
// lock lasts longer than 30 minutes.
LoginFailureSchema.index({ lastFailedLoginAt: 1 }, { expireAfterSeconds: 25 * 60 * 60 });

export const LoginFailure = model<ILoginFailure>('LoginFailure', LoginFailureSchema);
