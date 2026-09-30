import type { UserRole } from '@/context/AppContext';

// Single source of truth for which roles may open which admin pages. Used by
// the admin layout (route guard) and the sidebar (which links to show), so a
// link is never shown for a page the guard would then refuse.
//
// This is UX only -- the real enforcement is server-side (requireAdmin /
// requireSuperAdmin in Backend/src/routes/admin.routes.ts).

/** Admin pages only a Super Admin may open. Everything else under /admin is Admin + Super Admin. */
const SUPER_ADMIN_ONLY_PREFIXES = ['/admin/source-config'];

export function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function canAccessAdminPath(role: UserRole, path: string): boolean {
  if (!isAdminRole(role)) return false;
  if (SUPER_ADMIN_ONLY_PREFIXES.some(prefix => matchesPrefix(path, prefix))) {
    return role === 'superadmin';
  }
  return true;
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
