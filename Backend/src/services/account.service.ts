import { Account, IAccount } from "../models/account.model";
import { AppError } from "../utils/AppError";
import { Token, hashOneTimeToken } from "../models/token.model";
import * as cryptoUtils from "../utils/crypto";
import nodemailer from "nodemailer";

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
  const account = await Account.findById(accountId);

  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  return account.comparePassword(currentPassword).then(async (isMatch) => {
    if (!isMatch) {
      throw AppError.invalidCredentials();
    }

    account.passwordHash = newPassword;
    await account.save();
  });
}

export async function forgotPassword(email: string): Promise<void> {
  try {
    const resetToken = cryptoUtils.generateRawToken(32);
    const hashedToken = cryptoUtils.hashToken(resetToken);

    const resetURL = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset Request",
      text: `You requested a password reset. Click the link to reset your password: ${resetURL}`, // can use html instead of text for HTML emails
    };
      await transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.error("Error sending email:", error);
        throw AppError.internalError("Failed to send password reset email.");
      } else {
        console.log("Email sent: " + info.response);
      }
    });
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
  const tokenDoc = await Token.findOne({
    tokenHash: hashOneTimeToken(token),
    purpose: "password_reset",
    usedAt: null,
  });

  if (!tokenDoc) {
    throw AppError.badRequest("Invalid or expired token.");
  }

  const account = await Account.findById(tokenDoc.accountId);
  if (!account) {
    throw AppError.notFound("Account not found.");
  }

  account.passwordHash = newPassword;
  await account.save();
}
