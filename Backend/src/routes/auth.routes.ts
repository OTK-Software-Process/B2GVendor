import { Router } from 'express';
import { register, login, logout, me } from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';
import { registerSchema, loginSchema } from '../validators/auth.validator';
import { requireAuth } from '../middlewares/auth.middleware';
import { loginLimiter, registerLimiter } from '../middlewares/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

export const authRouter = Router();

authRouter.post('/register', registerLimiter, validate(registerSchema), asyncHandler(register));
authRouter.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
authRouter.post('/logout', requireAuth, asyncHandler(logout));
authRouter.get('/me', requireAuth, asyncHandler(me));
