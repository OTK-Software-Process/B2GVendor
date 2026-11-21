import { spawn, ChildProcess } from 'node:child_process';
import { promises as fs, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startThrowawayMongo, MongoServer } from './helpers/throwawayMongo';

// One command for the whole backend test suite:  npm test
//
// Runs every `check:*` script in package.json (so a new check is picked up the
// moment it gets a script) against a THROWAWAY MongoDB, one database per check,
// and exits non-zero if any check fails, times out, or points at a file that
// doesn't exist.
//
//   npm test                      every check
//   npm test -- auth csrf         only checks whose name contains "auth" or "csrf"
//   npm test -- --bail            stop at the first failure
//   npm test -- --jobs=4          run 4 checks at a time (each has its own DB)
//   npm test -- --list            print the checks that would run, and exit
//   npm test -- --timeout=300     per-check time limit in seconds (default 600)
//
// Where the database comes from:
//   - TEST_MONGODB_URI set (CI: the workflow's Mongo service container) -> used
//     as the server; each check gets its own `b2g-<name>-check` database on it.
//   - otherwise a disposable `mongo:7` container is started on a random local
//     port with its data in RAM (--tmpfs) and removed when the run ends. It never
//     touches the dev database on 27017.
//
// Every check runs hermetically, whatever is in Backend/.env:
//   - Backend/.env is NOT loaded (DOTENV_CONFIG_PATH points at an empty file);
//   - SMTP_HOST is set empty, so no real email can go out (checks that test
//     mail start their own in-memory SMTP server -- tests/helpers/fakeSmtp.ts);
//   - AI tagging is off and no AI key is passed through;
//   - the e-GP feed and data.go.th point at a closed local port, so a check that
//     forgets to start its own mock server fails instead of hitting the live sites;
//   - downloaded TOR files go to a temp folder per check;
//   - the search and Poll Now rate limits are lifted (rate-limits.check.ts tests them).

const backendRoot = path.resolve(__dirname, '..');

interface Options {
  filters: string[];
  bail: boolean;
  jobs: number;
  list: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { filters: [], bail: false, jobs: 1, list: false, timeoutMs: 600_000 };
  for (const arg of argv) {
    if (arg === '--bail') options.bail = true;
    else if (arg === '--list') options.list = true;
    else if (arg.startsWith('--jobs=')) options.jobs = Math.max(1, Number(arg.slice(7)) || 1);
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Math.max(1, Number(arg.slice(10)) || 600) * 1000;
    else if (arg.startsWith('--')) {
      console.error(`Unknown option ${arg}`);
      process.exit(2);
    } else options.filters.push(arg.toLowerCase());
  }
  return options;
}

interface Check {
  name: string; // "check:auth"
  command: string; // the script as written in package.json
  file: string | null; // the .ts file it runs (null if the script isn't "tsx <file>")
}

function discoverChecks(filters: string[]): Check[] {
  const pkg = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  return Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('check:'))
    .filter(([name]) => filters.length === 0 || filters.some(f => name.toLowerCase().includes(f)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, command]) => {
      const match = command.trim().match(/^tsx\s+(\S+\.ts)$/);
      return { name, command, file: match ? match[1] : null };
    });
}

// --- running one check ----------------------------------------------------------

interface Result {
  name: string;
  status: 'pass' | 'fail' | 'timeout' | 'missing';
  exitCode: number | null;
  durationMs: number;
  output: string;
}

const running = new Set<ChildProcess>();

function dbNameFor(checkName: string): string {
  return `b2g-${checkName.replace(/^check:/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-check`;
}

async function runCheck(check: Check, mongo: MongoServer, emptyEnvFile: string, options: Options, stream: boolean): Promise<Result> {
  const started = Date.now();

  if (check.file && !existsSync(path.join(backendRoot, check.file))) {
    const output = `${check.name} runs "${check.command}", but ${check.file} does not exist.\n`;
    if (stream) process.stdout.write(output);
    return { name: check.name, status: 'missing', exitCode: null, durationMs: 0, output };
  }

  const torDir = await fs.mkdtemp(path.join(os.tmpdir(), `b2g-${check.name.replace(/\W+/g, '-')}-`));
  const uri = `${mongo.baseUri}/${dbNameFor(check.name)}`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Nothing mail- or AI-related from the developer's shell either.
  for (const key of ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'OPENROUTER_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS', 'DATA_GO_TH_API_KEY', 'DATA_GO_TH_DEFAULT_PACKAGE_ID', 'DATA_GO_TH_DEFAULT_SEARCH_QUERY']) {
    delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: emptyEnvFile,
    MONGODB_URI: uri,
    CHECK_MONGODB_URI: uri,
    SMTP_HOST: '',
    AI_TAGGING_ENABLED: 'false',
    INGESTION_TOPIC_FILTER_ENABLED: 'false',
    EGP_RSS_BASE_URL: 'http://127.0.0.1:9/egp-rss-is-not-reachable-from-tests',
    DATA_GO_TH_BASE_URL: 'http://127.0.0.1:9/data-go-th-is-not-reachable-from-tests',
    TOR_STORAGE_DIR: torDir,
    // The search and Poll Now limiters count per address, and every check sends
    // all its requests from 127.0.0.1. They are tested on their own in
    // rate-limits.check.ts, which sets its own low values.
    SEARCH_RATE_LIMIT_PER_MINUTE: '1000000',
    POLL_RATE_LIMIT_PER_MINUTE: '1000000',
    // Two-step verification: a fixed, throw-away key (never a real one), and staff are
    // NOT required to use it here, so the many checks that sign in as an Admin with
    // only a password keep working. mfa.check.ts switches the requirement on itself.
    MFA_ENCRYPTION_KEY: 'EATP5lMNulu44CY004/KGqq1+KLkO5BiZE6FMSuIbho=',
    MFA_REQUIRED_FOR_STAFF: 'false',
    FORCE_COLOR: '0'
  });

  const [command, args] = check.file
    ? [process.execPath, [require.resolve('tsx/cli'), check.file]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '--silent', check.name]];

  return new Promise<Result>(resolve => {
    const child = spawn(command, args, { cwd: backendRoot, env, shell: !check.file && process.platform === 'win32' });
    running.add(child);
    let output = '';
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output += text;
      if (stream) process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      running.delete(child);
      fs.rm(torDir, { recursive: true, force: true }).catch(() => undefined);
      const status: Result['status'] = timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail';
      if (timedOut) {
        const note = `\n${check.name} was stopped after ${options.timeoutMs / 1000}s.\n`;
        output += note;
        if (stream) process.stdout.write(note);
      }
      resolve({ name: check.name, status, exitCode: code, durationMs: Date.now() - started, output });
    });
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checks = discoverChecks(options.filters);

  if (checks.length === 0) {
    console.error(`No check:* script matches ${options.filters.join(', ')}`);
    process.exit(2);
  }
  if (options.list) {
    for (const check of checks) console.log(`${check.name.padEnd(28)} ${check.command}`);
    return;
  }

  const mongo = await startThrowawayMongo('test', process.env.TEST_MONGODB_URI);
  const cleanup = (): void => {
    for (const child of running) child.kill('SIGKILL');
    mongo.stop();
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(130);
    });
  }

  const emptyEnvDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b2g-test-env-'));
  const emptyEnvFile = path.join(emptyEnvDir, '.env.test-empty');
  await fs.writeFile(emptyEnvFile, '# intentionally empty: tests never read Backend/.env\n');

  const results: Result[] = [];
  const queue = [...checks];
  const stream = options.jobs === 1;
  let stop = false;
  const startedAll = Date.now();

  const worker = async (): Promise<void> => {
    while (!stop) {
      const check = queue.shift();
      if (!check) return;
      if (stream) console.log(`\n=== ${check.name}  (${check.command})`);
      const result = await runCheck(check, mongo, emptyEnvFile, options, stream);
      if (!stream) {
        console.log(`\n=== ${check.name}  (${check.command})\n${result.output.trimEnd()}`);
      }
      console.log(`--- ${check.name}: ${result.status.toUpperCase()} in ${seconds(result.durationMs)}`);
      results.push(result);
      if (options.bail && result.status !== 'pass') stop = true;
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.jobs, checks.length) }, worker));
  await fs.rm(emptyEnvDir, { recursive: true, force: true }).catch(() => undefined);

  const failed = results.filter(r => r.status !== 'pass');
  const skipped = checks.length - results.length;
  console.log('\n================ summary ================');
  for (const r of [...results].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${r.status.toUpperCase().padEnd(7)}  ${r.name.padEnd(28)} ${seconds(r.durationMs)}`);
  }
  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed${skipped ? `, ${skipped} not run (--bail)` : ''} in ${seconds(Date.now() - startedAll)}`
  );

  cleanup();
  process.exit(failed.length === 0 && skipped === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  for (const child of running) child.kill('SIGKILL');
  process.exit(2);
});
