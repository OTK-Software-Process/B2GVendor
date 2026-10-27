import { Request } from 'express';
import { Account, IAccount } from '../models/account.model';
import { createSession, SessionContext } from './session.service';
import { AppError } from '../utils/AppError';
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

  const account = await Account.create({
    name: input.name,
    email: input.email,
    passwordHash: input.password,
    type: input.type,
    businessProfile: input.businessProfile,
    emailVerified: false
  });

  let tokenIssued = false;
  try {
    const rawToken = await issueToken(account._id, 'email_verification');
    tokenIssued = true;
    await sendEmailVerificationEmail(account.email, account.name, rawToken);
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
    throw AppError.invalidCredentials();
  }
  if (account.status === 'suspended') {
    throw AppError.accountSuspended();
  }

  const passwordMatches = await account.comparePassword(input.password);
  if (!passwordMatches) {
    throw AppError.invalidCredentials();
  }
  if (!account.emailVerified) {
    throw AppError.emailNotVerified();
  }

  const { rawToken } = await createSession(account._id, sessionContextFromRequest(req));

  return { account, rawToken };
}
