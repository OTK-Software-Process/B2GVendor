import { Account } from '../models/account.model';
import { logger } from '../utils/logger';
import { deleteAccountAndData } from './adminAccount.service';

// Data retention (ASVS V14.2.7; the schedule is in docs/Security.md section 8).
//
// Most short-lived data removes itself through MongoDB TTL indexes: sessions at
// their expiry, email/reset tokens at theirs, failed-sign-in rows for unknown
// addresses after 25 hours. This file covers what a TTL index cannot decide on
// its own.

/** A self-registered account that never confirmed its email is removed after this. */
export const UNVERIFIED_ACCOUNT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes accounts that were created by sign-up and never verified within the
 * retention period, with their sessions, follows, notifications and tokens.
 * Their verification link expired long ago (24 hours), so nobody can use them;
 * keeping them would only keep a stranger's name and email, and block the real
 * owner from signing up with that address. Accounts made by an admin are
 * created verified and are never touched.
 */
export async function purgeUnverifiedAccounts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_RETENTION_DAYS * DAY_MS);
  const stale = await Account.find({ emailVerified: false, role: 'user', createdAt: { $lt: cutoff } }).select('_id').lean();

  let removed = 0;
  for (const { _id } of stale) {
    try {
      await deleteAccountAndData(_id);
      removed += 1;
    } catch (err) {
      logger.error('retention', `Could not remove unverified account ${String(_id)}`, err);
    }
  }
  return removed;
}
