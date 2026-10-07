import type { AppLang } from '@/context/AppContext';
import type { BackendAuditActor, BackendAuditEntry } from '@/lib/backend';

// Presentation helpers for the audit log. Everything here is COSMETIC: the
// filter lists, the table and the diff viewer are driven by the data, so an
// action or entity type this file has never heard of still displays (humanised
// from its own name) and is still filterable.

type Labels = { th: string; en: string };

// Friendly names for the actions we know about today. Anything missing falls back to humanize().
const ACTION_LABELS: Record<string, Labels> = {
  'account.create': { th: 'สร้างบัญชี', en: 'Account created' },
  'account.update': { th: 'แก้ไขบัญชี', en: 'Account edited' },
  'account.suspend': { th: 'ระงับบัญชี', en: 'Account suspended' },
  'account.reactivate': { th: 'เปิดใช้งานบัญชีอีกครั้ง', en: 'Account reactivated' },
  'account.delete': { th: 'ลบบัญชี', en: 'Account deleted' },
  'account.password_change': { th: 'เปลี่ยนรหัสผ่าน', en: 'Password changed' },
  'account.password_link_sent': { th: 'ส่งลิงก์ตั้งรหัสผ่าน', en: 'Password link sent' },
  'account.sign_out_all': { th: 'ออกจากระบบทุกอุปกรณ์', en: 'Signed out everywhere' },
  'account.permission_change': { th: 'เปลี่ยนสิทธิ์ผู้ดูแล', en: 'Admin permission changed' },
  'account.role_change': { th: 'เปลี่ยนบทบาทบัญชี', en: 'Account role changed' },
  'tag.create': { th: 'สร้างแท็ก', en: 'Tag created' },
  'tag.update': { th: 'แก้ไขแท็ก', en: 'Tag edited' },
  'tag.rename': { th: 'เปลี่ยนชื่อแท็ก', en: 'Tag renamed' },
  'tag.synonyms_update': { th: 'แก้ไขคำพ้องความหมาย', en: 'Synonyms edited' },
  'tag.retire': { th: 'ปลดระวางแท็ก', en: 'Tag retired' },
  'tag.reactivate': { th: 'เปิดใช้งานแท็กอีกครั้ง', en: 'Tag reactivated' },
  'tag.ingestion_filter_update': { th: 'เปลี่ยนตัวกรองการดึงข้อมูล', en: 'Ingestion filter changed' },
  'tag.delete': { th: 'ลบแท็ก', en: 'Tag deleted' },
  'work.tags_update': { th: 'แก้ไขแท็กของโครงการ', en: 'Work tags edited' },
  'work.visibility_update': { th: 'เปลี่ยนการแสดงผลของโครงการ', en: 'Work visibility changed' }
};

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "gadget.explode" -> "Gadget: explode" -- for anything not in the table above. */
export function humanize(code: string): string {
  const [entity, ...rest] = code.split('.');
  return rest.length === 0 ? titleCase(entity) : `${titleCase(entity)}: ${rest.join(' ').replace(/[_-]+/g, ' ')}`;
}

export function actionLabel(action: string, lang: AppLang): string {
  return ACTION_LABELS[action]?.[lang] ?? humanize(action);
}

export function entityTypeLabel(type: string): string {
  return titleCase(type);
}

export type ActionTone = 'create' | 'danger' | 'warning' | 'neutral';

/** A colour hint from the verb at the end of the action. The badge always also carries text. */
export function actionTone(action: string): ActionTone {
  const verb = action.split('.').pop() ?? '';
  if (/(create|reactivate|restore)/.test(verb)) return 'create';
  if (/(delete|remove)/.test(verb)) return 'danger';
  if (/(suspend|retire|sign_out|permission|role)/.test(verb)) return 'warning';
  return 'neutral';
}

export const TONE_CLASS: Record<ActionTone, string> = {
  create: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  neutral: 'bg-sky-50 text-sky-800 border-sky-200'
};

export function roleLabel(role: string | undefined, lang: AppLang): string {
  if (role === 'superadmin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'user') return lang === 'en' ? 'Vendor' : 'ผู้ค้า';
  return role ?? '';
}

export function actorTitle(actor: BackendAuditActor, lang: AppLang): string {
  if (actor.type === 'anonymous') return lang === 'en' ? 'Not signed in' : 'ยังไม่ได้เข้าสู่ระบบ';
  if (actor.type === 'system') return lang === 'en' ? `System (${actor.label ?? 'system'})` : `ระบบ (${actor.label ?? 'system'})`;
  return actor.name || actor.email || actor.id || '-';
}

export function formatDateTime(iso: string, lang: AppLang): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'medium' });
}

/** "2026-10-07" (a <input type="date"> value) -> the exact instant that local day starts / ends. */
export function localDayBoundary(day: string, edge: 'start' | 'end'): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const [, y, m, d] = match.map(Number);
  const date = edge === 'start' ? new Date(y, m - 1, d, 0, 0, 0, 0) : new Date(y, m - 1, d, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export interface EntityLink {
  href: string;
  /** Pages that read ?q= on load need a full navigation, not a client-side one (see the note in initialQueryParam). */
  fullPage: boolean;
}

/**
 * Where an entry's item can be opened, when we know. Returns null for entity
 * types with no page (they simply show no link) and for deleted items.
 */
export function entityLink(entry: Pick<BackendAuditEntry, 'action' | 'entityType' | 'entityId' | 'entityLabel' | 'metadata'>): EntityLink | null {
  if (entry.action.endsWith('.delete')) return null; // it no longer exists
  const label = entry.entityLabel ? encodeURIComponent(entry.entityLabel) : '';
  switch (entry.entityType) {
    case 'work':
      return { href: `/admin/works/${encodeURIComponent(entry.entityId)}/tags`, fullPage: false };
    case 'tag':
      return label ? { href: `/admin/tags?q=${label}`, fullPage: true } : null;
    case 'account': {
      const staff = entry.metadata?.role === 'admin' || entry.metadata?.role === 'superadmin';
      return label ? { href: `${staff ? '/admin/users' : '/admin/accounts'}?q=${label}`, fullPage: true } : null;
    }
    default:
      return null;
  }
}

/**
 * Reads a query-string value ON THE CLIENT, once, for an initial state. Pages
 * that use this are reached from the audit log through a full page load, because
 * during a client-side navigation window.location still shows the previous URL
 * at first render -- and useSearchParams() is avoided on purpose (this project
 * documents that it hangs `next dev` without a Suspense boundary).
 */
export function initialQueryParam(name = 'q'): string {
  if (typeof window === 'undefined') return '';
  return (new URLSearchParams(window.location.search).get(name) ?? '').slice(0, 200);
}
