import { Router } from 'express';
import { z } from 'zod';
import * as accountController from '../controllers/account.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';

const NAME_REGEX = /^[\p{L}][\p{L}\p{M}'-]*(?: [\p{L}][\p{L}\p{M}'-]*)?$/u;

const businessProfileSchema = z.object({
	companyName: z.string().trim().min(1).max(200),
	taxId: z.string().regex(/^\d{13}$/, 'Tax ID must be exactly 13 digits'),
});

const updateProfileSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.max(150)
		.regex(NAME_REGEX, 'Name can only contain letters, hyphens, and apostrophes, with at most one space')
		.optional(),
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

accountRouter.get('/profile', accountController.getProfile);

accountRouter.patch('/profile', validate(updateProfileSchema), accountController.updateProfile);

accountRouter.post(
	'/change-password',
	validate(changePasswordSchema),
	accountController.changePassword,
);
