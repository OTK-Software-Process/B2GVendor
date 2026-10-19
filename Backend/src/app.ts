// Must stay the FIRST import: the audit plugin only covers models compiled after it.
import './audit/install';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { corsOrigins, isProduction } from './config/env';
import { healthRouter } from './routes/health.route';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { sanitizeInput } from './middlewares/sanitize.middleware';
import { auditContextMiddleware } from './middlewares/auditContext.middleware';

export function createApp() {
  const app = express();

  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true
    })
  );
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
