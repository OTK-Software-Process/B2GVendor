import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account } from '../../src/models/account.model';
import { Token } from '../../src/models/token.model';

const MONGODB_URI =
  process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-password-reset-check';

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const account = await Account.create({
    email: 'reset@example.co.th',
    passwordHash: 'SecurePass123',
    name: 'Reset User',
  });

  const forgotRes = await fetch(base + '/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'reset@example.co.th' }),
  });

  const forgotJson = await forgotRes.json().catch(() => null);
  const tokenDoc = await Token.findOne({ accountId: account._id, purpose: 'password_reset' });

  console.log(JSON.stringify({ forgotStatus: forgotRes.status, forgotJson, tokenExists: !!tokenDoc }, null, 2));

  if (!tokenDoc) {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    process.exit(1);
  }

  const token = tokenDoc.tokenHash;
  const resetRes = await fetch(base + '/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: token,
      newPassword: 'NewSecurePass456',
      confirmNewPassword: 'NewSecurePass456',
    }),
  });

  const resetJson = await resetRes.json().catch(() => null);
  console.log(JSON.stringify({ resetStatus: resetRes.status, resetJson }, null, 2));

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  process.exit(resetRes.status === 204 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
