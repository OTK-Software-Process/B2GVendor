import { Account, IAccount } from "../models/account.model";
import { AppError } from "../utils/AppError";
import { Session } from "../models/session.model";
import { toSessionView } from "./session.service";
import { consumeToken, issueToken } from "./token.service";
import { sendPasswordResetEmail } from "./email.service";

export async function getProfile(accountId: string): Promise<IAccount> {
  const account = await Account.findById(accountId);

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account;
}

export async function updateProfile(
  accountId: string,
  updateData: Partial<IAccount>,
): Promise<IAccount> {
  const account = await Account.findByIdAndUpdate(accountId, updateData, {
    new: true,
  });

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account;
}

export async function changePassword(
  accountId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const account = await Account.findById(accountId).select('+passwordHash');

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  const isMatch = await account.comparePassword(currentPassword);
  if (!isMatch) {
    throw AppError.invalidCredentials();
  }

  account.passwordHash = newPassword;
  await account.save();
}

export async function forgotPassword(email: string): Promise<void> {
  try {
    const account = await Account.findOne({ email: email.trim().toLowerCase() });

    if (!account) {
      return;
    }

    const rawToken = await issueToken(account._id, "password_reset");
    await sendPasswordResetEmail(account.email, account.name, rawToken);
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    throw AppError.internalError(
      "An error occurred while processing the password reset request.",
    );
  }
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const accountId = await consumeToken(token, "password_reset");

  const account = await Account.findById(accountId).select('+passwordHash');
  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  account.passwordHash = newPassword;
  await account.save();
}

export async function getSession(
  accountId: string,
): Promise<any> {
  const session = await Session.findOne({
    accountId: accountId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).sort({ lastActiveAt: -1 });

  if (!session) {
    throw AppError.notFound("No active session found.");
  }

  return toSessionView(session, String(session._id));
}