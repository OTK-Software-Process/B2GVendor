import { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError';
import { fail } from '../utils/apiResponse';

const MINUTE = 60 * 1000;

function createLimiter(windowMs: number, limit: number, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      const error = AppError.rateLimited(message);
      fail(res, error.status, error.code, error.message);
    }
  });
}

export const loginLimiter = createLimiter(
  15 * MINUTE,
  10,
  'Too many sign-in attempts. Please try again in a few minutes.'
);

export const registerLimiter = createLimiter(
  60 * MINUTE,
  5,
  'Too many accounts created from this address. Please try again later.'
);

export const passwordResetLimiter = createLimiter(
  60 * MINUTE,
  5,
  'Too many password reset requests. Please try again later.'
);
