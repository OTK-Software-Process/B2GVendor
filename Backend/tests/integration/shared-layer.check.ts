import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { Account } from '../../src/models/account.model';
import { Session, issueSessionToken, SESSION_TTL_MS } from '../../src/models/session.model';
import { Token, issueOneTimeToken, hashOneTimeToken } from '../../src/models/token.model';
import { requireAuth } from '../../src/middlewares/auth.middleware';
import { requireAdmin, requireSuperAdmin } from '../../src/middlewares/requireRole';
import { errorHandler, notFoundHandler } from '../../src/middlewares/error.middleware';
import { ok } from '../../src/utils/apiResponse';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import {
  createSession,
  revokeAllSessions,
  revokeOtherSessions,
  listActiveSessions
} from '../../src/services/session.service';
import { issueToken, consumeToken } from '../../src/services/token.service';
import { parseUserAgent, maskIpAddress } from '../../src/utils/userAgent';

const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-shared-layer-check';

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function makeAccount(over: Record<string, unknown> = {}) {
  return Account.create({
    email: `u${Math.random().toString(36).slice(2)}@x.co.th`,
    passwordHash: 'SecurePass123',
    name: 'Somchai Jaidee',
    emailVerified: true,
    ...over
  });
}

async function makeSession(
  accountId: mongoose.Types.ObjectId,
  over: Record<string, unknown> = {}
): Promise<string> {
  const { raw, tokenHash } = issueSessionToken();
  await Session.create({
    accountId,
    tokenHash,
    browser: 'Chrome',
    os: 'macOS',
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
    ...over
  });
  return raw;
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Account.syncIndexes(), Session.syncIndexes(), Token.syncIndexes()]);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get('/me', requireAuth, (req, res) => {
    ok(res, { id: String(req.account!._id), role: req.account!.role });
  });
  app.get('/admin', requireAuth, requireAdmin, (_req, res) => {
    ok(res, { admin: true });
  });
  app.get('/super', requireAuth, requireSuperAdmin, (_req, res) => {
    ok(res, { super: true });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  async function call(path: string, raw?: string) {
    const res = await fetch(base + path, {
      headers: raw ? { Cookie: `${SESSION_COOKIE_NAME}=${raw}` } : {}
    });
    const body = (await res.json().catch(() => null)) as
      | { success: boolean; data?: Record<string, unknown>; error?: { code: string } }
      | null;
    return { status: res.status, body };
  }

  const user = await makeAccount();
  const stored = await Account.findById(user._id).select('+passwordHash');
  record(!!stored?.passwordHash.startsWith('$2b$12$'), 'password hashed at cost 12 by the pre-save hook');
  record(!!(await stored?.comparePassword('SecurePass123')), 'comparePassword accepts the right password');
  record(!(await stored?.comparePassword('WrongPass123')), 'comparePassword rejects the wrong password');

  const rawValid = await makeSession(user._id as mongoose.Types.ObjectId);
  let res = await call('/me', rawValid);
  record(res.status === 200 && res.body?.data?.id === String(user._id), 'valid session resolves to its account');

  const before = await Session.findOne({ accountId: user._id });
  await call('/me', rawValid);
  const after = await Session.findOne({ accountId: user._id });
  record(
    !!before && !!after && after.lastActiveAt.getTime() > before.lastActiveAt.getTime(),
    'lastActiveAt is bumped on an authenticated request'
  );

  const revoked = await makeAccount();
  res = await call('/me', await makeSession(revoked._id as mongoose.Types.ObjectId, { revokedAt: new Date() }));
  record(res.status === 401 && res.body?.error?.code === 'NOT_AUTHENTICATED', 'revoked session is rejected');

  const expired = await makeAccount();
  res = await call('/me', await makeSession(expired._id as mongoose.Types.ObjectId, { expiresAt: new Date(Date.now() - 1000) }));
  record(res.status === 401, 'expired session is rejected');

  const suspended = await makeAccount({ status: 'suspended' });
  res = await call('/me', await makeSession(suspended._id as mongoose.Types.ObjectId));
  record(res.status === 403 && res.body?.error?.code === 'ACCOUNT_SUSPENDED', 'suspended account is ejected mid-session');

  const unverified = await makeAccount({ emailVerified: false });
  res = await call('/me', await makeSession(unverified._id as mongoose.Types.ObjectId));
  record(res.status === 403 && res.body?.error?.code === 'EMAIL_NOT_VERIFIED', 'unverified account is blocked (Q5)');

  res = await call('/me', 'forged-cookie-value');
  record(res.status === 401, 'forged cookie is rejected');

  res = await call('/me');
  record(res.status === 401 && res.body?.error?.code === 'NOT_AUTHENTICATED', 'missing cookie is rejected');

  const admin = await makeAccount({ role: 'admin' });
  const rawAdmin = await makeSession(admin._id as mongoose.Types.ObjectId);
  record((await call('/admin', rawAdmin)).status === 200, 'admin passes requireAdmin');
  const adminOnSuper = await call('/super', rawAdmin);
  record(
    adminOnSuper.status === 403 && adminOnSuper.body?.error?.code === 'FORBIDDEN',
    'admin is blocked by requireSuperAdmin'
  );

  const superadmin = await makeAccount({ role: 'superadmin' });
  const rawSuper = await makeSession(superadmin._id as mongoose.Types.ObjectId);
  record((await call('/super', rawSuper)).status === 200, 'superadmin passes requireSuperAdmin');

  const meBody = await call('/me', rawValid);
  record(!JSON.stringify(meBody.body).includes('passwordHash'), 'no passwordHash appears in any response');

  try {
    await Account.create({ email: user.email, passwordHash: 'x', name: 'duplicate' });
    record(false, 'duplicate email is rejected by the unique index');
  } catch (err) {
    record((err as { code?: number }).code === 11000, 'duplicate email is rejected by the unique index');
  }

  const issued = issueOneTimeToken('password_reset');
  await Token.create({
    accountId: user._id,
    tokenHash: issued.tokenHash,
    purpose: 'password_reset',
    expiresAt: issued.expiresAt
  });
  const byHash = await Token.findOne({ tokenHash: hashOneTimeToken(issued.raw), purpose: 'password_reset' });
  record(!!byHash && !byHash.usedAt, 'one-time token is found by the hash of the emailed value');
  const wrongPurpose = await Token.findOne({
    tokenHash: hashOneTimeToken(issued.raw),
    purpose: 'email_verification'
  });
  record(wrongPurpose === null, 'a reset token cannot be redeemed as a verification token');

  const uaChrome = parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  record(uaChrome.browser === 'Chrome' && uaChrome.os === 'Windows', 'user agent parses to browser and os', JSON.stringify(uaChrome));
  const uaSafari = parseUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
  );
  record(uaSafari.browser === 'Safari' && uaSafari.os === 'macOS', 'Safari is not misread as Chrome', JSON.stringify(uaSafari));
  record(maskIpAddress('182.52.13.201') === '182.52.xx.xx', 'IPv4 is masked for display', String(maskIpAddress('182.52.13.201')));
  record(maskIpAddress('::ffff:182.52.13.201') === '182.52.xx.xx', 'IPv4-mapped IPv6 is masked', String(maskIpAddress('::ffff:182.52.13.201')));

  const sessionUser = await makeAccount();
  const sessionUserId = sessionUser._id as mongoose.Types.ObjectId;
  const first = await createSession(sessionUserId, {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    ipAddress: '182.52.13.201'
  });
  const second = await createSession(sessionUserId, { userAgent: 'Chrome/131 Windows NT 10.0', ipAddress: '1.2.3.4' });
  const third = await createSession(sessionUserId, {});

  record((await call('/me', first.rawToken)).status === 200, 'createSession issues a cookie that authenticates');

  const views = await listActiveSessions(sessionUserId, String(second.session._id));
  record(views.length === 3, 'listActiveSessions returns every live session', String(views.length));
  record(views.filter(v => v.isCurrent).length === 1, 'exactly one session is flagged isCurrent');
  record(views.every(v => !v.ipAddress || v.ipAddress.includes('xx')), 'no full IP address leaves the service');
  record(views.some(v => v.browser === 'Safari' && v.os === 'macOS'), 'session stores the parsed browser and os');

  const revokedOthers = await revokeOtherSessions(sessionUserId, second.session._id as mongoose.Types.ObjectId);
  record(revokedOthers === 2, 'revokeOtherSessions revokes all but the current one', String(revokedOthers));
  record((await call('/me', second.rawToken)).status === 200, 'the kept session still works after revokeOtherSessions');
  record((await call('/me', first.rawToken)).status === 401, 'a revoked sibling session is dead');
  record((await call('/me', third.rawToken)).status === 401, 'the other revoked sibling is dead too');

  const revokedAll = await revokeAllSessions(sessionUserId);
  record(revokedAll === 1, 'revokeAllSessions revokes what is left', String(revokedAll));
  record((await call('/me', second.rawToken)).status === 401, 'no session survives revokeAllSessions');
  record((await listActiveSessions(sessionUserId)).length === 0, 'listActiveSessions is empty once everything is revoked');

  const tokenUser = await makeAccount();
  const tokenUserId = tokenUser._id as mongoose.Types.ObjectId;
  const verifyToken = await issueToken(tokenUserId, 'email_verification');
  const consumedId = await consumeToken(verifyToken, 'email_verification');
  record(String(consumedId) === String(tokenUserId), 'consumeToken returns the owning account');

  try {
    await consumeToken(verifyToken, 'email_verification');
    record(false, 'a consumed token cannot be replayed');
  } catch (err) {
    record((err as { code?: string }).code === 'TOKEN_INVALID', 'a consumed token cannot be replayed');
  }

  const resetToken = await issueToken(tokenUserId, 'password_reset');
  try {
    await consumeToken(resetToken, 'email_verification');
    record(false, 'a reset token is refused by the verification flow');
  } catch (err) {
    record((err as { code?: string }).code === 'TOKEN_INVALID', 'a reset token is refused by the verification flow');
  }

  const secondReset = await issueToken(tokenUserId, 'password_reset');
  try {
    await consumeToken(resetToken, 'password_reset');
    record(false, 'issuing a new reset token invalidates the previous one');
  } catch (err) {
    record((err as { code?: string }).code === 'TOKEN_INVALID', 'issuing a new reset token invalidates the previous one');
  }
  record(String(await consumeToken(secondReset, 'password_reset')) === String(tokenUserId), 'the newest reset token still works');

  const expiredToken = await issueToken(tokenUserId, 'email_verification');
  await Token.updateOne({ accountId: tokenUserId, purpose: 'email_verification' }, { expiresAt: new Date(Date.now() - 1000) });
  try {
    await consumeToken(expiredToken, 'email_verification');
    record(false, 'an expired token is refused');
  } catch (err) {
    record((err as { code?: string }).code === 'TOKEN_INVALID', 'an expired token is refused');
  }

  const sessionIndexes = await Session.collection.indexes();
  record(
    sessionIndexes.some(index => index.expireAfterSeconds === 0 && index.key.expiresAt === 1),
    'session TTL index exists in MongoDB'
  );

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
