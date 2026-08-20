import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`[server] listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch(err => {
  console.error('[fatal] failed to start server', err);
  process.exit(1);
});
