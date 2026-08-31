import * as services from "../services/account.service";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";

function getAuthenticatedAccountId(req: Request): string {
  if (!req.account) {
    throw AppError.notAuthenticated();
  }
  return req.account._id.toString();
}

export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const accountId = getAuthenticatedAccountId(req);
    const account = await services.getProfile(accountId);
    res.status(200).send({ success: true, data: account });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const accountId = getAuthenticatedAccountId(req);
    const updateData = req.body;
    if (updateData.email) {
      throw AppError.badRequest("Email cannot be updated.");
    }
    const updatedAccount = await services.updateProfile(accountId, updateData);
    res.status(200).send({ success: true, data: updatedAccount });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const accountId = getAuthenticatedAccountId(req);
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    if (newPassword !== confirmNewPassword) {
      throw AppError.badRequest("New passwords do not match.");
    }
    await services.changePassword(accountId, currentPassword, newPassword);
    res.status(200).send({
      success: true,
      data: { sessionRevoked: true, message: "Password updated" },
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { email } = req.body;
    await services.forgotPassword(email);
    res.status(204).send({
      success: true,
      data: {
        message: "If that email is registered, a reset link has been sent.",
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // const accountId = req.user.id;
    const { token, newPassword, confirmNewPassword } = req.body;
    if (newPassword !== confirmNewPassword) {
      throw AppError.badRequest("New passwords do not match.");
    }
    await services.resetPassword(token, newPassword);
    res.status(204).send({
      success: true,
      data: { message: "Password reset. Please log in." },
    });
  } catch (error) {
    next(error);
  }
}

export async function getSession(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const accountId = getAuthenticatedAccountId(req);
		const session = await services.getSession(accountId);
		res.status(200).send({ success: true, data: session });
	} catch (error) {
		next(error);
	}
}