import { Account, IAccount, NotificationFrequency } from "../models/account.model";
import { AppError } from "../utils/AppError";
import { Session } from "../models/session.model";
import {
  listActiveSessions,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSessionById,
  SessionView,
  toSessionView,
} from "./session.service";
import {
  consumeToken,
  invalidateTokens,
  issueToken,
  validateToken,
} from "./token.service";
import { isEmailConfigured, sendPasswordChangedEmail, sendPasswordResetEmail } from "./email.service";
import { logger } from "../utils/logger";
import { maskEmail } from "../utils/privacy";
import { assertPasswordNotPwned } from "../integrations/haveIBeenPwned.client";
import { assertPasswordNotGuessable } from "../utils/passwordPolicy";
import { clearFailedLogins, reserveLoginAttempt } from "./loginLockout.service";

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
  currentSessionId: string,
): Promise<void> {
  const account = await Account.findById(accountId).select('+passwordHash');

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  // Guessing the current password is guessing the password: it counts toward
  // the same per-account lock as failed sign-ins. Otherwise someone holding a
  // stolen session could try passwords here without limit and take the account
  // over for good.
  const attempt = await reserveLoginAttempt(account._id);
  if (!attempt.allowed) {
    throw AppError.accountLocked(attempt.retryAfterSeconds);
  }

  const isMatch = await account.comparePassword(currentPassword);
  if (!isMatch) {
    logger.security("warn", "auth.reauth.failure", { purpose: "change_password", accountId: String(account._id) });
    throw AppError.invalidCredentials();
  }
  await clearFailedLogins(account._id);

  assertPasswordNotGuessable(newPassword, ownerOf(account), "newPassword");
  await assertPasswordNotPwned(newPassword);
  account.passwordHash = newPassword;
  await account.save();
  const revoked = await revokeOtherSessions(accountId, currentSessionId);
  logger.security("info", "auth.password.changed", { accountId: String(account._id), otherSessionsRevoked: revoked });
  await notifyPasswordChanged(account, "changed");
}

// The words of this account that a password must not be made of (utils/passwordPolicy.ts).
function ownerOf(account: { email: string; name: string; businessProfile?: { companyName?: string; taxId?: string } | null }) {
  return {
    email: account.email,
    name: account.name,
    companyName: account.businessProfile?.companyName,
    taxId: account.businessProfile?.taxId,
  };
}

/**
 * ASVS V6.3.7: tell the owner, by email, that their password changed -- so a
 * change they did not make (a stolen session, a hijacked reset) does not go
 * unnoticed. Best effort: the change itself has already happened and must not
 * be undone because a notice could not be sent.
 */
async function notifyPasswordChanged(account: { email: string; name: string }, how: "changed" | "reset"): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    await sendPasswordChangedEmail(account.email, account.name, how);
  } catch (error) {
    logger.warn("account", `Could not send the password-changed notice to ${maskEmail(account.email)}`, error);
  }
}

export async function forgotPassword(email: string): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      throw new Error("SMTP is not configured; email could not be sent.");
    }

    const account = await Account.findOne({ email: email.trim().toLowerCase() });
    logger.security("info", "auth.password_reset.requested", { email: maskEmail(email), accountFound: !!account });

    if (!account) {
      return;
    }

    const rawToken = await issueToken(account._id, "password_reset");
    try {
      await sendPasswordResetEmail(account.email, account.name, rawToken);
    } catch (error) {
      await invalidateTokens(account._id, "password_reset");
      throw error;
    }
  } catch (error) {
    logger.error("account", "forgot-password could not send the reset email", error);
    throw AppError.internalError(
      "An error occurred while processing the password reset request.",
    );
  }
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const tokenAccountId = await validateToken(token, "password_reset");
  const owner = await Account.findById(tokenAccountId).select("email name businessProfile");
  if (owner) assertPasswordNotGuessable(newPassword, ownerOf(owner), "newPassword");
  await assertPasswordNotPwned(newPassword);
  const accountId = await consumeToken(token, "password_reset");

  const account = await Account.findById(accountId).select('+passwordHash');
  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  account.passwordHash = newPassword;
  await account.save();
  // Proving control of the mailbox lifts a sign-in lockout.
  await clearFailedLogins(account._id);
  const revoked = await revokeAllSessions(accountId);
  logger.security("info", "auth.password_reset.completed", { accountId: String(account._id), sessionsRevoked: revoked });
  await notifyPasswordChanged(account, "reset");
}

// ----------------------------------------------------------- sessions (ASVS V7.5.2)

/** Every live session of the account: browser, OS, masked address, last active, which one is this. */
export function listSessions(accountId: string, currentSessionId: string): Promise<SessionView[]> {
  return listActiveSessions(accountId, currentSessionId);
}

/**
 * Ending another session needs the password again: someone who only holds a
 * stolen session must not be able to throw the owner out. The check counts
 * toward the per-account sign-in lock, like change-password.
 */
async function confirmPassword(accountId: string, password: string): Promise<void> {
  const account = await Account.findById(accountId).select("+passwordHash");
  if (!account) throw AppError.notFound("Account not found.");
  const attempt = await reserveLoginAttempt(account._id);
  if (!attempt.allowed) throw AppError.accountLocked(attempt.retryAfterSeconds);
  if (!(await account.comparePassword(password))) {
    logger.security("warn", "auth.reauth.failure", { purpose: "end_session", accountId: String(account._id) });
    throw AppError.invalidCredentials();
  }
  await clearFailedLogins(account._id);
}

export async function revokeSession(accountId: string, sessionId: string, password: string): Promise<{ revoked: boolean }> {
  await confirmPassword(accountId, password);
  const session = await Session.findOne({ _id: sessionId, accountId, revokedAt: { $exists: false } });
  if (!session) throw AppError.notFound("No such session.");
  const revoked = await revokeSessionById(session._id);
  logger.security("info", "auth.session.revoked", { reason: "owner", accountId, sessionId: String(session._id) });
  return { revoked };
}

export async function revokeOtherSessionsWithPassword(accountId: string, currentSessionId: string, password: string): Promise<{ revoked: number }> {
  await confirmPassword(accountId, password);
  const revoked = await revokeOtherSessions(accountId, currentSessionId);
  logger.security("info", "auth.session.revoked", { reason: "owner_others", accountId, count: revoked });
  return { revoked };
}

export interface NotificationSettingsUpdate {
  emailNotificationsEnabled?: boolean;
  notificationFrequency?: NotificationFrequency;
}

export async function updateNotificationSettings(
  accountId: string,
  update: NotificationSettingsUpdate,
): Promise<IAccount> {
  const account = await Account.findByIdAndUpdate(accountId, update, { new: true });

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account;
}

export async function unsubscribeFromEmails(rawToken: string): Promise<void> {
  const accountId = await validateToken(rawToken, 'email_unsubscribe');
  const account = await Account.findByIdAndUpdate(
    accountId,
    { emailNotificationsEnabled: false },
  );

  if (!account) {
    throw AppError.notFound("Account not found.");
  }
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