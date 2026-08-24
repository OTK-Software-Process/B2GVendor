import mongoose from 'mongoose';
import { env } from '../config/env';
import { Account } from '../models/account.model';

const email = (process.env.SEED_SUPERADMIN_EMAIL ?? process.argv[2] ?? '').trim().toLowerCase();
const password = process.env.SEED_SUPERADMIN_PASSWORD ?? process.argv[3] ?? '';
const name = process.env.SEED_SUPERADMIN_NAME ?? process.argv[4] ?? 'Super Admin';

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage:');
  console.error('  npm run seed:superadmin -- <email> <password> [name]');
  console.error('  SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... npm run seed:superadmin\n');
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    usage('A valid email address is required.');
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    usage('Password must be at least 8 characters and contain a letter and a number.');
  }

  await mongoose.connect(env.MONGODB_URI);

  const existing = await Account.findOne({ email });

  if (existing) {
    const wasSuperAdmin = existing.role === 'superadmin';
    existing.role = 'superadmin';
    existing.status = 'active';
    existing.emailVerified = true;
    existing.emailVerifiedAt = existing.emailVerifiedAt ?? new Date();
    await existing.save();

    console.log(
      wasSuperAdmin
        ? `Account ${email} is already a superadmin. Status and verification confirmed.`
        : `Promoted existing account ${email} to superadmin.`
    );
    console.log('Password was left unchanged. Use the forgot-password flow if it is unknown.');
  } else {
    await Account.create({
      email,
      passwordHash: password,
      name,
      type: 'individual',
      role: 'superadmin',
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: new Date()
    });

    console.log(`Created superadmin ${email}.`);
  }

  const total = await Account.countDocuments({ role: 'superadmin' });
  console.log(`Superadmin accounts in this database: ${total}`);

  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('seed:superadmin failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
