import * as services from "../services/account.service";
import { AppError } from "../utils/AppError";

export async function getProfile(req, res, next) {
  try {
    const accountId = req.user.id;
    const account = await services.getProfile(accountId);
    res.json(account);
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req, res, next) {
	try {
		const accountId = req.user.id;
		const updateData = req.body;
		const updatedAccount = await services.updateProfile(accountId, updateData);
		res.json(updatedAccount);
	} catch (error) {
		next(error);
	}
}

export async function changePassword(req, res, next) {
	try {
		const accountId = req.user.id;
		const { currentPassword, newPassword, confirmNewPassword } = req.body;
		if (newPassword !== confirmNewPassword) {
			throw AppError.badRequest("New passwords do not match.");
		}
		await services.changePassword(accountId, currentPassword, newPassword);
		res.status(204).send();
	} catch (error) {
		next(error);
	}
}

export async function forgotPassword(req, res, next) {
	try {
		const { email } = req.body;
		await services.forgotPassword(email);
	} catch (error) {
		next(error);
	}
}

export async function resetPassword(req, res, next) {
	try {
		// const accountId = req.user.id;
		const { token, newPassword, confirmNewPassword } = req.body;
		if (newPassword !== confirmNewPassword) {
			throw AppError.badRequest("New passwords do not match.");
		}
		await services.resetPassword(token, newPassword);
		res.status(204).send({ success: true, data: { message: "Password reset. Please log in." } });
	} catch (error) {
		next(error);
	}
}
