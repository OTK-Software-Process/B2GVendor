import { Types } from 'mongoose';
import { Token, TokenPurpose, issueOneTimeToken, hashOneTimeToken } from '../models/token.model';
import { AppError } from '../utils/AppError';

export async function issueToken(
  accountId: Types.ObjectId | string,
  purpose: TokenPurpose
): Promise<string> {
  await Token.deleteMany({ accountId, purpose, usedAt: { $exists: false } });

  const { raw, tokenHash, expiresAt } = issueOneTimeToken(purpose);

  await Token.create({ accountId, tokenHash, purpose, expiresAt });

  return raw;
}

export async function consumeToken(
  rawToken: string,
  purpose: TokenPurpose
): Promise<Types.ObjectId> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    throw AppError.tokenInvalid();
  }

  const consumed = await Token.findOneAndUpdate(
    {
      tokenHash: hashOneTimeToken(rawToken),
      purpose,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    },
    { usedAt: new Date() },
    { new: true }
  );

  if (!consumed) {
    throw AppError.tokenInvalid();
  }

  return consumed.accountId;
}

export async function invalidateTokens(
  accountId: Types.ObjectId | string,
  purpose: TokenPurpose
): Promise<number> {
  const result = await Token.deleteMany({ accountId, purpose, usedAt: { $exists: false } });
  return result.deletedCount ?? 0;
}
