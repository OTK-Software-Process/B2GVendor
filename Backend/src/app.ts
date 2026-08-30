import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { corsOrigins, isProduction } from './config/env';
import { healthRouter } from './routes/health.route';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { sanitizeInput } from './middlewares/sanitize.middleware';

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

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
