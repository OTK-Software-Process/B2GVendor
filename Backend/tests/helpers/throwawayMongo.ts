import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';

// A MongoDB nobody else uses, for the test runner (tests/run-all.ts) and the
// performance runner (perf/run.ts):
//   - `uriFromEnv` set (CI: the workflow's Mongo service container) -> that server;
//   - otherwise a disposable `mongo:7` container on a random 127.0.0.1 port, data
//     in RAM (--tmpfs), removed by stop(). It never touches the dev DB on 27017.

export interface MongoServer {
  baseUri: string; // mongodb://host:port  (no database)
  stop(): void;
}

function stripDatabase(uri: string): string {
  const url = new URL(uri);
  url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

export async function waitForMongo(baseUri: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const conn = mongoose.createConnection(`${baseUri}/admin`, { serverSelectionTimeoutMS: 1000 });
    try {
      await conn.asPromise();
      await conn.db!.admin().ping();
      await conn.close();
      return;
    } catch (err) {
      lastError = err;
      await conn.close().catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(`MongoDB at ${baseUri} did not answer within ${timeoutMs / 1000}s: ${String(lastError)}`);
}

export async function startThrowawayMongo(label: string, uriFromEnv?: string): Promise<MongoServer> {
  if (uriFromEnv) {
    const baseUri = stripDatabase(uriFromEnv);
    await waitForMongo(baseUri, 60_000);
    return { baseUri, stop: () => undefined };
  }

  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (docker.status !== 0) {
    throw new Error(
      'No database: set TEST_MONGODB_URI / PERF_MONGODB_URI (e.g. mongodb://127.0.0.1:27018) or start Docker so a throwaway mongo:7 container can be used.'
    );
  }

  const name = `b2g-${label}-mongo-${process.pid}-${Date.now().toString(36)}`;
  const run = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::27017', '--tmpfs', '/data/db', 'mongo:7', '--quiet'],
    { encoding: 'utf8' }
  );
  if (run.status !== 0) throw new Error(`Could not start the throwaway mongo container: ${run.stderr || run.stdout}`);

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  };

  const portOut = spawnSync('docker', ['port', name, '27017/tcp'], { encoding: 'utf8' });
  const hostPort = portOut.stdout.split(/\r?\n/).find(line => line.startsWith('127.0.0.1:'));
  if (!hostPort) {
    stop();
    throw new Error(`Could not read the throwaway mongo container's port: ${portOut.stdout}${portOut.stderr}`);
  }

  const baseUri = `mongodb://${hostPort}`;
  try {
    await waitForMongo(baseUri, 60_000);
  } catch (err) {
    stop();
    throw err;
  }
  console.log(`Throwaway MongoDB: container ${name} at ${baseUri} (removed when the run ends)`);
  return { baseUri, stop };
}
