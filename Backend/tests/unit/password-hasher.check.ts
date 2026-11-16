import os from 'node:os';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from '../../src/utils/passwordHasher';

// The password worker pool (src/utils/passwordHasher.ts): hashes made in the
// workers are ordinary bcrypt hashes (old hashes keep working, new ones verify
// anywhere), wrong passwords are refused, and -- the reason it exists -- sign-ins
// no longer stall the event loop that serves every other request.
// Run: npm run check:password-hasher

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// Worst gap between ticks of a 10 ms timer while `work` runs: how long the
// event loop (i.e. every other request) was kept waiting.
async function maxEventLoopStall(work: () => Promise<unknown>): Promise<number> {
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - 10);
    last = now;
  }, 10);
  await work();
  clearInterval(timer);
  return Math.round(worst);
}

async function main(): Promise<void> {
  delete process.env.PASSWORD_HASH_WORKERS;
  const ROUNDS = 12;

  const pooled = await hashPassword('Correct-Horse-1', ROUNDS);
  record(/^\$2[aby]\$12\$/.test(pooled) && bcrypt.getRounds(pooled) === ROUNDS, 'a hash made in the pool is a standard 12-round bcrypt hash', pooled.slice(0, 7));
  record(bcrypt.compareSync('Correct-Horse-1', pooled), 'plain bcryptjs verifies a pool-made hash');
  const legacy = bcrypt.hashSync('Correct-Horse-1', ROUNDS);
  record(await verifyPassword('Correct-Horse-1', legacy), 'the pool verifies a hash made the old way (existing accounts keep working)');
  record(!(await verifyPassword('wrong-password', pooled)), 'a wrong password is refused');
  const bad = await verifyPassword('x', 'not-a-bcrypt-hash').then(v => `resolved ${v}`, () => 'rejected');
  record(bad === 'resolved false' || bad === 'rejected', 'a malformed hash never verifies', bad);

  // 8 sign-ins at once, both ways.
  const many = () => Promise.all(Array.from({ length: 8 }, () => verifyPassword('Correct-Horse-1', legacy)));
  let t = performance.now();
  const pooledStall = await maxEventLoopStall(many);
  const pooledMs = Math.round(performance.now() - t);

  process.env.PASSWORD_HASH_WORKERS = '0';
  t = performance.now();
  const inlineStall = await maxEventLoopStall(many);
  const inlineMs = Math.round(performance.now() - t);
  delete process.env.PASSWORD_HASH_WORKERS;

  record(pooledStall < 50, '8 simultaneous sign-ins in the pool: the event loop never waits more than 50 ms', `${pooledStall} ms`);
  record(inlineStall > pooledStall * 2, 'on the main thread (PASSWORD_HASH_WORKERS=0, the old way) the same work stalls it far longer', `${inlineStall} ms vs ${pooledStall} ms`);
  // Only meaningful with spare cores: on a 2-core CI runner the pool has a single worker.
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  if (cores >= 3) record(pooledMs < inlineMs, 'and the pool, using other cores, also finishes the batch sooner', `${pooledMs} ms vs ${inlineMs} ms`);
  else console.log(`(only ${cores} cores: batch time not compared -- pool ${pooledMs} ms, main thread ${inlineMs} ms)`);
  record(await verifyPassword('Correct-Horse-1', pooled), 'switched back on, the pool still works');

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
