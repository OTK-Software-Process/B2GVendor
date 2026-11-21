import { Router } from 'express';
import { register, login, logout, me, verifyEmail, verifyMfa } from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';
import { registerSchema, loginSchema, verifyEmailSchema, mfaVerifySchema } from '../validators/auth.validator';
import { requireAuth, requireMfaChallenge } from '../middlewares/auth.middleware';
import { loginLimiter, mfaVerifyLimiter, registerLimiter } from '../middlewares/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

export const authRouter = Router();

authRouter.post('/register', registerLimiter, validate(registerSchema), asyncHandler(register));
authRouter.post('/verify-email', validate(verifyEmailSchema), asyncHandler(verifyEmail));
authRouter.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
// The second half of a sign-in: accepts only the challenge a correct password produced.
authRouter.post('/mfa/verify', mfaVerifyLimiter, requireMfaChallenge, validate(mfaVerifySchema), asyncHandler(verifyMfa));
authRouter.post('/logout', requireAuth, asyncHandler(logout));
authRouter.get('/me', requireAuth, asyncHandler(me));
