import { Account, IAccount } from "../models/account.model";
import { AppError } from "../utils/AppError";

export async function getProfile(accountId: string): Promise<IAccount> {
  const account = await Account.findById(accountId);

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account;
}

export async function updateProfile(accountId: string, updateData: Partial<IAccount>): Promise<IAccount> {
  const account = await Account.findByIdAndUpdate(accountId, updateData, { new: true });

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account;
}

export async function changePassword(accountId: string, currentPassword: string, newPassword: string): Promise<void> {
  const account = await Account.findById(accountId);

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account.comparePassword(currentPassword).then(async (isMatch) => {
    if (!isMatch) {
      throw AppError.unauthorized("Current password is incorrect.");
    }

    account.password = newPassword;
    await account.save();
  });
}

// export function forgotPassword(email: string): Promise<void> {


export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenDoc = await Token.findOne({ tokenHash: hashOneTimeToken(token), purpose: 'password_reset', usedAt: null });

  if (!tokenDoc) {
    throw AppError.badRequest("Invalid or expired token.");
  }

  const account = await Account.findById(tokenDoc.accountId);
  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  account.password = newPassword;
  await account.save();
}