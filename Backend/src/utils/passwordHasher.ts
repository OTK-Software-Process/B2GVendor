import { createHmac } from 'node:crypto';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';
import { logger } from './logger';

// bcrypt (12 rounds) costs ~200 ms of CPU per sign-in. bcryptjs is pure
// JavaScript, so on the API's one main thread every sign-in blocked every other
// request: measured with perf/k6/login-load.js, 10 sign-ins/second took browse
// requests from a 41 ms p95 to 60 s timeouts (93% failed). Hashing and
// comparing now run in a small pool of worker threads -- other CPU cores -- and
// the event loop only waits for the answer.
//
// Same algorithm, same cost, same hash format ($2b$12$...): existing password
// hashes keep working. If a worker can't be started (unusual sandboxes), it
// falls back to bcryptjs on the main thread, i.e. the old behaviour.

// Plain JS evaluated in each worker (no separate file: identical under tsx in
// development and from dist/ in production). bcryptjs is loaded by absolute path.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const bcrypt = require(workerData.bcryptPath);
parentPort.on('message', ({ id, op, a, b }) => {
  try {
    const result = op === 'hash' ? bcrypt.hashSync(a, b) : bcrypt.compareSync(a, b);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});
`;

type Op = 'hash' | 'compare';
interface Task {
  id: number;
  op: Op;
  a: string;
  b: string | number;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
interface PoolWorker {
  worker: Worker;
  task: Task | null;
}

// Leave one core for the event loop; a few workers are plenty (each one is a
// full core at ~5 sign-ins/second). Override with PASSWORD_HASH_WORKERS.
function poolSize(): number {
  const configured = Number(process.env.PASSWORD_HASH_WORKERS);
  if (Number.isInteger(configured) && configured >= 1) return configured;
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
}

const workers: PoolWorker[] = [];
const queue: Task[] = [];
let nextId = 1;
// Set when worker threads turn out to be unavailable.
let disabled = false;
// PASSWORD_HASH_WORKERS=0 switches the pool off (hash on the main thread, the old
// behaviour). Read on every call, so a test can switch it after start-up.
function poolOff(): boolean {
  return disabled || process.env.PASSWORD_HASH_WORKERS === '0';
}

function startWorker(): PoolWorker | null {
  try {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath: require.resolve('bcryptjs') } });
    const entry: PoolWorker = { worker, task: null };
    worker.unref(); // an idle pool never keeps the process alive
    worker.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
      const task = entry.task;
      entry.task = null;
      worker.unref();
      if (task && task.id === msg.id) {
        if (msg.error !== undefined) task.reject(new Error(msg.error));
        else task.resolve(msg.result);
      }
      dispatch();
    });
    const fail = (err: Error): void => {
      const index = workers.indexOf(entry);
      if (index >= 0) workers.splice(index, 1);
      if (entry.task) entry.task.reject(err);
      entry.task = null;
      logger.warn('password', 'A password-hashing worker stopped; starting a new one', err);
      dispatch();
    };
    worker.on('error', fail);
    worker.on('exit', code => {
      if (code !== 0 && workers.includes(entry)) fail(new Error(`password worker exited with code ${code}`));
    });
    return entry;
  } catch (err) {
    logger.warn('password', 'Worker threads are unavailable -- hashing passwords on the main thread', err);
    disabled = true;
    return null;
  }
}

function dispatch(): void {
  while (queue.length > 0) {
    let free = workers.find(w => w.task === null);
    if (!free && workers.length < poolSize()) {
      const started = startWorker();
      if (!started) break;
      workers.push(started);
      free = started;
    }
    if (!free) return; // all busy: the next finished task dispatches again
    const task = queue.shift()!;
    free.task = task;
    free.worker.ref(); // keep the process alive while an answer is pending
    free.worker.postMessage({ id: task.id, op: task.op, a: task.a, b: task.b });
  }
  // Worker threads unavailable: drain what is queued on the main thread.
  if (poolOff()) {
    for (const task of queue.splice(0)) runInline(task);
  }
}

function runInline(task: Task): void {
  const done = task.op === 'hash' ? bcrypt.hash(task.a, task.b) /* a salt string (or a cost) */ : bcrypt.compare(task.a, task.b as string);
  done.then(task.resolve, task.reject);
}

function submit<T>(op: Op, a: string, b: string | number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task: Task = { id: nextId++, op, a, b, resolve: resolve as (value: unknown) => void, reject };
    if (poolOff()) return runInline(task);
    queue.push(task);
    dispatch();
  });
}

// ---------------------------------------------------------------- the scheme
//
// bcrypt reads only the first 72 BYTES of its input: a longer password is cut
// short, and 64 Thai characters (3 bytes each) did not fit at all, so the policy
// had to stop at 72 bytes (ASVS V6.2.9). Passwords are therefore pre-hashed:
//
//   stored = "bcrypt-sha256$" + bcrypt( base64( HMAC-SHA256(key = bcrypt salt, password) ), salt )
//
// The HMAC turns any password into 44 ASCII characters, well inside bcrypt's
// limit, and keying it with the per-password bcrypt salt means a leaked list of
// plain SHA-256 password hashes can't be tested against our hashes directly
// ("hash shucking"). This is the same construction as passlib's bcrypt_sha256 v2.
//
// Hashes made before 2026-11-20 are plain bcrypt ("$2b$..."): they still verify,
// and loginWithPassword() upgrades each one at its next successful sign-in
// (needsRehash below, ASVS V11.2.2).

export const PASSWORD_HASH_PREFIX = 'bcrypt-sha256$';
const LEGACY_MAX_BYTES = 72;

function prehash(plain: string, salt: string): string {
  return createHmac('sha256', salt).update(plain, 'utf8').digest('base64');
}

/** Hash of `plain` in the current scheme with `rounds` bcrypt cost, computed off the main thread. */
export async function hashPassword(plain: string, rounds: number): Promise<string> {
  const salt = bcrypt.genSaltSync(rounds); // random 128-bit salt, "$2b$<rounds>$" + 22 chars
  return PASSWORD_HASH_PREFIX + (await submit<string>('hash', prehash(plain, salt), salt));
}

/** Whether `plain` matches a stored hash of either scheme, computed off the main thread. */
export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PASSWORD_HASH_PREFIX)) {
    const inner = stored.slice(PASSWORD_HASH_PREFIX.length);
    return submit<boolean>('compare', prehash(plain, inner.slice(0, 29)), inner);
  }
  // A legacy plain-bcrypt hash only ever held a password of at most 72 bytes.
  // Refuse a longer one outright rather than let bcrypt compare its first 72 bytes.
  if (Buffer.byteLength(plain, 'utf8') > LEGACY_MAX_BYTES) return Promise.resolve(false);
  return submit<boolean>('compare', plain, stored);
}

/**
 * Whether a stored hash should be replaced at the next successful sign-in: it
 * uses the old scheme, or a bcrypt cost other than the configured BCRYPT_ROUNDS
 * (crypto agility, ASVS V11.2.2: raising the cost upgrades every account in time).
 */
export function needsRehash(stored: string, rounds: number): boolean {
  if (!stored.startsWith(PASSWORD_HASH_PREFIX)) return true;
  try {
    return bcrypt.getRounds(stored.slice(PASSWORD_HASH_PREFIX.length)) !== rounds;
  } catch {
    return true;
  }
}
