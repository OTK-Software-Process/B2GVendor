import mongoose from 'mongoose';
import { env } from '../config/env';
import { Account, Permission } from '../models/account.model';

interface AdminSeed {
	email: string;
	password: string;
	name: string;
	permission: Permission;
}

const permissionProfiles = [
	{
		key: 'TAG',
		permission: 'tag:manage',
		defaultName: 'Tag Admin'
	},
	{
		key: 'POLL',
		permission: 'poll:manage',
		defaultName: 'Poll Admin'
	},
	{
		key: 'POLL_TAG',
		permission: 'poll&tag:manage',
		defaultName: 'Poll and Tag Admin'
	}
] as const;

function readSeeds(): AdminSeed[] {
	const args = process.argv.slice(2);
	if (args.length !== 0 && args.length !== 6) {
		usage('Provide either all six positional email/password values or none.');
	}

	const seeds = permissionProfiles.map((profile, index) => {
		const email = (
			process.env[`SEED_${profile.key}_ADMIN_EMAIL`] ?? args[index * 2] ?? ''
		).trim().toLowerCase();
		const password =
			process.env[`SEED_${profile.key}_ADMIN_PASSWORD`] ?? args[index * 2 + 1] ?? '';
		const name =
			process.env[`SEED_${profile.key}_ADMIN_NAME`] ?? profile.defaultName;

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			usage(`A valid email address is required for the ${profile.key} admin.`);
		}
		if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
			usage(`The ${profile.key} admin password must be at least 8 characters and contain a letter and a number.`);
		}

		return { email, password, name, permission: profile.permission };
	});

	if (new Set(seeds.map(seed => seed.email)).size !== seeds.length) {
		usage('Each permission profile must use a different email address.');
	}

	return seeds;
}

function usage(message: string): never {
	console.error(`\n${message}\n`);
	console.error('Usage:');
	console.error('  npm run seed:admins -- <tag-email> <tag-password> <poll-email> <poll-password> <poll-tag-email> <poll-tag-password>');
	console.error('  Set SEED_TAG_ADMIN_EMAIL/PASSWORD, SEED_POLL_ADMIN_EMAIL/PASSWORD, and SEED_POLL_TAG_ADMIN_EMAIL/PASSWORD instead.');
	process.exit(1);
}

async function main(): Promise<void> {
	const seeds = readSeeds();
	await mongoose.connect(env.MONGODB_URI);

	const existingAccounts = await Promise.all(
		seeds.map(seed => Account.findOne({ email: seed.email }))
	);
	if (existingAccounts.some(account => account?.role === 'superadmin')) {
		throw new Error('A seed email belongs to a superadmin; refusing to change that account.');
	}

	for (const [index, seed] of seeds.entries()) {
		const existing = existingAccounts[index];
		if (existing) {
			existing.role = 'admin';
			existing.status = 'active';
			existing.permissions = [seed.permission];
			await existing.save();
			console.log(`Updated ${seed.email} with ${seed.permission}. Password was left unchanged.`);
		} else {
			await Account.create({
				email: seed.email,
				passwordHash: seed.password,
				name: seed.name,
				type: 'individual',
				role: 'admin',
				status: 'active',
				permissions: [seed.permission]
			});
			console.log(`Created ${seed.email} with ${seed.permission}.`);
		}
	}

	await mongoose.disconnect();
}

main().catch(async err => {
	console.error('seed:admins failed', err);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
