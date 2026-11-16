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
  const done = task.op === 'hash' ? bcrypt.hash(task.a, task.b as number) : bcrypt.compare(task.a, task.b as string);
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

/** bcrypt hash of `plain` with `rounds` cost, computed off the main thread. */
export function hashPassword(plain: string, rounds: number): Promise<string> {
  return submit<string>('hash', plain, rounds);
}

/** Whether `plain` matches the bcrypt `hash`, computed off the main thread. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return submit<boolean>('compare', plain, hash);
}
