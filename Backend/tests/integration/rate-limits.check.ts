// Anti-automation on search and Poll Now (ASVS V2.4.1, V15.2.2), and the time
// limit on search queries. Run: npm run check:rate-limits
//
// The limits are read when the app loads, so they are set low HERE, before any
// app module is imported (hence the dynamic imports below). npm test lifts them
// for every other check; this one puts them back down.
process.env.SEARCH_RATE_LIMIT_PER_MINUTE = '3';
process.env.POLL_RATE_LIMIT_PER_MINUTE = '2';
process.env.AI_TAGGING_ENABLED = 'false';
process.env.EGP_RSS_BASE_URL = 'http://127.0.0.1:9/none';
process.env.SMTP_HOST = '';

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-rate-limits-check';
if (!/check/i.test(new URL(MONGODB_URI).pathname)) {
  console.error('Refusing to run: this check drops its database, whose name must contain "check".');
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function main(): Promise<void> {
  const mongoose = (await import('mongoose')).default;
  const { createApp } = await import('../../src/app');
  const { Account } = await import('../../src/models/account.model');
  const { createSession } = await import('../../src/services/session.service');
  const { SESSION_COOKIE_NAME } = await import('../../src/config/cookie');
  const { errorHandler } = await import('../../src/middlewares/error.middleware');
  const { env } = await import('../../src/config/env');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`;

  const call = async (method: string, path: string, cookie?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : '{}'
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { status: res.status, json, headers: res.headers };
  };

  // ------------------------------------------------------------------ search
  const searches = [];
  for (let i = 0; i < 4; i++) searches.push(await call('GET', `/works?q=${encodeURIComponent('คอมพิวเตอร์')}&page=${i + 1}`));
  record(searches.slice(0, 3).every(r => r.status === 200), 'search: the first 3 searches in a minute are answered (limit set to 3 here)', searches.map(r => r.status).join());
  record(searches[3].status === 429 && searches[3].json?.error?.code === 'RATE_LIMITED', 'search: the 4th is refused with 429 RATE_LIMITED', String(searches[3].status));
  record(!!searches[3].headers.get('retry-after') && /^3;w=60/.test(searches[3].headers.get('ratelimit-policy') ?? ''), 'search: the refusal says when to retry, and the policy is announced in the standard headers', `${searches[3].headers.get('retry-after')} / ${searches[3].headers.get('ratelimit-policy')}`);
  const detail = await call('GET', '/works/0123456789abcdef01234567');
  const sites = await call('GET', '/gov-sites');
  record(detail.status === 404 && sites.status === 200, 'search: only the search itself is limited -- a work by id and the site list still answer', `${detail.status} ${sites.status}`);
  record(env.SEARCH_RATE_LIMIT_PER_MINUTE === 3 && env.SEARCH_MAX_TIME_MS === 5000, 'config: limits come from SEARCH_RATE_LIMIT_PER_MINUTE, the time limit from SEARCH_MAX_TIME_MS (default 5 s)');

  // ---------------------------------------------------------------- Poll Now
  const admin = async (label: string) => {
    const account = await Account.create({ email: `${label}@example.com`, passwordHash: 'SecurePass123', name: `Poll ${label}`, role: 'superadmin' });
    const { rawToken } = await createSession(account._id);
    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  };
  const first = await admin('first');
  const second = await admin('second');
  const polls = [];
  for (let i = 0; i < 3; i++) polls.push(await call('POST', '/admin/gov-sites/poll-all', first));
  record(polls.slice(0, 2).every(r => r.status !== 429), 'poll: the first 2 Poll Now requests of an admin get a real answer (queued, or 409 while one runs)', polls.map(r => r.status).join());
  record(polls[2].status === 429 && polls[2].json?.error?.code === 'RATE_LIMITED', 'poll: the 3rd within the minute is refused with 429', String(polls[2].status));
  const other = await call('POST', '/admin/gov-sites/poll-all', second);
  record(other.status !== 429, 'poll: the limit is per admin account -- another admin on the same address is not affected', String(other.status));
  const anonymous = await call('POST', '/admin/gov-sites/poll-all');
  record(anonymous.status === 401, 'poll: without a session the route still answers 401 first (the limiter sits behind sign-in)', String(anonymous.status));

  // --------------------------------------------------------- search time limit
  // A query MongoDB stops at its maxTimeMS (code 50) becomes a 503 with a clear message, not a 500.
  let sent: { status?: number; body?: { error?: { code?: string; message?: string } } } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body as typeof sent.body;
      return this;
    }
  };
  errorHandler(Object.assign(new Error('operation exceeded time limit'), { code: 50, codeName: 'MaxTimeMSExpired' }), { method: 'GET', originalUrl: '/api/v1/works?q=x' } as never, res as never, () => undefined);
  record(sent.status === 503 && sent.body?.error?.code === 'SERVICE_UNAVAILABLE' && /too long/.test(sent.body?.error?.message ?? ''), 'time limit: a search stopped by MongoDB answers 503 "took too long"', JSON.stringify(sent));
  sent = {};
  errorHandler(new Error('boom'), { method: 'GET', originalUrl: '/x' } as never, res as never, () => undefined);
  record(sent.status === 500, 'time limit: any other error is still a 500');

  const src = (await import('node:fs')).readFileSync(require.resolve('../../src/services/work.service.ts'), 'utf8');
  const listing = src.slice(src.indexOf('export async function listWorks'));
  record((src.match(/\.maxTimeMS\(searchTimeLimit\(\)\)/g) ?? []).length >= 6 && /Work\.find\(query\)\s*\n\s*\.maxTimeMS/.test(listing), 'time limit: every search find() and count carries maxTimeMS');

  server.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
