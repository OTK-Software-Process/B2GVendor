import { Router } from 'express';
import { z } from 'zod';
import * as accountController from '../controllers/account.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';

const businessProfileSchema = z.object({
	companyName: z.string().trim().min(1).max(200),
	taxId: z.string().regex(/^\d{13}$/, 'Tax ID must be exactly 13 digits'),
});

const updateProfileSchema = z.object({
	name: z.string().trim().min(1).max(150).optional(),
	phone: z
		.string()
		.trim()
		.regex(/^(\+66|0)[\d\-\s]{8,12}$/, 'Invalid Thai phone number')
		.optional(),
	businessProfile: businessProfileSchema.optional(),
}).strict();

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(8),
	confirmNewPassword: z.string().min(8),
}).strict();

export const accountRouter = Router();

accountRouter.use(requireAuth);

accountRouter.get('/api/v1/accounts/profile', accountController.getProfile);

accountRouter.patch('/api/v1/accounts/profile', validate(updateProfileSchema), accountController.updateProfile);

accountRouter.post(
	'/api/v1/accounts/change-password',
	validate(changePasswordSchema),
	accountController.changePassword,
);
