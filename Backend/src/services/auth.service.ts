import { Request } from 'express';
import { Account, IAccount } from '../models/account.model';
import { createSession, SessionContext } from './session.service';
import { AppError } from '../utils/AppError';
import { clearFailedLogins, reserveLoginAttempt } from './loginLockout.service';

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
  },
  req: Request
): Promise<AuthResult> {
  const account = await Account.create({
    name: input.name,
    email: input.email,
    passwordHash: input.password,
    type: input.type,
    businessProfile: input.businessProfile
  });

  const { rawToken } = await createSession(account._id, sessionContextFromRequest(req));

  return { account, rawToken };
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

  // Counted per account (the IP limiter alone is beaten by rotating IPs). A
  // locked account is refused without checking the password at all.
  const attempt = await reserveLoginAttempt(account._id);
  if (!attempt.allowed) {
    throw AppError.accountLocked(attempt.retryAfterSeconds);
  }

  const passwordMatches = await account.comparePassword(input.password);
  if (!passwordMatches) {
    throw AppError.invalidCredentials();
  }
  await clearFailedLogins(account._id);

  const { rawToken } = await createSession(account._id, sessionContextFromRequest(req));

  return { account, rawToken };
}
