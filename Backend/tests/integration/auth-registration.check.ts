// Must stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import mongoose from 'mongoose';
import { env } from '../../src/config/env';
import { Account } from '../../src/models/account.model';
import { Token } from '../../src/models/token.model';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';
import { startFakeSmtp, FakeSmtp } from '../helpers/fakeSmtp';

const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-auth-registration-check';
const HIBP = mockPwnedPasswords();

// Never let this check use credentials loaded from Backend/.env.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function verificationToken(smtp: FakeSmtp, email: string): string | undefined {
  const message = smtp.messages.find(value => value.includes(email));
  const decoded = message
    ?.replace(/=\r?\n/g, '')
    .replace(/=([a-f\d]{2})/gi, (_match, byte: string) =>
      String.fromCharCode(Number.parseInt(byte, 16))
    );
  return decoded?.match(/verify-email\/([a-f\d]{64})/i)?.[1];
}

async function main(): Promise<void> {
  let smtp: FakeSmtp | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  process.env.MONGODB_URI = MONGODB_URI;

  try {
    await mongoose.connect(MONGODB_URI);
    await mongoose.connection.dropDatabase();

    const app = createApp();
    app.set('trust proxy', 1);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/v1`;
    smtp = await startFakeSmtp();

    async function post(path: string, body: unknown, ip: string) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip
        },
        body: JSON.stringify(body)
      });
      const json = (await response.json().catch(() => null)) as Envelope | null;
      return { status: response.status, json };
    }

    const body = (email: string, overrides: Record<string, unknown> = {}) => ({
      name: 'Somchai Jaidee',
      email,
      password: 'SecurePass123',
      confirmPassword: 'SecurePass123',
      type: 'individual',
      ...overrides
    });

    const individualEmail = 'individual@example.co.th';
    const individual = await post('/auth/register', body(individualEmail), '198.51.100.10');
    const individualAccount = await Account.findOne({ email: individualEmail });
    const individualToken = verificationToken(smtp, individualEmail);
    record(
      individual.status === 201 && individual.json?.data?.emailVerificationRequired === true,
      'an individual can sign up and receives a verification requirement',
      JSON.stringify(individual.json)
    );
    record(!!individualAccount && individualAccount.type === 'individual', 'the individual account is persisted');
    record(!!individualToken, 'the verification email contains a usable token');

    if (individualToken && individualAccount) {
      const tokenRecord = await Token.findOne({
        accountId: individualAccount._id,
        purpose: 'email_verification'
      });
      const ttl = tokenRecord
        ? tokenRecord.expiresAt.getTime() - tokenRecord.createdAt.getTime()
        : 0;
      record(
        !!tokenRecord && Math.abs(ttl - 24 * 60 * 60 * 1000) < 5000,
        'email verification tokens expire after 24 hours',
        `${ttl}ms`
      );

      const verified = await post('/auth/verify-email', { token: individualToken }, '198.51.100.10');
      record(
        verified.status === 200 && verified.json?.data?.emailVerified === true,
        'POST /auth/verify-email accepts a valid token',
        JSON.stringify(verified.json)
      );
      record(
        (await Account.findById(individualAccount._id))?.emailVerified === true,
        'email verification is persisted'
      );
      const replay = await post('/auth/verify-email', { token: individualToken }, '198.51.100.10');
      record(
        replay.status === 400 && replay.json?.error?.code === 'TOKEN_INVALID',
        'a verification token works only once',
        JSON.stringify(replay.json)
      );
    }

    const businessEmail = 'business@example.co.th';
    const business = await post(
      '/auth/register',
      body(businessEmail, {
        type: 'business',
        businessProfile: { companyName: 'Example Company Co., Ltd.', taxId: '0123456789012' }
      }),
      '198.51.100.11'
    );
    const businessAccount = await Account.findOne({ email: businessEmail });
    record(
      business.status === 201 && businessAccount?.type === 'business',
      'a business can sign up with a 13-digit tax ID and company name',
      JSON.stringify(business.json)
    );
    record(
      businessAccount?.businessProfile?.taxId === '0123456789012' &&
        businessAccount.businessProfile.companyName === 'Example Company Co., Ltd.',
      'the business profile is persisted without changing its tax ID or company name'
    );

    const passwordCases = [
      { email: 'password-short@example.co.th', password: 'Abcde1f', ip: '198.51.100.12' },
      { email: 'password-no-letter@example.co.th', password: '12345678', ip: '198.51.100.13' },
      { email: 'password-no-number@example.co.th', password: 'Abcdefgh', ip: '198.51.100.14' },
      {
        email: 'password-73-bytes@example.co.th',
        password: `${'A'.repeat(70)}1é`,
        ip: '198.51.100.15'
      }
    ];
    for (const testCase of passwordCases) {
      const response = await post(
        '/auth/register',
        body(testCase.email, {
          password: testCase.password,
          confirmPassword: testCase.password
        }),
        testCase.ip
      );
      record(
        response.status === 400 && !!response.json?.error?.fields?.password,
        `registration rejects password rule violation (${testCase.email})`,
        JSON.stringify(response.json)
      );
      record(!(await Account.exists({ email: testCase.email })), `no account is created for ${testCase.email}`);
    }

    const maxLengthEmail = 'password-72-bytes@example.co.th';
    const maxLengthPassword = `${'A'.repeat(69)}1é`;
    const maxLength = await post(
      '/auth/register',
      body(maxLengthEmail, {
        password: maxLengthPassword,
        confirmPassword: maxLengthPassword
      }),
      '198.51.100.16'
    );
    record(
      Buffer.byteLength(maxLengthPassword, 'utf8') === 72 && maxLength.status === 201,
      'a password exactly 72 UTF-8 bytes long is accepted',
      JSON.stringify(maxLength.json)
    );

    const breachedEmail = 'breached-password@example.co.th';
    const breachedPassword = 'BreachedPass123';
    HIBP.setBreachedPasswords([breachedPassword]);
    const breached = await post(
      '/auth/register',
      body(breachedEmail, { password: breachedPassword, confirmPassword: breachedPassword }),
      '198.51.100.17'
    );
    HIBP.setBreachedPasswords([]);
    record(
      breached.status === 400 && breached.json?.error?.code === 'BAD_REQUEST',
      'a password found in the HIBP range response is rejected',
      JSON.stringify(breached.json)
    );
    record(!(await Account.exists({ email: breachedEmail })), 'a breached password does not create an account');

    const hibpDownEmail = 'hibp-down@example.co.th';
    HIBP.setUnavailable(true);
    const hibpDown = await post('/auth/register', body(hibpDownEmail), '198.51.100.18');
    HIBP.setUnavailable(false);
    record(
      hibpDown.status === 503 && hibpDown.json?.error?.code === 'SERVICE_UNAVAILABLE',
      'HIBP unavailability returns 503',
      JSON.stringify(hibpDown.json)
    );
    record(!(await Account.exists({ email: hibpDownEmail })), 'HIBP unavailability creates no account');

    const smtpFailureEmail = 'smtp-unavailable@example.co.th';
    smtp.rejectNextMessage();
    const smtpFailure = await post('/auth/register', body(smtpFailureEmail), '198.51.100.19');
    record(
      smtpFailure.status === 503 && smtpFailure.json?.error?.code === 'SERVICE_UNAVAILABLE',
      'an unavailable SMTP delivery returns 503',
      JSON.stringify(smtpFailure.json)
    );
    record(!(await Account.exists({ email: smtpFailureEmail })), 'failed SMTP delivery leaves no account behind');
    record(
      (await Token.countDocuments({
        purpose: 'email_verification',
        usedAt: { $exists: false }
      })) === 2,
      'failed SMTP delivery removes its verification token'
    );

    const duplicate = await post('/auth/register', body(individualEmail), '198.51.100.10');
    record(
      duplicate.status === 409 &&
        duplicate.json?.error?.code === 'REGISTRATION_FAILED' &&
        !duplicate.json.error.fields?.email,
      'a duplicate email returns 409 REGISTRATION_FAILED without identifying the email field',
      JSON.stringify(duplicate.json)
    );

    const expiredEmail = 'expired-verification@example.co.th';
    const expiredRegistration = await post('/auth/register', body(expiredEmail), '198.51.100.20');
    const expiredAccount = await Account.findOne({ email: expiredEmail });
    const expiredToken = verificationToken(smtp, expiredEmail);
    if (expiredAccount) {
      await Token.updateOne(
        { accountId: expiredAccount._id, purpose: 'email_verification' },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
    }
    const expired = expiredToken
      ? await post('/auth/verify-email', { token: expiredToken }, '198.51.100.20')
      : { status: 0, json: null };
    record(
      expiredRegistration.status === 201 &&
        !!expiredToken &&
        expired.status === 400 &&
        expired.json?.error?.code === 'TOKEN_INVALID',
      'an expired verification token is rejected',
      JSON.stringify(expired.json)
    );
    record(
      !!expiredAccount && (await Account.findById(expiredAccount._id))?.emailVerified === false,
      'an expired verification token does not verify its account'
    );

    const limitedIp = '198.51.100.30';
    const limitedResults = [];
    for (let index = 0; index < 6; index += 1) {
      limitedResults.push(
        await post(
          '/auth/register',
          body(`rate-limit-${index}@example.co.th`),
          limitedIp
        )
      );
    }
    record(
      limitedResults.slice(0, 5).every(response => response.status === 201) &&
        limitedResults[5].status === 429 &&
        limitedResults[5].json?.error?.code === 'RATE_LIMITED',
      'more than five sign-ups from one IP in an hour returns 429',
      limitedResults.map(response => response.status).join(', ')
    );
  } finally {
    HIBP.restore();
    if (smtp) await smtp.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('check failed to run', error);
  process.exitCode = 2;
});
