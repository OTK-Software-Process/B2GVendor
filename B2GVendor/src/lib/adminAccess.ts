import type { UserRole } from '@/context/AppContext';

// Single source of truth for which roles may open which admin pages, and which
// boxes/buttons an admin sees. Used by the admin layout (route guard), the
// sidebar, the dashboard and the editor, so a link or button is never shown for
// something the guard (or the server) would then refuse.
//
// This is UX only -- the real enforcement is server-side (requireAdmin /
// requireSuperAdmin / requirePollAccess / requireTagAccess in Backend/src/routes).

/**
 * The three Admin roles, as stored on the account (`permissions`). They match
 * PERMISSIONS in Backend/src/models/account.model.ts; Super Admin needs none.
 */
export type AdminPermission = 'poll:manage' | 'tag:manage' | 'poll&tag:manage';

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = ['poll:manage', 'tag:manage', 'poll&tag:manage'];

export type AdminLang = 'th' | 'en';

// The role names shown everywhere (sidebar footer, dashboard, the admin editor).
export const ADMIN_ROLE_LABEL: Record<AdminPermission, { th: string; en: string; descriptionTh: string; descriptionEn: string }> = {
  'poll:manage': {
    th: 'Poll Admin (ผู้ดูแลการดึงข้อมูล)',
    en: 'Poll Admin',
    descriptionTh: 'สั่ง Poll Now ตั้งตารางเวลา และดูประวัติการดึงข้อมูล',
    descriptionEn: 'Runs Poll Now, sets the schedule and reads the run history'
  },
  'tag:manage': {
    th: 'Tag Admin (ผู้ดูแลแท็ก)',
    en: 'Tag Admin',
    descriptionTh: 'จัดการคลังแท็กและชื่อพ้อง และจัดระเบียบแท็กในโครงการ',
    descriptionEn: 'Manages the tag vocabulary and the tags on each work'
  },
  'poll&tag:manage': {
    th: 'Poll and Tag Admin (ผู้ดูแลการดึงข้อมูลและแท็ก)',
    en: 'Poll and Tag Admin',
    descriptionTh: 'ทำได้ทั้งงานดึงข้อมูลและงานแท็ก',
    descriptionEn: 'Does both the polling work and the tag work'
  }
};

export function adminRoleName(permission: AdminPermission | null | undefined, lang: AdminLang): string {
  if (!permission) return lang === 'en' ? 'Admin (no role assigned yet)' : 'Admin (ยังไม่ได้กำหนดสิทธิ์)';
  return ADMIN_ROLE_LABEL[permission][lang];
}

/** Admin pages only a Super Admin may open: source configuration, and managing other admins. */
const SUPER_ADMIN_ONLY_PREFIXES = ['/admin/source-config', '/admin/users'];
/** Pages for the polling work: Poll Now, the schedule, the run history. */
const POLL_PREFIXES = ['/admin/ingestion'];
/** Pages for the tag work: the vocabulary, and the tags on each work. */
const TAG_PREFIXES = ['/admin/tags', '/admin/works'];

type Permissions = readonly string[] | null | undefined;

export function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

/** Super Admin always may; a plain Admin only with the role that covers polling. */
export function canManagePolling(role: UserRole, permissions: Permissions): boolean {
  if (role === 'superadmin') return true;
  return role === 'admin' && !!permissions && (permissions.includes('poll:manage') || permissions.includes('poll&tag:manage'));
}

/** Super Admin always may; a plain Admin only with the role that covers tags. */
export function canManageTags(role: UserRole, permissions: Permissions): boolean {
  if (role === 'superadmin') return true;
  return role === 'admin' && !!permissions && (permissions.includes('tag:manage') || permissions.includes('poll&tag:manage'));
}

/** Which of the three Admin roles a set of permissions amounts to (null: none assigned yet). */
export function permissionProfile(permissions: Permissions): AdminPermission | null {
  const poll = !!permissions && (permissions.includes('poll:manage') || permissions.includes('poll&tag:manage'));
  const tag = !!permissions && (permissions.includes('tag:manage') || permissions.includes('poll&tag:manage'));
  if (poll && tag) return 'poll&tag:manage';
  if (poll) return 'poll:manage';
  if (tag) return 'tag:manage';
  return null;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export type AdminAreaNeeded = 'superadmin' | 'poll' | 'tag';

/** What an admin page needs, or null when any admin may open it. */
export function adminAreaFor(path: string): AdminAreaNeeded | null {
  if (SUPER_ADMIN_ONLY_PREFIXES.some(prefix => matchesPrefix(path, prefix))) return 'superadmin';
  if (POLL_PREFIXES.some(prefix => matchesPrefix(path, prefix))) return 'poll';
  if (TAG_PREFIXES.some(prefix => matchesPrefix(path, prefix))) return 'tag';
  return null;
}

export function canAccessAdminPath(role: UserRole, path: string, permissions?: Permissions): boolean {
  if (!isAdminRole(role)) return false;
  switch (adminAreaFor(path)) {
    case 'superadmin':
      return role === 'superadmin';
    case 'poll':
      return canManagePolling(role, permissions);
    case 'tag':
      return canManageTags(role, permissions);
    default:
      return true;
  }
}

/**
 * Validates a `?next=` value before redirecting to it after login. Only
 * same-site absolute paths are allowed -- anything else (other origins,
 * protocol-relative `//host`, backslash tricks) is rejected so the login page
 * cannot be turned into an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
