import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Account } from '../models/account.model';
import { LoginFailure } from '../models/loginFailure.model';
import { MfaCredential } from '../models/mfaCredential.model';
import { audit } from './audit.service';

// Per-ACCOUNT brute-force protection. loginLimiter only counts per IP, which an
// attacker spreading guesses over many addresses never trips; this counts the
// failed sign-ins on the account itself, wherever they come from.
//
// The first FREE_ATTEMPTS failures cost nothing. From then on the account is
// locked for a delay that doubles with every further failure (1, 2, 4, 8, 16
// min, then MAX_LOCK). A successful sign-in or a password reset clears it, and
// failures older than FORGET_AFTER are forgotten, so a typo every few days
// never adds up to a lock.

const MINUTE = 60 * 1000;
export const FREE_ATTEMPTS = 4;
export const BASE_LOCK_MS = 1 * MINUTE;
export const MAX_LOCK_MS = 30 * MINUTE;
export const FORGET_AFTER_MS = 24 * 60 * MINUTE;

/** How long the account is locked once `failures` sign-ins in a row have failed (0: not locked). */
export function lockDurationMs(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failures - FREE_ATTEMPTS - 1));
}

/** The lock still in force at `now`, as whole seconds left (0: not locked). */
export function lockSecondsLeft(lockedUntil: Date | undefined | null, now = new Date()): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

// `lockedUntil` on an allowed attempt: THIS failure-in-waiting just started a lock (for the security log).
export type AttemptReservation = { allowed: true; lockedUntil?: Date } | { allowed: false; retryAfterSeconds: number };

function claimed(doc: { lockedUntil?: Date | null } | null, now: Date): AttemptReservation | null {
  if (!doc) return null;
  return doc.lockedUntil && doc.lockedUntil > now ? { allowed: true, lockedUntil: doc.lockedUntil } : { allowed: true };
}

/**
 * Claims one sign-in attempt BEFORE the password is checked: the failure count
 * goes up, and the lock is set in the same atomic update once the count is past
 * the free attempts. Doing it up front (and in one update) means a burst of
 * parallel guesses can't all slip through during the slow bcrypt compare --
 * each one takes its own slot, and the ones after the lock are refused.
 * A correct password then undoes it with clearFailedLogins().
 */
/**
 * The update that claims one attempt: the failure count goes up (or restarts at
 * 1 once the last failure is older than FORGET_AFTER), and the lock is set in the
 * same atomic update once the count is past the free attempts. Shared by real
 * accounts and by unknown addresses, so both lock at exactly the same moment.
 */
// The names of the three fields a lock is kept in. The same logic guards an
// account's password, an unknown address, and an account's second factor.
interface LockFields {
  count: string;
  last: string;
  lock: string;
}
const SIGN_IN_FIELDS: LockFields = { count: 'failedLoginCount', last: 'lastFailedLoginAt', lock: 'lockedUntil' };
const MFA_FIELDS: LockFields = { count: 'failedCount', last: 'lastFailedAt', lock: 'lockedUntil' };

function claimAttemptUpdate(now: Date, fields: LockFields = SIGN_IN_FIELDS) {
  const forgetBefore = new Date(now.getTime() - FORGET_AFTER_MS);
  const failures = {
    $cond: [
      { $lt: [{ $ifNull: [`$${fields.last}`, new Date(0)] }, forgetBefore] },
      1,
      { $add: [{ $ifNull: [`$${fields.count}`, 0] }, 1] }
    ]
  };
  const lockMs = {
    $min: [MAX_LOCK_MS, { $multiply: [BASE_LOCK_MS, { $pow: [2, { $subtract: [`$${fields.count}`, FREE_ATTEMPTS + 1] }] }] }]
  };
  return [
    { $set: { [fields.count]: failures, [fields.last]: now } },
    {
      $set: {
        [fields.lock]: {
          $cond: [{ $gt: [`$${fields.count}`, FREE_ATTEMPTS] }, { $add: [now, lockMs] }, '$$REMOVE']
        }
      }
    }
  ];
}

const notLockedAt = (now: Date) => ({ $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] });

/**
 * Claims one sign-in attempt BEFORE the password is checked: the failure count
 * goes up, and the lock is set in the same atomic update once the count is past
 * the free attempts. Doing it up front (and in one update) means a burst of
 * parallel guesses can't all slip through during the slow bcrypt compare --
 * each one takes its own slot, and the ones after the lock are refused.
 * A correct password then undoes it with clearFailedLogins().
 */
export async function reserveLoginAttempt(accountId: Types.ObjectId, now = new Date()): Promise<AttemptReservation> {
  // Bookkeeping, not an admin's edit: kept out of the audit log. (exec() inside
  // the callback -- a query left to the caller's await would run outside it.)
  const updated = await audit.withoutAuto(() =>
    Account.findOneAndUpdate({ _id: accountId, ...notLockedAt(now) }, claimAttemptUpdate(now), { new: true, projection: { _id: 1, lockedUntil: 1 } }).exec()
  );
  const ok = claimed(updated, now);
  if (ok) return ok;

  // The filter missed: the account is (now) locked -- possibly by a parallel attempt.
  const current = await Account.findById(accountId).select('+lockedUntil');
  return { allowed: false, retryAfterSeconds: Math.max(1, lockSecondsLeft(current?.lockedUntil, now)) };
}

export function hashLoginEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * The same reservation for an email address that has no account, so it is
 * locked after the same number of failures and answers 423 the same way
 * (ASVS V6.3.8: the answer must not reveal whether the account exists).
 */
export async function reserveUnknownEmailAttempt(email: string, now = new Date()): Promise<AttemptReservation> {
  const emailHash = hashLoginEmail(email);
  // A few rounds, because the first failure for an address has to create its
  // row before it can claim on it, and a lock can run out in between.
  for (let round = 0; round < 3; round += 1) {
    const claimedDoc = await LoginFailure.findOneAndUpdate({ emailHash, ...notLockedAt(now) }, claimAttemptUpdate(now), {
      new: true,
      projection: { _id: 1, lockedUntil: 1 }
    }).exec();
    const ok = claimed(claimedDoc, now);
    if (ok) return ok;

    const existing = await LoginFailure.findOne({ emailHash }).select('lockedUntil').lean();
    if (existing) {
      const left = lockSecondsLeft(existing.lockedUntil, now);
      if (left > 0) return { allowed: false, retryAfterSeconds: left };
      continue; // the lock ran out a moment ago: claim again
    }
    // No row yet. Create it (two parallel first failures may race here; the
    // unique index lets only one row exist), then claim on it in the next round.
    await LoginFailure.updateOne({ emailHash }, { $setOnInsert: { failedLoginCount: 0 } }, { upsert: true })
      .exec()
      .catch(err => {
        if ((err as { code?: unknown }).code !== 11000) throw err;
      });
  }
  // Still nothing claimed after every round: refuse rather than let it through.
  return { allowed: false, retryAfterSeconds: 1 };
}

/** Back to a clean slate: after a successful sign-in or a password reset. */
export async function clearFailedLogins(accountId: Types.ObjectId): Promise<void> {
  await audit.withoutAuto(() =>
    Account.updateOne({ _id: accountId }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1, lastFailedLoginAt: 1 } }).exec()
  );
}

// ------------------------------------------------------------------ second factor

/**
 * The same brute-force protection for the second factor, in counters of its own
 * (on the account's MfaCredential): 4 free wrong codes, then locks of 1, 2, 4 ...
 * up to 30 minutes. They are NOT cleared by a correct password, only by a correct
 * code: otherwise anyone who knows the password could sign in again after every
 * few wrong guesses and never be locked out of guessing the code.
 */
export async function reserveMfaAttempt(accountId: Types.ObjectId, now = new Date()): Promise<AttemptReservation> {
  const updated = await MfaCredential.findOneAndUpdate({ accountId, ...notLockedAt(now) }, claimAttemptUpdate(now, MFA_FIELDS), {
    new: true,
    projection: { _id: 1, lockedUntil: 1 }
  }).exec();
  const ok = claimed(updated, now);
  if (ok) return ok;

  const current = await MfaCredential.findOne({ accountId }).select('lockedUntil').lean();
  return { allowed: false, retryAfterSeconds: Math.max(1, lockSecondsLeft(current?.lockedUntil, now)) };
}

export async function clearMfaFailures(accountId: Types.ObjectId): Promise<void> {
  await MfaCredential.updateOne({ accountId }, { $set: { failedCount: 0 }, $unset: { lockedUntil: 1, lastFailedAt: 1 } }).exec();
}
