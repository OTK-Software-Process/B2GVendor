// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import mongoose from 'mongoose';
import { sessionCookieOptions, SESSION_TTL_MS } from '../../src/config/cookie';
import { Account } from '../../src/models/account.model';
import { Session } from '../../src/models/session.model';

// Runs the real app in a child process so a check can see how it behaves under
// settings that are fixed when the process starts: NODE_ENV=production,
// COOKIE_SAMESITE, SESSION_TTL_DAYS. Used by login-session.check.ts, which sets
// the environment and reads the single "RESULT {json}" line this prints.
//
//   PROBE_DB          throwaway database to use (required)
//   PROBE_RATE_LIMIT  "1" also runs the per-IP login limiter through X-Forwarded-For
const EMAIL = 'probe@example.com';
const PASSWORD = 'SecurePass123';

async function main(): Promise<void> {
  const uri = process.env.PROBE_DB;
  if (!uri) throw new Error('PROBE_DB is required');
  await mongoose.connect(uri);
  await Account.deleteMany({ email: EMAIL });
  const account = await Account.create({ email: EMAIL, passwordHash: PASSWORD, name: 'Probe User', type: 'individual' });

  const server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, cookies: res.headers.getSetCookie(), json: (await res.json().catch(() => null)) as any, headers: res.headers };
  };

  const login = await post('/auth/login', { email: EMAIL, password: PASSWORD });
  const cookie = (login.cookies[0] ?? '').split(';')[0];
  const logout = await post('/auth/logout', {}, { Cookie: cookie });
  const session = await Session.findOne({ accountId: account._id });

  const result: Record<string, unknown> = {
    nodeEnv: process.env.NODE_ENV,
    configured: { sameSite: sessionCookieOptions.sameSite, secure: sessionCookieOptions.secure, maxAgeMs: sessionCookieOptions.maxAge, ttlMs: SESSION_TTL_MS },
    loginStatus: login.status,
    loginCookies: login.cookies,
    logoutStatus: logout.status,
    logoutCookies: logout.cookies,
    sessionLifetimeMs: session ? session.expiresAt.getTime() - session.createdAt.getTime() : null
  };

  if (process.env.PROBE_RATE_LIMIT === '1') {
    // Unknown emails: cheap to count, and they never touch an account.
    const attempt = async (forwardedFor?: string) =>
      (await post('/auth/login', { email: 'nobody@example.com', password: PASSWORD }, forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {})).status;
    const burst = async (forwardedFor: string, count: number) => {
      const statuses: number[] = [];
      for (let i = 0; i < count; i += 1) statuses.push(await attempt(forwardedFor));
      return statuses;
    };
    const rate: Record<string, unknown> = {};
    rate.clientA = await burst('203.0.113.10', 11); // 10 answered, the 11th refused
    rate.clientB = await attempt('203.0.113.11'); // another client: its own allowance
    // A client can write whatever it likes at the FRONT of X-Forwarded-For; the
    // proxy appends the real address at the end, and only that one counts.
    rate.spoofedPrefixA = [await attempt('9.9.9.9, 203.0.113.10'), await attempt('7.7.7.7, 8.8.8.8, 203.0.113.10')];
    rate.spoofedPrefixFresh = await attempt('9.9.9.9, 203.0.113.50');
    rate.noHeader = await attempt(); // the socket address itself
    result.rate = rate;
  }

  console.log('RESULT ' + JSON.stringify(result));
  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('probe failed', err);
  process.exit(1);
});
