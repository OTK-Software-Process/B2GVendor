import { randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { Account, IAccount } from '../models/account.model';
import { Follow } from '../models/follow.model';
import { Notification } from '../models/notification.model';
import { Session } from '../models/session.model';
import { Token } from '../models/token.model';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { isEmailConfigured, sendPasswordResetEmail, sendPasswordSetupEmail } from './email.service';
import { revokeAllSessions } from './session.service';
import { issueToken } from './token.service';
import { CreateVendorInput, UpdateVendorInput } from '../validators/adminAccount.validator';

// Vendor (role "user") account management for admins -- SRS 4.1 FR-1.5.
// Every function here only ever touches accounts with role "user": an admin or
// super admin id is reported as "not found", so this API can never be used to
// edit, suspend or delete staff (that is the separate admin-account API).

export interface VendorView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  type: 'individual' | 'business';
  businessProfile?: { companyName: string; taxId: string };
  status: 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
  followedTagsCount: number;
  lastActiveAt: Date | null;
}

export interface VendorListFilter {
  q?: string;
  status?: 'active' | 'suspended';
  type?: 'individual' | 'business';
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  pageSize?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toVendorView(account: IAccount, followedTagsCount: number, lastActiveAt: Date | null): VendorView {
  return {
    id: account._id.toString(),
    name: account.name,
    email: account.email,
    phone: account.phone,
    type: account.type,
    businessProfile: account.businessProfile
      ? { companyName: account.businessProfile.companyName, taxId: account.businessProfile.taxId }
      : undefined,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    followedTagsCount,
    lastActiveAt
  };
}

// Follow counts and last-activity for a set of accounts, in two grouped
// queries rather than two per row.
async function loadActivity(accountIds: Types.ObjectId[]) {
  const [follows, sessions] = await Promise.all([
    Follow.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { accountId: { $in: accountIds } } },
      { $group: { _id: '$accountId', n: { $sum: 1 } } }
    ]),
    Session.aggregate<{ _id: Types.ObjectId; last: Date }>([
      { $match: { accountId: { $in: accountIds } } },
      { $group: { _id: '$accountId', last: { $max: '$lastActiveAt' } } }
    ])
  ]);
  return {
    follows: new Map(follows.map(f => [f._id.toString(), f.n])),
    lastActive: new Map(sessions.map(s => [s._id.toString(), s.last]))
  };
}

async function findVendor(id: string): Promise<IAccount> {
  const account = await Account.findOne({ _id: id, role: 'user' });
  if (!account) throw AppError.notFound('Vendor account not found.');
  return account;
}

async function viewOf(account: IAccount): Promise<VendorView> {
  const { follows, lastActive } = await loadActivity([account._id]);
  return toVendorView(account, follows.get(account._id.toString()) ?? 0, lastActive.get(account._id.toString()) ?? null);
}

export async function listVendors(filter: VendorListFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = { role: 'user' };
  if (filter.status) query.status = filter.status;
  if (filter.type) query.type = filter.type;
  if (filter.q) {
    const pattern = new RegExp(escapeRegExp(filter.q), 'i');
    query.$or = [
      { name: pattern },
      { email: pattern },
      { 'businessProfile.companyName': pattern },
      { 'businessProfile.taxId': pattern }
    ];
  }

  const sort: Record<string, 1 | -1> =
    filter.sort === 'oldest' ? { createdAt: 1 } : filter.sort === 'name' ? { name: 1 } : { createdAt: -1 };

  const [accounts, total, statusGroups] = await Promise.all([
    Account.find(query)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    Account.countDocuments(query),
    // Unfiltered totals for the header/tabs -- independent of search and filters.
    Account.aggregate<{ _id: string; n: number }>([
      { $match: { role: 'user' } },
      { $group: { _id: '$status', n: { $sum: 1 } } }
    ])
  ]);

  const { follows, lastActive } = await loadActivity(accounts.map(a => a._id));
  const active = statusGroups.find(g => g._id === 'active')?.n ?? 0;
  const suspended = statusGroups.find(g => g._id === 'suspended')?.n ?? 0;

  return {
    items: accounts.map(a => toVendorView(a, follows.get(a._id.toString()) ?? 0, lastActive.get(a._id.toString()) ?? null)),
    total,
    page,
    pageSize,
    summary: { total: active + suspended, active, suspended }
  };
}

export async function getVendor(id: string): Promise<VendorView> {
  return viewOf(await findVendor(id));
}

export interface SetupEmailResult {
  sent: boolean;
  reason?: 'smtp_not_configured' | 'send_failed';
}

// Issues a fresh one-time link and emails it. A vendor who has never signed in
// gets the "your account was created" wording; anyone else gets a plain reset.
export async function sendPasswordLink(account: IAccount): Promise<SetupEmailResult> {
  if (!isEmailConfigured()) {
    // Still issue the token so the logged link works in local development.
    const raw = await issueToken(account._id, 'password_reset');
    await sendPasswordSetupEmail(account.email, account.name, raw).catch(() => undefined);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    const raw = await issueToken(account._id, 'password_reset');
    const everSignedIn = await Session.exists({ accountId: account._id });
    if (everSignedIn) await sendPasswordResetEmail(account.email, account.name, raw);
    else await sendPasswordSetupEmail(account.email, account.name, raw);
    return { sent: true };
  } catch (err) {
    logger.warn('admin-accounts', `Failed to send password link to ${account.email}`, err);
    return { sent: false, reason: 'send_failed' };
  }
}

export async function createVendor(input: CreateVendorInput): Promise<{ vendor: VendorView; setupEmail: SetupEmailResult }> {
  // A random password nobody knows: the vendor must use the emailed link to
  // choose their own, so no admin ever handles a vendor's password.
  const account = await Account.create({
    name: input.name,
    email: input.email,
    phone: input.phone,
    type: input.type,
    businessProfile: input.businessProfile,
    passwordHash: randomBytes(32).toString('hex'),
    role: 'user',
    status: 'active'
  });

  const setupEmail = await sendPasswordLink(account);
  return { vendor: await viewOf(account), setupEmail };
}

export async function updateVendor(id: string, input: UpdateVendorInput): Promise<VendorView> {
  const account = await findVendor(id);

  if (input.businessProfile !== undefined && account.type !== 'business') {
    throw AppError.validation({ businessProfile: 'Only business accounts have a business profile.' });
  }

  if (input.name !== undefined) account.name = input.name;
  if (input.phone !== undefined) account.phone = input.phone ?? undefined;
  if (input.businessProfile !== undefined) account.businessProfile = input.businessProfile;

  await account.save();
  return viewOf(account);
}

// Suspending signs the vendor out everywhere immediately -- requireAuth also
// rejects a suspended account on its next request, but revoking the sessions
// means a later reactivation does not silently resurrect old logins.
export async function suspendVendor(id: string): Promise<VendorView> {
  const account = await findVendor(id);
  if (account.status !== 'suspended') {
    account.status = 'suspended';
    await account.save();
  }
  await revokeAllSessions(account._id);
  return viewOf(account);
}

export async function reactivateVendor(id: string): Promise<VendorView> {
  const account = await findVendor(id);
  if (account.status !== 'active') {
    account.status = 'active';
    await account.save();
  }
  return viewOf(account);
}

export async function sendVendorPasswordLink(id: string): Promise<SetupEmailResult> {
  const account = await findVendor(id);
  if (account.status === 'suspended') {
    throw AppError.badRequest('This account is suspended. Reactivate it before sending a password link.');
  }
  return sendPasswordLink(account);
}

// Shared by vendor and admin deletion. Dependents go first so a failure
// part-way leaves a still-deletable account, never orphaned rows pointing at
// nothing.
export async function deleteAccountAndData(accountId: Types.ObjectId): Promise<void> {
  await Promise.all([
    Session.deleteMany({ accountId }),
    Follow.deleteMany({ accountId }),
    Notification.deleteMany({ accountId }),
    Token.deleteMany({ accountId })
  ]);
  await Account.deleteOne({ _id: accountId });
}

// Permanent. Removes the account and everything that only makes sense with it:
// sessions, follows, in-app notifications and outstanding reset links.
export async function deleteVendor(id: string): Promise<{ id: string; email: string }> {
  const account = await findVendor(id);
  await deleteAccountAndData(account._id);
  return { id: account._id.toString(), email: account.email };
}
