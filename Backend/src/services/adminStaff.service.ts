import { randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { Account, AccountRole, IAccount, Permission, adminPermissionProfile } from '../models/account.model';
import { Session } from '../models/session.model';
import { AppError } from '../utils/AppError';
import { deleteAccountAndData, SetupEmailResult, sendPasswordLink } from './adminAccount.service';
import { audit } from './audit.service';
import { revokeAllSessions } from './session.service';
import { CreateAdminInput, UpdateAdminInput } from '../validators/adminStaff.validator';

// Admin (staff) account management. Reserved for Super Admins (enforced by the
// router). Rules of engagement:
//   - Staff means role "admin" or "superadmin". Vendors are a different API
//     and are reported as "not found" here.
//   - Only plain Admin accounts can be changed. Super Admin accounts are
//     listed for visibility but are read-only: nobody can edit, suspend,
//     sign out or delete one through the panel, and no call can create or
//     promote one -- that stays a deliberate out-of-band act (seedSuperAdmin).

export interface StaffView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'superadmin';
  /**
   * Which of the three Admin roles this Admin holds: 'poll:manage' (Poll Admin),
   * 'tag:manage' (Tag Admin) or 'poll&tag:manage' (Poll and Tag Admin). null
   * for a Super Admin (needs none) and for an Admin nobody has assigned a role
   * yet (created before roles were split) -- that Admin can open only the
   * dashboard and vendor accounts until a Super Admin picks one.
   */
  permission: Permission | null;
  status: 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
  activeSessions: number;
  /** false for Super Admins: shown, but not changeable here. */
  manageable: boolean;
}

export interface StaffListFilter {
  q?: string;
  status?: 'active' | 'suspended';
  role?: 'admin' | 'superadmin';
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  pageSize?: number;
}

const STAFF_ROLES: AccountRole[] = ['admin', 'superadmin'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toStaffView(account: IAccount, lastActiveAt: Date | null, activeSessions: number): StaffView {
  const role = account.role as 'admin' | 'superadmin';
  return {
    id: account._id.toString(),
    name: account.name,
    email: account.email,
    phone: account.phone,
    role,
    permission: role === 'admin' ? adminPermissionProfile(account.permissions ?? []) : null,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastActiveAt,
    activeSessions,
    manageable: role === 'admin'
  };
}

// Last activity and currently-live session count for a set of accounts, in one
// grouped query. "Live" = not revoked and not expired: who could act right now.
async function loadActivity(accountIds: Types.ObjectId[]) {
  const now = new Date();
  const rows = await Session.aggregate<{ _id: Types.ObjectId; last: Date; live: number }>([
    { $match: { accountId: { $in: accountIds } } },
    {
      $group: {
        _id: '$accountId',
        last: { $max: '$lastActiveAt' },
        live: {
          $sum: {
            $cond: [{ $and: [{ $not: ['$revokedAt'] }, { $gt: ['$expiresAt', now] }] }, 1, 0]
          }
        }
      }
    }
  ]);
  return new Map(rows.map(r => [r._id.toString(), r]));
}

async function viewOf(account: IAccount): Promise<StaffView> {
  const activity = (await loadActivity([account._id])).get(account._id.toString());
  return toStaffView(account, activity?.last ?? null, activity?.live ?? 0);
}

async function findStaff(id: string): Promise<IAccount> {
  const account = await Account.findOne({ _id: id, role: { $in: STAFF_ROLES } });
  if (!account) throw AppError.notFound('Admin account not found.');
  return account;
}

// Finds a staff account the caller is allowed to CHANGE: plain Admins only.
async function findManageableAdmin(id: string): Promise<IAccount> {
  const account = await findStaff(id);
  if (account.role !== 'admin') {
    throw AppError.forbidden('Super Admin accounts cannot be changed from the admin panel.');
  }
  return account;
}

export async function listStaff(filter: StaffListFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = { role: filter.role ?? { $in: STAFF_ROLES } };
  if (filter.status) query.status = filter.status;
  if (filter.q) {
    const pattern = new RegExp(escapeRegExp(filter.q), 'i');
    query.$or = [{ name: pattern }, { email: pattern }];
  }

  const sort: Record<string, 1 | -1> =
    filter.sort === 'oldest' ? { createdAt: 1 } : filter.sort === 'name' ? { name: 1 } : { createdAt: -1 };

  const [accounts, total, groups] = await Promise.all([
    Account.find(query)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    Account.countDocuments(query),
    // Unfiltered totals for the header/tabs -- independent of search and filters.
    Account.aggregate<{ _id: { role: string; status: string }; n: number }>([
      { $match: { role: { $in: STAFF_ROLES } } },
      { $group: { _id: { role: '$role', status: '$status' }, n: { $sum: 1 } } }
    ])
  ]);

  const activity = await loadActivity(accounts.map(a => a._id));
  const count = (role?: string, status?: string) =>
    groups
      .filter(g => (!role || g._id.role === role) && (!status || g._id.status === status))
      .reduce((sum, g) => sum + g.n, 0);

  return {
    items: accounts.map(a => {
      const act = activity.get(a._id.toString());
      return toStaffView(a, act?.last ?? null, act?.live ?? 0);
    }),
    total,
    page,
    pageSize,
    summary: {
      total: count(),
      admins: count('admin'),
      superadmins: count('superadmin'),
      suspended: count(undefined, 'suspended')
    }
  };
}

export async function getStaff(id: string): Promise<StaffView> {
  return viewOf(await findStaff(id));
}

export async function createAdmin(input: CreateAdminInput): Promise<{ admin: StaffView; setupEmail: SetupEmailResult }> {
  // A random password nobody knows: the new admin must use the emailed link to
  // choose their own, so no one ever handles another admin's password.
  const account = await Account.create({
    name: input.name,
    email: input.email,
    phone: input.phone,
    type: 'individual',
    passwordHash: randomBytes(32).toString('hex'),
    role: 'admin',
    permissions: [input.permission],
    status: 'active'
  });

  const setupEmail = await sendPasswordLink(account);
  return { admin: await viewOf(account), setupEmail };
}

export async function updateAdmin(id: string, input: UpdateAdminInput): Promise<StaffView> {
  const account = await findManageableAdmin(id);
  if (input.name !== undefined) account.name = input.name;
  if (input.phone !== undefined) account.phone = input.phone ?? undefined;
  // Takes effect on the admin's very next request: permissions are read from
  // the account on every call, not baked into the session.
  if (input.permission !== undefined) account.permissions = [input.permission];
  await account.save();
  return viewOf(account);
}

// Suspending signs the admin out everywhere immediately.
export async function suspendAdmin(id: string): Promise<StaffView> {
  const account = await findManageableAdmin(id);
  if (account.status !== 'suspended') {
    account.status = 'suspended';
    await account.save();
  }
  await revokeAllSessions(account._id);
  return viewOf(account);
}

export async function reactivateAdmin(id: string): Promise<StaffView> {
  const account = await findManageableAdmin(id);
  if (account.status !== 'active') {
    account.status = 'active';
    await account.save();
  }
  return viewOf(account);
}

// Ends every live session without suspending -- for a lost laptop or a
// suspected compromise, where the person should simply have to sign in again.
export async function signOutAdminEverywhere(id: string): Promise<{ revoked: number }> {
  const account = await findManageableAdmin(id);
  const revoked = await revokeAllSessions(account._id);
  // Sessions are not an audited model (they churn on every sign-in), so record the action by hand.
  await audit.log({ action: 'account.sign_out_all', entity: account, metadata: { role: account.role, sessionsRevoked: revoked } });
  return { revoked };
}

export async function sendAdminPasswordLink(id: string): Promise<SetupEmailResult> {
  const account = await findManageableAdmin(id);
  if (account.status === 'suspended') {
    throw AppError.badRequest('This account is suspended. Reactivate it before sending a password link.');
  }
  const result = await sendPasswordLink(account);
  await audit.log({ action: 'account.password_link_sent', entity: account, metadata: { role: account.role, emailSent: result.sent, reason: result.reason } });
  return result;
}

// Permanent -- same cascade as deleting a vendor.
export async function deleteAdmin(id: string): Promise<{ id: string; email: string }> {
  const account = await findManageableAdmin(id);
  await deleteAccountAndData(account._id);
  return { id: account._id.toString(), email: account.email };
}
