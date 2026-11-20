import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One command for the API load tests:  npm run perf
//
//   1. a throwaway MongoDB (PERF_MONGODB_URI, or a disposable mongo:7 container)
//   2. seeds a realistic data set (perf/seed.ts; PERF_WORKS works, default 20,000)
//   3. starts the API in PRODUCTION mode on PERF_PORT (default 4100) -- not your
//      dev stack on 4000 -- with SMTP off, AI off and the government feeds unreachable
//   4. runs the k6 scripts in perf/k6 (a local `k6` if installed, otherwise the
//      grafana/k6 Docker image) and checks their thresholds:
//        search      p95 <= 1.5 s for typical faceted searches at 5 searches/s
//        poll-now    30 admins press Poll Now at once: exactly one 201, the rest 409
//        login-load  10 sign-ins/s (bcrypt 12 rounds) while browsing: browse p95 < 1 s
//   5. prints a summary and exits non-zero if any threshold failed.
//
//   npm run perf -- search login        only these scripts
//   PERF_WORKS=100000 npm run perf      a bigger data set
//   PERF_RATE=15 PERF_DURATION=120s     heavier / longer search load (the regex
//                                       search saturates MongoDB between 10 and
//                                       20 searches/s on a 12-core machine)
//
//   npm run perf -- --serve             seed + start the API, then keep it running
//                                       (for Lighthouse or manual probing) until Ctrl+C
//
// Page load (Lighthouse) is separate: npm run perf:lighthouse (perf/lighthouse.ts).

const backendRoot = path.resolve(__dirname, '..');
const K6_IMAGE = 'grafana/k6:0.54.0';
const SCRIPTS = ['search', 'poll-now', 'login-load'] as const;
type Script = (typeof SCRIPTS)[number];

interface Outcome {
  script: Script;
  exitCode: number | null;
  summary: Record<string, unknown> | null;
  extra?: string;
}

function k6Command(): 'local' | 'docker' {
  return spawnSync('k6', ['version'], { encoding: 'utf8' }).status === 0 ? 'local' : 'docker';
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy at ${url}`);
}

function metric(summary: Record<string, unknown> | null, name: string, stat: string): string {
  const m = (summary?.metrics as Record<string, Record<string, unknown>> | undefined)?.[name];
  const value = m?.[stat] ?? (m?.values as Record<string, unknown> | undefined)?.[stat];
  if (typeof value !== 'number') return 'n/a';
  return stat === 'count' || stat === 'rate' || stat === 'value' ? String(Math.round(value * 1000) / 1000) : `${Math.round(value)} ms`;
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const scripts = SCRIPTS.filter(s => wanted.length === 0 || wanted.some(w => s.includes(w)));
  const port = Number(process.env.PERF_PORT ?? 4100);
  const works = Number(process.env.PERF_WORKS ?? 20_000);

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'b2g-perf-'));
  const emptyEnv = path.join(scratch, '.env.empty');
  await fs.writeFile(emptyEnv, '');
  // This process imports the app's models to seed: keep Backend/.env out of it too.
  process.env.DOTENV_CONFIG_PATH = emptyEnv;
  process.env.SMTP_HOST = '';

  const { startThrowawayMongo } = await import('../tests/helpers/throwawayMongo');
  const mongo = await startThrowawayMongo('perf', process.env.PERF_MONGODB_URI);
  const uri = `${mongo.baseUri}/b2g-perf`;
  process.env.MONGODB_URI = uri;

  let api: ChildProcess | null = null;
  const cleanup = (): void => {
    api?.kill();
    mongo.stop();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const stateDir = path.join(__dirname, '.state');
  const resultsDir = path.join(stateDir, 'results');
  await fs.mkdir(resultsDir, { recursive: true });

  console.log(`Seeding ${works} works ...`);
  const t0 = Date.now();
  const { seedPerfData } = await import('./seed');
  const mongoose = (await import('mongoose')).default;
  const state = await seedPerfData(uri, { works });
  console.log(`Seeded ${JSON.stringify(state.counts)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // A fresh API process per k6 script: requests a saturated run abandoned keep
  // running on the server for minutes and would otherwise poison the next script.
  // The API writes its log straight to a file: if it wrote into a pipe this
  // process must drain, a busy moment here would fill the pipe and freeze the API
  // on its next log line.
  const apiLog = path.join(resultsDir, 'api.log');
  const logFd = openSync(apiLog, 'w');
  const startApi = async (): Promise<void> => {
    api = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        MONGODB_URI: uri,
        APP_URL: 'https://perf.b2gvendor.test',
        // The frontend on :3100, and the same through the HTTP/2 proxy (perf/h2-proxy.ts).
        CORS_ORIGIN: 'http://localhost:3100,https://localhost:3443',
        DOTENV_CONFIG_PATH: emptyEnv,
        SMTP_HOST: '',
        AI_TAGGING_ENABLED: 'false',
        EGP_RSS_BASE_URL: 'http://127.0.0.1:9/egp-is-not-reachable-from-perf',
        DATA_GO_TH_BASE_URL: 'http://127.0.0.1:9/data-go-th-is-not-reachable-from-perf',
        TOR_STORAGE_DIR: path.join(scratch, 'tor'),
        // A load test measures capacity, not the per-address limits: k6 sends
        // every request from one address, which the search and Poll Now
        // limiters (ASVS V2.4.1) would otherwise refuse after a minute.
        SEARCH_RATE_LIMIT_PER_MINUTE: process.env.PERF_SEARCH_RATE_LIMIT ?? '1000000',
        POLL_RATE_LIMIT_PER_MINUTE: process.env.PERF_POLL_RATE_LIMIT ?? '1000000'
      },
      stdio: ['ignore', logFd, logFd]
    });
    await waitForHealth(`http://127.0.0.1:${port}/health`, 60_000);
  };
  const stopApi = async (): Promise<void> => {
    if (!api || api.exitCode !== null) return;
    const exited = new Promise(resolve => api!.once('exit', resolve));
    api.kill();
    await exited;
  };
  // Stopping the API doesn't stop the queries it already sent: MongoDB keeps
  // running an abandoned scan to the end. Kill them so a saturated script can't
  // leave the database busy for the next one.
  const killLeftoverQueries = async (): Promise<number> => {
    const admin = mongoose.connection.db!.admin();
    let killed = 0;
    for (let round = 0; round < 20; round++) {
      const { inprog } = (await admin.command({ currentOp: 1, active: true, ns: { $regex: '^b2g-perf\.' } })) as { inprog: { opid: number; op: string }[] };
      const ops = inprog.filter(op => op.op !== 'none' && op.op !== 'getmore');
      if (ops.length === 0) break;
      for (const op of ops) await admin.command({ killOp: 1, op: op.opid }).catch(() => undefined);
      killed += ops.length;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return killed;
  };
  await startApi();
  console.log(`API (production mode) on :${port}; request log -> ${apiLog}`);

  if (process.argv.includes('--serve')) {
    console.log(`Serving the seeded API at http://127.0.0.1:${port}/api/v1 (Mongo: ${uri}). Ctrl+C to stop.`);
    await new Promise(() => undefined);
  }

  const runner = k6Command();
  console.log(`k6: ${runner === 'local' ? 'local binary' : K6_IMAGE + ' (Docker)'}`);
  const outcomes: Outcome[] = [];

  for (const script of scripts) {
    await stopApi();
    const killed = await killLeftoverQueries();
    if (killed > 0) console.log(`(killed ${killed} query/queries left running by the previous script)`);
    await startApi();
    if (script === 'poll-now') {
      await mongoose.connection.collection('polljobs').deleteMany({});
    }
    const summaryFile = path.join(resultsDir, `${script}.json`);
    await fs.rm(summaryFile, { force: true });
    const env = {
      RATE: process.env.PERF_RATE ?? '5',
      DURATION: process.env.PERF_DURATION ?? '60s',
      LOGIN_RATE: process.env.PERF_LOGIN_RATE ?? '10',
      BROWSE_RATE: process.env.PERF_BROWSE_RATE ?? '20'
    };
    const args =
      runner === 'local'
        ? ['run', '--quiet', '--summary-export', summaryFile, ...Object.entries({ ...env, BASE_URL: `http://127.0.0.1:${port}/api/v1`, STATE_FILE: path.join(stateDir, 'perf-state.json') }).flatMap(([k, v]) => ['-e', `${k}=${v}`]), path.join(__dirname, 'k6', `${script}.js`)]
        : [
            'run', '--rm', '--add-host=host.docker.internal:host-gateway',
            '-v', `${path.join(__dirname, 'k6')}:/scripts:ro`,
            '-v', `${stateDir}:/state`,
            ...Object.entries({ ...env, BASE_URL: `http://host.docker.internal:${port}/api/v1`, STATE_FILE: '/state/perf-state.json' }).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
            K6_IMAGE, 'run', '--quiet', '--summary-export', `/state/results/${script}.json`, `/scripts/${script}.js`
          ];
    console.log(`\n=== k6 ${script}`);
    // Asynchronous, so this process stays responsive while k6 runs.
    const k6 = spawn(runner === 'local' ? 'k6' : 'docker', args, { stdio: 'inherit' });
    const run = { status: await new Promise<number | null>(resolve => k6.once('exit', code => resolve(code))) };
    const summary = existsSync(summaryFile) ? (JSON.parse(await fs.readFile(summaryFile, 'utf8')) as Record<string, unknown>) : null;
    const outcome: Outcome = { script, exitCode: run.status, summary };
    if (script === 'poll-now') {
      const jobs = await mongoose.connection.collection('polljobs').countDocuments({});
      outcome.extra = `PollJob rows after the burst: ${jobs}`;
      if (jobs !== 1) outcome.exitCode = outcome.exitCode || 1;
    }
    outcomes.push(outcome);
  }

  // ---- summary
  console.log('\n================ performance summary ================');
  console.log(`data: ${state.counts.works} works, ${state.counts.vendors} vendors, ${state.counts.follows} follows, ${state.siteIds.length} sites`);
  for (const o of outcomes) {
    const ok = o.exitCode === 0;
    const s = o.summary;
    let line = '';
    if (o.script === 'search') {
      line = `search p95 ${metric(s, 'http_req_duration{name:search}', 'p(95)')} (budget 1500 ms), p99 ${metric(s, 'http_req_duration{name:search}', 'p(99)')}, max ${metric(s, 'http_req_duration{name:search}', 'max')}, requests ${metric(s, 'http_reqs{name:search}', 'count')}, failed ${metric(s, 'http_req_failed{name:search}', 'value')}`;
    } else if (o.script === 'poll-now') {
      line = `accepted ${metric(s, 'poll_accepted', 'count')}, 409 ${metric(s, 'poll_conflict', 'count')}, other ${metric(s, 'poll_unexpected', 'count')}, p95 ${metric(s, 'poll_now_duration', 'p(95)')}; ${o.extra}`;
    } else {
      line = `browse p95 ${metric(s, 'http_req_duration{scenario:browse_baseline}', 'p(95)')} before vs ${metric(s, 'http_req_duration{scenario:browse_under_logins}', 'p(95)')} during sign-ins (budget 1000 ms); login checks ok ${metric(s, 'checks{check:login ok}', 'value')}`;
    }
    const retries = metric(s, 'connection_retries', 'count');
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${o.script.padEnd(11)} ${line}${retries !== 'n/a' && retries !== '0' ? ` [${retries} request(s) re-sent after a connect timeout before reaching the API]` : ''}`);
  }
  console.log(`\nk6 summaries: ${resultsDir}`);

  await mongoose.disconnect();
  cleanup();
  closeSync(logFd);
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  process.exit(outcomes.every(o => o.exitCode === 0) ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
