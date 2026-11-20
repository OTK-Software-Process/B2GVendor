import { createApp } from './app';
import { verifyAuditSetup } from './audit/install';
import { connectDb } from './config/db';
import { env } from './config/env';
import { installProcessHandlers } from './utils/processHandlers';
import { installEgressProxy } from './config/egressProxy';
import { logger } from './utils/logger';

installProcessHandlers('api');
installEgressProxy();

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();
  for (const problem of verifyAuditSetup()) logger.error('audit', problem);

  app.listen(env.PORT, () => {
    logger.info('server', `listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch(err => {
  logger.error('server', 'failed to start', err);
  process.exit(1);
});
