import { Router } from 'express';
import * as mfaController from '../controllers/mfa.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { mfaManageLimiter } from '../middlewares/rateLimit.middleware';
import { validate } from '../middlewares/validate.middleware';
import { mfaChangeSchema, mfaEnableSchema, mfaSetupSchema } from '../validators/mfa.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Mounted at /account/mfa. Signed-in accounts only, but deliberately NOT behind a
// role: a staff account that has to set up its second factor reaches nothing else.
export const mfaRouter = Router();

mfaRouter.use(requireAuth);

mfaRouter.get('/', asyncHandler(mfaController.status));
mfaRouter.post('/setup', mfaManageLimiter, validate(mfaSetupSchema), asyncHandler(mfaController.setup));
mfaRouter.post('/enable', mfaManageLimiter, validate(mfaEnableSchema), asyncHandler(mfaController.enable));
mfaRouter.post('/recovery-codes', mfaManageLimiter, validate(mfaChangeSchema), asyncHandler(mfaController.regenerateRecoveryCodes));
mfaRouter.post('/disable', mfaManageLimiter, validate(mfaChangeSchema), asyncHandler(mfaController.disable));
