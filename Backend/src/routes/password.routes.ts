import { Router } from 'express';
import { z } from 'zod';
import * as accountController from '../controllers/account.controller';
import { validate } from '../middlewares/validate.middleware';

const forgotPasswordSchema = z.object({
	email: z.string().trim().email(),
}).strict();

const resetPasswordSchema = z.object({
	token: z.string().min(1),
	newPassword: z.string().min(8),
	confirmNewPassword: z.string().min(8),
}).strict();

export const passwordRouter = Router();

passwordRouter.post(
	'/forgot-password',
	validate(forgotPasswordSchema),
	accountController.forgotPassword,
);
passwordRouter.post(
	'/reset-password',
	validate(resetPasswordSchema),
	accountController.resetPassword,
);
