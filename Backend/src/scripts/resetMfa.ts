import mongoose from 'mongoose';
import { env } from '../config/env';
import { Account } from '../models/account.model';
import { resetFromCommandLine } from '../services/mfa.service';

// Removes an account's two-step verification from the command line (ASVS V6.4.4).
//
// This exists for the one case the admin panel refuses on purpose: a SUPER ADMIN who
// lost both their authenticator and their recovery codes (the panel never changes a
// Super Admin account, so a stolen Super Admin session cannot strip another one's
// second factor). Whoever can run this has access to the server and its secrets, which
// is the identity check. It also works for any other account.
//
// The account's sessions are ended, the owner is emailed, and the reason is recorded in
// the audit log. A staff account must set up a new factor at its next sign-in.
//
//   node dist/scripts/resetMfa.js <email> "<why: at least 10 characters>"      (compiled image)
//   npm run mfa:reset -- <email> "<why>"                                       (development)
//   RESET_MFA_EMAIL=... RESET_MFA_REASON=... npm run mfa:reset

const email = (process.env.RESET_MFA_EMAIL ?? process.argv[2] ?? '').trim().toLowerCase();
const reason = (process.env.RESET_MFA_REASON ?? process.argv[3] ?? '').trim();

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage:');
  console.error('  npm run mfa:reset -- <email> "<why: at least 10 characters>"');
  console.error('  node dist/scripts/resetMfa.js <email> "<why: at least 10 characters>"\n');
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email) usage('An email address is required.');
  if (reason.length < 10) usage('Say why, in at least 10 characters (for example who asked and how you checked): it goes in the audit log.');

  await mongoose.connect(env.MONGODB_URI);
  const account = await Account.findOne({ email });
  if (!account) usage(`No account has the email ${email}.`);
  if (!account.mfaEnabled) console.log('Two-step verification was not on for this account; anything left over is removed anyway.');

  const { sessionsRevoked } = await resetFromCommandLine(account, reason);
  console.log(`Two-step verification was removed from ${email}. ${sessionsRevoked} session(s) were ended and the owner was emailed (when email is configured).`);
  if (account.role === 'admin' || account.role === 'superadmin') console.log('They must set up a new authenticator at their next sign-in.');
}

main()
  .catch(err => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
