import mongoose from 'mongoose';
import { env } from '../../src/config/env';
import { createApp } from '../../src/app';
import { Account } from '../../src/models/account.model';
import { Token } from '../../src/models/token.model';
import { mockPwnedPasswords } from '../helpers/mockPwnedPasswords';
import { startFakeSmtp } from '../helpers/fakeSmtp';

// Forgot-password -> email -> reset-password, end to end over HTTP.
// Run: npm run check:password-reset  (needs a MongoDB; see MONGODB_URI below)
//
// The reset email goes to a local in-memory SMTP server (tests/helpers/fakeSmtp.ts)
// and the token is read back out of THAT email, exactly as a user would click
// it -- Backend/.env's real SMTP is never used, so no real email goes out.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-password-reset-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI;
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined; // until the fake server below takes over

mockPwnedPasswords();

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// The raw SMTP message body may be quoted-printable: undo soft line breaks and =XX escapes.
function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const smtp = await startFakeSmtp();
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as { success?: boolean } | null };
  };

  const account = await Account.create({ email: 'reset@example.co.th', passwordHash: 'SecurePass123', name: 'Reset User' });

  // ---- request a reset
  const forgot = await post('/auth/forgot-password', { email: 'reset@example.co.th' });
  record(forgot.status === 200 && forgot.json?.success === true, 'forgot-password answers 200', `${forgot.status} ${JSON.stringify(forgot.json)}`);
  record(smtp.messages.length === 1 && /^To: .*reset@example\.co\.th/im.test(smtp.messages[0] ?? ''), 'exactly one reset email, to the account (fake SMTP only)', String(smtp.messages.length));
  record((await Token.countDocuments({ accountId: account._id, purpose: 'password_reset' })) === 1, 'one reset token is stored');

  const body = decodeQuotedPrintable(smtp.messages[0] ?? '');
  const rawToken = body.match(/\/reset-password\/([0-9a-f]{32,})/i)?.[1];
  record(!!rawToken, 'the email carries a reset link with the raw token');
  const stored = await Token.findOne({ accountId: account._id, purpose: 'password_reset' }).select('+tokenHash');
  record(!!stored && stored.tokenHash !== rawToken, 'the database keeps only a hash of the token, never the token itself');

  // ---- an unknown email: same answer, no email
  const unknown = await post('/auth/forgot-password', { email: 'nobody@example.co.th' });
  record(unknown.status === 200 && smtp.messages.length === 1, 'an unknown email gets the same 200 and no email is sent');

  // ---- use the link
  const reset = await post('/auth/reset-password', { token: rawToken, newPassword: 'NewSecurePass456', confirmNewPassword: 'NewSecurePass456' });
  record(reset.status === 200 && reset.json?.success === true, 'reset-password with the emailed token answers 200', `${reset.status} ${JSON.stringify(reset.json)}`);

  const updated = await Account.findById(account._id).select('+passwordHash');
  record(!!updated && (await updated.comparePassword('NewSecurePass456')), 'the new password works');
  record(!!updated && !(await updated.comparePassword('SecurePass123')), 'the old password no longer works');

  const replay = await post('/auth/reset-password', { token: rawToken, newPassword: 'AnotherPass789x', confirmNewPassword: 'AnotherPass789x' });
  record(replay.status >= 400 && replay.status < 500, 'the same link cannot be used twice', String(replay.status));

  // ---- report
  server.close();
  await smtp.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
