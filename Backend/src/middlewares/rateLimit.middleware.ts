import { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { fail } from '../utils/apiResponse';
import { logger } from '../utils/logger';

const MINUTE = 60 * 1000;

function createLimiter(
  name: string,
  windowMs: number,
  limit: number,
  message: string,
  keyGenerator?: (req: Request) => string
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => {
      // A refused request is a security event worth seeing (ASVS V16.3.3).
      logger.security('warn', 'rate_limit.exceeded', { limiter: name, method: req.method, path: req.originalUrl.split('?')[0], ip: req.ip });
      const error = AppError.rateLimited(message);
      fail(res, error.status, error.code, error.message);
    }
  });
}

export const loginLimiter = createLimiter(
  'sign-in',
  15 * MINUTE,
  10,
  'Too many sign-in attempts. Please try again in a few minutes.'
);

export const registerLimiter = createLimiter(
  'sign-up',
  60 * MINUTE,
  5,
  'Too many accounts created from this address. Please try again later.'
);

export const passwordResetLimiter = createLimiter(
  'password-reset',
  60 * MINUTE,
  5,
  'Too many password reset requests. Please try again later.'
);

// Public search: the costliest public read (a typo-tolerant regex scan), so the
// one a scraper or a flood would aim at. Counted per client address.
export const searchLimiter = createLimiter(
  'search',
  MINUTE,
  env.SEARCH_RATE_LIMIT_PER_MINUTE,
  'Too many searches. Please wait a moment and try again.'
);

// Poll Now: counted per signed-in admin (the route sits behind requireAuth), so
// several admins in one office don't share a budget.
export const pollLimiter = createLimiter(
  'poll-now',
  MINUTE,
  env.POLL_RATE_LIMIT_PER_MINUTE,
  'Too many poll requests. Please wait a moment and try again.',
  req => (req.account ? `account:${String(req.account._id)}` : `ip:${req.ip}`)
);
