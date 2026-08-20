import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { healthRouter } from './routes/health.route';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.use('/health', healthRouter);

  // Feature routers land here as they're built, e.g.:
  //   app.use('/api/v1/works', worksRouter);        // N4 — search + status
  //   app.use('/api/v1/tags', tagsRouter);           // N3 — interest tags
  //   app.use('/api/v1/gov-sites', govSitesRouter);  // N1 — source config
  //   app.use('/api/v1/accounts', accountsRouter);   // N2 — unified accounts

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
