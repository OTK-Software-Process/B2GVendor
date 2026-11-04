// Must stay the FIRST import: the audit plugin only covers models compiled after it.
import './audit/install';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { corsOrigins, env, isProduction } from './config/env';
import { logger } from './utils/logger';
import { healthRouter } from './routes/health.route';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { sanitizeInput } from './middlewares/sanitize.middleware';
import { csrfProtection } from './middlewares/csrf.middleware';
import { securityHeaders } from './middlewares/securityHeaders.middleware';
import { auditContextMiddleware } from './middlewares/auditContext.middleware';

export function createApp() {
  const app = express();

  // Stop Express announcing itself ("X-Powered-By: Express") at all, rather than relying on removing it later.
  app.disable('x-powered-by');

  if (isProduction) {
    app.set('trust proxy', 1);
  }

  // SameSite=None sends the session cookie on cross-site requests, so the origin
  // check in csrfProtection() is then the ONLY thing standing between a hostile
  // page and a logged-in admin. Make that visible.
  if (env.COOKIE_SAMESITE === 'none') {
    logger.warn('csrf', `COOKIE_SAMESITE=none: CSRF protection relies on CORS_ORIGIN listing exactly the trusted frontend origins (${corsOrigins.join(', ')})`);
  }

  // First, so EVERY response carries the headers: success, errors, 404s and CORS preflights alike.
  app.use(securityHeaders(isProduction));

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true
    })
  );
  // After CORS (so a refusal still carries CORS headers the frontend can read) and
  // BEFORE the body parser and every route: a request that fails is never parsed or handled.
  app.use(csrfProtection(corsOrigins));
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeInput);
  app.use(cookieParser());
  app.use(morgan(isProduction ? 'combined' : 'dev'));
  // After the body/cookie parsers, before any route: opens the audit context
  // (actor/IP/request id) that audit.log() reads for the rest of the request.
  app.use(auditContextMiddleware);

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
