import { randomBytes } from 'crypto';
import { hashPassword, needsRehash, verifyPassword } from '../utils/passwordHasher';
import { assertPasswordNotGuessable } from '../utils/passwordPolicy';
import { audit } from './audit.service';
import { Request } from 'express';
import { env } from '../config/env';
import { Account, IAccount } from '../models/account.model';
import { createSession, SessionContext } from './session.service';
import { AppError } from '../utils/AppError';
import { clearFailedLogins, reserveLoginAttempt, reserveUnknownEmailAttempt } from './loginLockout.service';
import { assertPasswordNotPwned } from '../integrations/haveIBeenPwned.client';
import { invalidateTokens, issueToken, consumeToken } from './token.service';
import { isEmailConfigured, sendAccountExistsEmail, sendEmailVerificationEmail } from './email.service';

export interface AuthResult {
  account: IAccount;
  rawToken: string;
}

function sessionContextFromRequest(req: Request): SessionContext {
  return {
    userAgent: req.get('user-agent') ?? undefined,
    ipAddress: req.ip
  };
}

// bcrypt is deliberately slow (~hundreds of ms). A sign-in for an email that has
// no account would skip it and answer in a few ms, and that difference tells an
// attacker which emails are registered. So an unknown email is made to pay the
// same price: the password is compared against a throw-away hash made with the
// same cost as real ones. It is built from random bytes, so no password can ever
// match it.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);
  return dummyHash;
}
// Built at start-up, so the first unknown-email sign-in is not the slow one.
getDummyHash().catch(() => {
  dummyHash = undefined;
});

function isDuplicateEmailError(err: unknown): boolean {
  const e = err as { code?: unknown; keyPattern?: Record<string, unknown> } | null;
  return !!e && e.code === 11000 && !!e.keyPattern && 'email' in e.keyPattern;
}

/**
 * Creates an unverified account and emails its verification link. Resolves to
 * null when the email already had an account: the caller must answer exactly
 * as it does for a new one.
 */
export async function registerAccount(
  input: {
    name: string;
    email: string;
    password: string;
    type: 'individual' | 'business';
    businessProfile?: { companyName: string; taxId: string };
  }
): Promise<IAccount | null> {
  if (!isEmailConfigured()) {
    throw AppError.serviceUnavailable('Email verification is not configured.');
  }

  // Cheap local check first, then the breach lookup (both before any write).
  assertPasswordNotGuessable(input.password, {
    email: input.email,
    name: input.name,
    companyName: input.businessProfile?.companyName,
    taxId: input.businessProfile?.taxId
  });
  await assertPasswordNotPwned(input.password);

  let account: IAccount;
  try {
    // No "does this email exist?" lookup first: the database's unique index
    // refuses a taken email only AFTER the password has been hashed, so a taken
    // email costs the same time as a free one.
    account = await Account.create({
      name: input.name,
      email: input.email,
      passwordHash: input.password,
      type: input.type,
      businessProfile: input.businessProfile,
      emailVerified: false
    });
  } catch (err) {
    if (!isDuplicateEmailError(err)) throw err;
    // Anyone can call this endpoint, so it must not confirm which emails have an
    // account (ASVS V6.3.8): a taken email gets the SAME answer as a new one --
    // 201 "check your email" -- after the same work (hash, then one email). The
    // email that goes out tells the owner someone tried, and how to sign in.
    const existing = await Account.findOne({ email: input.email }).select('name email');
    if (existing) {
      try {
        await sendAccountExistsEmail(existing.email, existing.name);
      } catch {
        throw AppError.serviceUnavailable('Email verification could not be sent. Please try again later.');
      }
    }
    return null;
  }

  let tokenIssued = false;
  try {
    const rawToken = await issueToken(account._id, 'email_verification');
    tokenIssued = true;
    try {
      await sendEmailVerificationEmail(account.email, account.name, rawToken);
    } catch {
      throw AppError.serviceUnavailable('Email verification could not be sent. Please try again later.');
    }
  } catch (error) {
    if (tokenIssued) {
      await invalidateTokens(account._id, 'email_verification');
    }
    await Account.deleteOne({ _id: account._id });
    throw error;
  }

  return account;
}

export async function verifyEmailAddress(rawToken: string): Promise<void> {
  const accountId = await consumeToken(rawToken, 'email_verification');
  const account = await Account.findByIdAndUpdate(accountId, { emailVerified: true });

  if (!account) {
    throw AppError.tokenInvalid();
  }
}

/**
 * ASVS V11.2.2: the one moment the plain password is known to be right is a
 * successful sign-in, so that is when a hash in the old scheme (plain bcrypt) or
 * with an outdated cost is replaced. Written straight to the database -- not
 * through save(), which would count as a password change (passwordChangedAt,
 * the "your password was changed" email). Bookkeeping: not audited. A failure
 * here never blocks the sign-in; the next one tries again.
 */
async function upgradePasswordHash(accountId: IAccount['_id'], stored: string, plain: string): Promise<void> {
  if (!needsRehash(stored, env.BCRYPT_ROUNDS)) return;
  try {
    const upgraded = await hashPassword(plain, env.BCRYPT_ROUNDS);
    await audit.withoutAuto(() => Account.updateOne({ _id: accountId, passwordHash: stored }, { $set: { passwordHash: upgraded } }).exec());
  } catch {
    // keep the old hash; it still verifies
  }
}

export async function loginWithPassword(
  input: { email: string; password: string },
  req: Request
): Promise<AuthResult> {
  const account = await Account.findOne({ email: input.email }).select('+passwordHash');

  if (!account) {
    // An address with no account is counted and locked exactly like a real one,
    // and pays for the same bcrypt compare: the answer (401, or 423 once
    // "locked") and its timing never reveal whether the account exists (V6.3.8).
    const unknown = await reserveUnknownEmailAttempt(input.email);
    await verifyPassword(input.password, await getDummyHash());
    if (!unknown.allowed) throw AppError.accountLocked(unknown.retryAfterSeconds);
    throw AppError.invalidCredentials();
  }

  // Counted per account (the IP limiter alone is beaten by rotating IPs). A
  // locked account is refused without checking its password -- but after a
  // dummy compare, so the refusal takes as long as any other answer.
  const attempt = await reserveLoginAttempt(account._id);
  if (!attempt.allowed) {
    await verifyPassword(input.password, await getDummyHash());
    throw AppError.accountLocked(attempt.retryAfterSeconds);
  }

  // The password comes first, for every account: a wrong password gets the same
  // answer whether the account is active, suspended or missing. Only someone who
  // proves they know the password is told the account is suspended.
  const passwordMatches = await account.comparePassword(input.password);
  if (!passwordMatches) {
    throw AppError.invalidCredentials();
  }
  await clearFailedLogins(account._id);
  await upgradePasswordHash(account._id, account.passwordHash, input.password);

  if (account.status === 'suspended') {
    throw AppError.accountSuspended();
  }
  if (!account.emailVerified) {
    throw AppError.emailNotVerified();
  }

  const { rawToken } = await createSession(account._id, sessionContextFromRequest(req));

  return { account, rawToken };
}
