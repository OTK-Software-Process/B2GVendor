import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { Request } from 'express';
import { env } from '../config/env';
import { Account, IAccount } from '../models/account.model';
import { createSession, SessionContext } from './session.service';
import { AppError } from '../utils/AppError';
import { clearFailedLogins, reserveLoginAttempt } from './loginLockout.service';
import { assertPasswordNotPwned } from '../integrations/haveIBeenPwned.client';
import { invalidateTokens, issueToken, consumeToken } from './token.service';
import { isEmailConfigured, sendEmailVerificationEmail } from './email.service';

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
  dummyHash ??= bcrypt.hash(randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);
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

export async function registerAccount(
  input: {
    name: string;
    email: string;
    password: string;
    type: 'individual' | 'business';
    businessProfile?: { companyName: string; taxId: string };
  }
): Promise<IAccount> {
  if (!isEmailConfigured()) {
    throw AppError.serviceUnavailable('Email verification is not configured.');
  }

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
    // Anyone can call this endpoint, so it must not confirm which emails have an account.
    if (isDuplicateEmailError(err)) throw AppError.registrationFailed();
    throw err;
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

export async function loginWithPassword(
  input: { email: string; password: string },
  req: Request
): Promise<AuthResult> {
  const account = await Account.findOne({ email: input.email }).select('+passwordHash');

  if (!account) {
    await bcrypt.compare(input.password, await getDummyHash());
    throw AppError.invalidCredentials();
  }

  // Counted per account (the IP limiter alone is beaten by rotating IPs). A
  // locked account is refused without checking the password at all.
  const attempt = await reserveLoginAttempt(account._id);
  if (!attempt.allowed) {
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

  if (account.status === 'suspended') {
    throw AppError.accountSuspended();
  }
  if (!account.emailVerified) {
    throw AppError.emailNotVerified();
  }

  const { rawToken } = await createSession(account._id, sessionContextFromRequest(req));

  return { account, rawToken };
}
