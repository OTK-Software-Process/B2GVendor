import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account } from '../../src/models/account.model';
import { Session } from '../../src/models/session.model';
import { issueToken } from '../../src/services/token.service';
import { isEmailConfigured } from '../../src/services/email.service';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';

const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-auth-flow-check';

mockPwnedPasswords();

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

function parseSetCookie(header: string | null): { name: string; value: string } | null {
  if (!header) return null;
  const first = header.split(';')[0];
  const eq = first.indexOf('=');
  if (eq === -1) return null;
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function post(path: string, body: unknown, cookie?: string) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body)
    });
    const json = (await res.json().catch(() => null)) as Envelope | null;
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }

  async function get(path: string, cookie?: string) {
    const res = await fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
    const json = (await res.json().catch(() => null)) as Envelope | null;
    return { status: res.status, json };
  }

  // --- Register ---
  const registerBody = {
    name: 'Somchai Jaidee',
    email: 'somchai@company.co.th',
    password: 'SecurePass123',
    confirmPassword: 'SecurePass123',
    type: 'individual'
  };

  if (!isEmailConfigured()) {
    const registration = await post('/auth/register', registerBody);
    record(
      registration.status === 503 && registration.json?.error?.code === 'SERVICE_UNAVAILABLE',
      'registration requires configured email delivery',
      JSON.stringify(registration.json)
    );
    record(
      !(await Account.exists({ email: registerBody.email })),
      'failed email setup does not leave an unverified account behind'
    );
  }

  const storedAccount = await Account.create({
    name: registerBody.name,
    email: registerBody.email,
    passwordHash: registerBody.password,
    type: 'individual',
    emailVerified: false
  });
  record(!!storedAccount, 'the account exists in MongoDB');
  record(!!storedAccount.passwordHash.startsWith('$2b$12$'), 'the stored password is bcrypt-hashed, not plaintext');
  record(storedAccount.passwordHash !== registerBody.password, 'the stored password is not the plaintext password');

  const unverifiedLogin = await post('/auth/login', { email: registerBody.email, password: registerBody.password });
  record(
    unverifiedLogin.status === 403 && unverifiedLogin.json?.error?.code === 'EMAIL_NOT_VERIFIED',
    'an unverified account cannot log in',
    JSON.stringify(unverifiedLogin.json)
  );

  const rawVerificationToken = await issueToken(storedAccount._id, 'email_verification');
  const verified = await post('/auth/verify-email', { token: rawVerificationToken });
  record(
    verified.status === 200 && verified.json?.data?.emailVerified === true,
    'a valid verification token verifies the account',
    JSON.stringify(verified.json)
  );
  record(
    (await Account.findById(storedAccount._id))?.emailVerified === true,
    'verification is persisted on the account'
  );

  const replayedVerification = await post('/auth/verify-email', { token: rawVerificationToken });
  record(
    replayedVerification.status === 400 && replayedVerification.json?.error?.code === 'TOKEN_INVALID',
    'a verification token can only be used once',
    JSON.stringify(replayedVerification.json)
  );

  // --- Duplicate email ---
  const dupe = await post('/auth/register', registerBody);
  record(
    dupe.status === 409 && dupe.json?.error?.code === 'EMAIL_ALREADY_REGISTERED',
    'registering the same email twice is rejected',
    JSON.stringify(dupe.json)
  );

  // --- Validation ---
  const badRegister = await post('/auth/register', { ...registerBody, email: 'not-an-email', confirmPassword: 'different' });
  record(
    badRegister.status === 400 && badRegister.json?.error?.code === 'VALIDATION_ERROR' && !!badRegister.json?.error?.fields?.email,
    'a malformed register request 400s with field errors',
    JSON.stringify(badRegister.json)
  );

  const businessNoProfile = await post('/auth/register', {
    ...registerBody,
    email: 'biz@company.co.th',
    type: 'business'
  });
  record(
    businessNoProfile.status === 400 && !!businessNoProfile.json?.error?.fields?.businessProfile,
    'registering as business without a profile 400s',
    JSON.stringify(businessNoProfile.json)
  );

  // --- Login ---
  const wrongPassword = await post('/auth/login', { email: registerBody.email, password: 'WrongPass123' });
  record(
    wrongPassword.status === 401 && wrongPassword.json?.error?.code === 'INVALID_CREDENTIALS',
    'wrong password is rejected',
    JSON.stringify(wrongPassword.json)
  );

  const unknownEmail = await post('/auth/login', { email: 'nobody@company.co.th', password: 'SecurePass123' });
  record(
    unknownEmail.status === 401 &&
      unknownEmail.json?.error?.code === 'INVALID_CREDENTIALS' &&
      unknownEmail.json?.error?.message === wrongPassword.json?.error?.message,
    'an unknown email gets the identical error to a wrong password (no enumeration)',
    JSON.stringify(unknownEmail.json)
  );

  const loggedIn = await post('/auth/login', { email: registerBody.email, password: registerBody.password });
  record(loggedIn.status === 200 && loggedIn.json?.success === true, 'correct credentials log in', JSON.stringify(loggedIn.json));
  const loginCookie = parseSetCookie(loggedIn.setCookie);
  record(loginCookie?.name === SESSION_COOKIE_NAME, 'login sets a fresh session cookie');

  const secondLogin = await post('/auth/login', { email: registerBody.email, password: registerBody.password });
  const secondLoginCookie = parseSetCookie(secondLogin.setCookie);
  const sessionCountAfterTwoLogins = await Session.countDocuments({ accountId: storedAccount._id });
  record(sessionCountAfterTwoLogins === 2, 'two logins produce two session documents, not a shared one', String(sessionCountAfterTwoLogins));

  // --- Suspended account cannot log in ---
  await Account.updateOne({ _id: storedAccount?._id }, { status: 'suspended' });
  const suspendedLogin = await post('/auth/login', { email: registerBody.email, password: registerBody.password });
  record(
    suspendedLogin.status === 403 && suspendedLogin.json?.error?.code === 'ACCOUNT_SUSPENDED',
    'a suspended account cannot log in even with the right password',
    JSON.stringify(suspendedLogin.json)
  );
  await Account.updateOne({ _id: storedAccount?._id }, { status: 'active' });

  // --- Logout ---
  const meBeforeLogout = await get('/auth/me', `${SESSION_COOKIE_NAME}=${loginCookie?.value}`);
  record(meBeforeLogout.status === 200, 'session works before logout');

  const loggedOut = await post('/auth/logout', {}, `${SESSION_COOKIE_NAME}=${loginCookie?.value}`);
  record(loggedOut.status === 200, 'logout returns 200');

  const meAfterLogout = await get('/auth/me', `${SESSION_COOKIE_NAME}=${loginCookie?.value}`);
  record(
    meAfterLogout.status === 401 && meAfterLogout.json?.error?.code === 'NOT_AUTHENTICATED',
    'the session cannot be reused after logout',
    JSON.stringify(meAfterLogout.json)
  );

  const secondLogout = await post('/auth/logout', {}, `${SESSION_COOKIE_NAME}=${loginCookie?.value}`);
  record(
    secondLogout.status === 401 && secondLogout.json?.error?.code === 'NOT_AUTHENTICATED',
    'a logged-out session cannot call the protected logout endpoint again',
    JSON.stringify(secondLogout.json)
  );

  const otherSessionStillWorks = await get('/auth/me', `${SESSION_COOKIE_NAME}=${secondLoginCookie?.value}`);
  record(otherSessionStillWorks.status === 200, "logging out one session does not revoke the account's other sessions");

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
