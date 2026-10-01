'use client';

import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ErrorRetry } from '@/components/ErrorRetry';
import { formatDate, setupEmailMessage, Translate } from '@/lib/adminUi';
import { ADMIN_PERMISSIONS, ADMIN_ROLE_LABEL, AdminPermission, adminRoleName } from '@/lib/adminAccess';
import {
  BackendAccountStatus,
  BackendStaff,
  BackendStaffList,
  BackendStaffRole,
  createAdminAccount,
  deleteAdminAccount,
  fetchStaff,
  reactivateAdminAccount,
  sendAdminPasswordLink,
  signOutAdminAccount,
  suspendAdminAccount,
  updateAdminAccount
} from '@/lib/backend';
import {
  ShieldCheck,
  UserPlus,
  Search,
  X,
  Ban,
  CheckCircle2,
  Trash2,
  Pencil,
  Mail,
  LogOut,
  Lock,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2
} from 'lucide-react';

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

function StaffFormModal({
  admin,
  onClose,
  onSaved
}: {
  admin: BackendStaff | null; // null = create
  onClose: () => void;
  onSaved: (message: { ok: boolean; text: string }) => void;
}) {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);
  const isEdit = admin !== null;

  const [name, setName] = useState(admin?.name ?? '');
  const [email, setEmail] = useState(admin?.email ?? '');
  const [phone, setPhone] = useState(admin?.phone ?? '');
  // Which of the three Admin roles this account holds (none yet = not chosen).
  const [permission, setPermission] = useState<AdminPermission | ''>(admin?.permission ?? '');
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<'link' | 'signout' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const requiredMissing = !name.trim() || (!isEdit && !email.trim()) || permission === '';
  const unchanged = isEdit && name.trim() === admin.name && phone.trim() === (admin.phone ?? '') && permission === (admin.permission ?? '');

  const save = async () => {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (isEdit) {
        // Send only what changed: giving an existing Admin a role must not
        // re-validate (and possibly reject) a name or phone number that was
        // already on the account and that nobody touched.
        await updateAdminAccount(admin.id, {
          ...(name.trim() !== admin.name ? { name: name.trim() } : {}),
          ...(phone.trim() !== (admin.phone ?? '') ? { phone: phone.trim() === '' ? null : phone.trim() } : {}),
          ...(permission !== '' && permission !== admin.permission ? { permission } : {})
        });
        onSaved({ ok: true, text: t(`บันทึกบัญชี ${name.trim()} แล้ว`, `Saved ${name.trim()}`) });
      } else {
        if (permission === '') return; // the button is disabled until a role is chosen
        const result = await createAdminAccount({ name: name.trim(), email: email.trim(), permission, ...(phone.trim() ? { phone: phone.trim() } : {}) });
        const mail = setupEmailMessage(result.admin.email, result.setupEmail, t);
        onSaved({ ok: mail.ok, text: t(`สร้างบัญชีผู้ดูแล ${result.admin.name} แล้ว — `, `Created admin ${result.admin.name} — `) + mail.text });
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFieldErrors(err.fields);
        setFormError(err.code === 'EMAIL_ALREADY_REGISTERED' ? t('อีเมลนี้ถูกใช้งานแล้ว', 'This email is already in use.') : null);
      } else {
        setFormError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
      }
      setSaving(false);
    }
  };

  const runAction = async (kind: 'link' | 'signout') => {
    if (!admin) return;
    setBusyAction(kind);
    setActionNotice(null);
    try {
      if (kind === 'link') {
        setActionNotice(setupEmailMessage(admin.email, await sendAdminPasswordLink(admin.id), t));
      } else {
        const { revoked } = await signOutAdminAccount(admin.id);
        setActionNotice({
          ok: true,
          text: revoked > 0 ? t(`ออกจากระบบ ${revoked} เซสชันแล้ว`, `Signed out ${revoked} session(s).`) : t('ไม่มีเซสชันที่ใช้งานอยู่', 'There were no active sessions.')
        });
      }
    } catch (err) {
      setActionNotice({ ok: false, text: err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong') });
    } finally {
      setBusyAction(null);
    }
  };

  const inputClass = (field: string) =>
    `mt-1 w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400 disabled:bg-slate-50 disabled:text-slate-500 ${
      fieldErrors[field] ? 'border-rose-300' : 'border-slate-200'
    }`;
  const fieldError = (field: string) =>
    fieldErrors[field] ? (
      <p role="alert" className="text-[11px] text-rose-600 mt-1">
        {fieldErrors[field]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="staff-form-title" className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-5 animate-scale-in">
        <div className="flex items-center justify-between">
          <h2 id="staff-form-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            {isEdit ? <Pencil className="w-5 h-5 text-sky-600" /> : <UserPlus className="w-5 h-5 text-sky-600" />}
            <span>{isEdit ? t('แก้ไขบัญชีผู้ดูแลระบบ', 'Edit Admin Account') : t('เพิ่มผู้ดูแลระบบ', 'Add Admin')}</span>
          </h2>
          <button onClick={onClose} aria-label={t('ปิด', 'Close')} className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="sf-name" className="text-xs font-bold text-slate-500 uppercase">{t('ชื่อ-นามสกุล', 'Name')}</label>
            <input id="sf-name" type="text" autoFocus value={name} maxLength={150} onChange={e => setName(e.target.value)} className={inputClass('name')} />
            {fieldError('name')}
          </div>
          <div>
            <label htmlFor="sf-email" className="text-xs font-bold text-slate-500 uppercase">{t('อีเมล', 'Email')}</label>
            <input id="sf-email" type="email" value={email} disabled={isEdit} onChange={e => setEmail(e.target.value)} className={inputClass('email')} />
            {isEdit && <p className="text-[11px] text-slate-500 mt-1">{t('เปลี่ยนอีเมลไม่ได้ (ใช้เป็นตัวตนของบัญชี)', 'The email cannot be changed (it identifies the account).')}</p>}
            {fieldError('email')}
          </div>
          <div>
            <label htmlFor="sf-phone" className="text-xs font-bold text-slate-500 uppercase">{t('เบอร์โทรศัพท์ (ไม่บังคับ)', 'Phone (optional)')}</label>
            <input id="sf-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0812345678" className={inputClass('phone')} />
            {fieldError('phone')}
          </div>
          <div role="radiogroup" aria-labelledby="sf-role-label">
            <span id="sf-role-label" className="text-xs font-bold text-slate-500 uppercase">{t('สิทธิ์ในระบบ', 'Role')}</span>
            <div className="mt-1 space-y-2">
              {ADMIN_PERMISSIONS.map(option => {
                const selected = permission === option;
                return (
                  <label
                    key={option}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                      selected ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-sky-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sf-role"
                      value={option}
                      checked={selected}
                      onChange={() => setPermission(option)}
                      className="mt-1 accent-sky-600"
                    />
                    <span>
                      <span className="block text-sm font-bold text-slate-900">{ADMIN_ROLE_LABEL[option][lang === 'en' ? 'en' : 'th']}</span>
                      <span className="block text-[11px] text-slate-500">{ADMIN_ROLE_LABEL[option][lang === 'en' ? 'descriptionEn' : 'descriptionTh']}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {fieldError('permission')}
            <p className="text-[11px] text-slate-500 mt-1">
              {t(
                'บัญชีที่สร้างที่นี่เป็น Admin เสมอ และเห็นเฉพาะเมนูตามสิทธิ์ที่เลือก — ผู้ดูแลระบบสูงสุดสร้างผ่านช่องทางอื่น',
                'Accounts created here are always plain Admins and only see the menus their role covers. Super Admins are set up outside the panel.'
              )}
            </p>
          </div>
        </div>

        {!isEdit && (
          <p className="flex items-start gap-2 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-xl p-3">
            <Mail className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            {t('ไม่มีการตั้งรหัสผ่านให้ — ระบบจะส่งอีเมลลิงก์ให้ผู้ดูแลใหม่ตั้งรหัสผ่านเอง (ลิงก์อายุ 1 ชั่วโมง)', 'No password is set for them. The new admin is emailed a link to choose their own (valid for 1 hour).')}
          </p>
        )}

        {isEdit && (
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('ความปลอดภัยของบัญชี', 'Account security')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAction('link')}
                disabled={busyAction !== null || admin.status === 'suspended'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busyAction === 'link' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                {t('ส่งลิงก์ตั้งรหัสผ่าน', 'Send password link')}
              </button>
              <button
                type="button"
                onClick={() => void runAction('signout')}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busyAction === 'signout' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                {t('ออกจากระบบทุกอุปกรณ์', 'Sign out everywhere')}
              </button>
            </div>
            {admin.status === 'suspended' && <p className="text-[11px] text-slate-500">{t('บัญชีถูกระงับ — เปิดใช้งานก่อนจึงจะส่งลิงก์ได้', 'Suspended account — reactivate it before sending a link.')}</p>}
            {actionNotice && (
              <p role="status" className={`text-xs rounded-xl p-3 border ${actionNotice.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-900 bg-amber-50 border-amber-200'}`}>
                {actionNotice.text}
              </p>
            )}
          </div>
        )}

        {formError && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {formError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer">
            {t('ยกเลิก', 'Cancel')}
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || requiredMissing || unchanged}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? t('บันทึก', 'Save') : t('เพิ่มผู้ดูแล', 'Add Admin')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminUsersPage() {
  const { lang, account } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);

  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'' | BackendStaffRole>('');
  const [status, setStatus] = useState<'' | BackendAccountStatus>('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<BackendStaffList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [formAdmin, setFormAdmin] = useState<BackendStaff | null | undefined>(undefined); // undefined = closed, null = create
  const [suspending, setSuspending] = useState<BackendStaff | null>(null);
  const [deleting, setDeleting] = useState<BackendStaff | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce typing into the search box; a new query goes back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(prev => {
        if (prev !== searchInput.trim()) setPage(1);
        return searchInput.trim();
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let stale = false;
    fetchStaff({ q: q || undefined, role: role || undefined, status: status || undefined, sort: 'name', page, pageSize: PAGE_SIZE })
      .then(result => {
        if (stale) return;
        if (result.items.length === 0 && result.total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(result.total / result.pageSize)));
          return;
        }
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(err instanceof Error ? err.message : '');
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [q, role, status, page, reloadKey]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
    setLoading(true);
  };
  const showNotice = (message: { ok: boolean; text: string }) => {
    setNotice(message);
    setActionError(null);
    window.setTimeout(() => setNotice(current => (current === message ? null : current)), 8000);
  };
  const afterChange = (message: { ok: boolean; text: string }) => {
    setFormAdmin(undefined);
    setSuspending(null);
    setDeleting(null);
    showNotice(message);
    setReloadKey(k => k + 1);
  };

  const reactivate = async (admin: BackendStaff) => {
    setActionError(null);
    try {
      await reactivateAdminAccount(admin.id);
      afterChange({ ok: true, text: t(`เปิดใช้งานบัญชี ${admin.name} อีกครั้งแล้ว`, `Reactivated ${admin.name}`) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = q !== '' || role !== '' || status !== '';
  const summary = data?.summary;

  const roleTabs: { key: '' | BackendStaffRole; label: string; count: number | undefined }[] = [
    { key: '', label: t('ทั้งหมด', 'All'), count: summary?.total },
    { key: 'admin', label: 'Admin', count: summary?.admins },
    { key: 'superadmin', label: 'Super Admin', count: summary?.superadmins }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-sky-600" />
            <span>{t('จัดการบัญชีเจ้าหน้าที่ผู้ดูแลระบบ (Admin Users)', 'Admin & Staff Management')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t('สร้าง แก้ไข ระงับ หรือลบบัญชี Admin แยกจากบัญชีผู้ค้า — ดำเนินการได้เฉพาะผู้ดูแลระบบสูงสุด', 'Create, edit, suspend or remove Admin accounts, separate from vendor accounts. Super Admin only.')}
          </p>
        </div>

        <button
          onClick={() => setFormAdmin(null)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t('เพิ่มผู้ดูแลระบบ', 'Add Admin')}</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 text-xs font-semibold rounded-2xl px-4 py-3 border ${
            notice.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-900 bg-amber-50 border-amber-200'
          }`}
        >
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}
      {actionError && (
        <div role="alert" className="flex items-center gap-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4" />
          {actionError}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex-1 min-w-[240px] focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label={t('ค้นหาเจ้าหน้าที่', 'Search staff')}
            placeholder={t('ค้นหาชื่อหรืออีเมล...', 'Search name or email...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-200 bg-white" role="group" aria-label={t('กรองตามสิทธิ์', 'Filter by role')}>
          {roleTabs.map(tab => (
            <button
              key={tab.key || 'all'}
              onClick={() => changeFilter(() => setRole(tab.key))}
              aria-pressed={role === tab.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${role === tab.key ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-sky-700'}`}
            >
              {tab.label} {tab.count !== undefined && <span className="opacity-70">{tab.count}</span>}
            </button>
          ))}
        </div>

        <select
          value={status}
          onChange={e => changeFilter(() => setStatus(e.target.value as '' | BackendAccountStatus))}
          aria-label={t('กรองตามสถานะ', 'Filter by status')}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 outline-hidden focus:border-sky-400"
        >
          <option value="">{t('ทุกสถานะ', 'All statuses')}</option>
          <option value="active">{t('ใช้งานอยู่', 'Active')}</option>
          <option value="suspended">{t(`ถูกระงับ${summary ? ` (${summary.suspended})` : ''}`, `Suspended${summary ? ` (${summary.suspended})` : ''}`)}</option>
        </select>
      </div>

      {loading && !data && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-3 animate-pulse" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-full bg-slate-100 rounded" />
          ))}
        </div>
      )}

      {!loading && error !== null && !data && <ErrorRetry message={error || undefined} onRetry={reload} />}

      {data && (
        <div className={`bg-white border border-slate-200 rounded-3xl overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="p-4">{t('ชื่อเจ้าหน้าที่ & อีเมล', 'Name & Email')}</th>
                  <th className="p-4">{t('สิทธิ์ในระบบ', 'Role')}</th>
                  <th className="p-4">{t('สถานะ', 'Status')}</th>
                  <th className="p-4 whitespace-nowrap">{t('เซสชัน', 'Sessions')}</th>
                  <th className="p-4 whitespace-nowrap">{t('ใช้งานล่าสุด', 'Last active')}</th>
                  <th className="p-4 hidden xl:table-cell">{t('สร้างเมื่อ', 'Created')}</th>
                  <th className="p-4 text-right">{t('จัดการ', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {data.items.map(staff => {
                  const isYou = account?.email.toLowerCase() === staff.email.toLowerCase();
                  return (
                    <tr key={staff.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4">
                        <p className="font-bold text-slate-900">
                          {staff.name}
                          {isYou && <span className="ml-2 text-[10px] font-bold uppercase text-sky-700 bg-sky-50 border border-sky-100 rounded-full px-2 py-0.5">{t('คุณ', 'You')}</span>}
                        </p>
                        <p className="text-slate-400 text-[11px] font-mono">{staff.email}</p>
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${
                            staff.role === 'superadmin'
                              ? 'bg-violet-50 text-violet-700 border-violet-100'
                              : staff.permission
                                ? 'bg-sky-50 text-sky-700 border-sky-100'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {staff.role === 'superadmin' ? 'Super Admin' : adminRoleName(staff.permission, lang === 'en' ? 'en' : 'th')}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${staff.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                          {staff.status === 'active' ? t('ใช้งานอยู่', 'Active') : t('ถูกระงับ', 'Suspended')}
                        </span>
                      </td>
                      <td className="p-4 text-slate-600 tabular-nums">{staff.activeSessions}</td>
                      <td className="p-4 text-slate-400 whitespace-nowrap">{staff.lastActiveAt ? formatDate(staff.lastActiveAt, lang) : t('ยังไม่เคยเข้าใช้', 'Never')}</td>
                      <td className="p-4 text-slate-400 whitespace-nowrap hidden xl:table-cell">{formatDate(staff.createdAt, lang)}</td>
                      <td className="p-4">
                        {staff.manageable ? (
                          <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                            <button onClick={() => setFormAdmin(staff)} title={t('แก้ไข', 'Edit')} aria-label={t(`แก้ไข ${staff.name}`, `Edit ${staff.name}`)} className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-800 font-semibold transition-colors cursor-pointer">
                              <Pencil className="w-4 h-4" />
                              <span className="hidden 2xl:inline">{t('แก้ไข', 'Edit')}</span>
                            </button>
                            {staff.status === 'active' ? (
                              <button onClick={() => setSuspending(staff)} title={t('ระงับ', 'Suspend')} aria-label={t(`ระงับ ${staff.name}`, `Suspend ${staff.name}`)} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 font-semibold transition-colors cursor-pointer">
                                <Ban className="w-4 h-4" />
                                <span className="hidden 2xl:inline">{t('ระงับ', 'Suspend')}</span>
                              </button>
                            ) : (
                              <button onClick={() => void reactivate(staff)} title={t('เปิดใช้', 'Activate')} aria-label={t(`เปิดใช้ ${staff.name}`, `Activate ${staff.name}`)} className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-semibold transition-colors cursor-pointer">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="hidden 2xl:inline">{t('เปิดใช้', 'Activate')}</span>
                              </button>
                            )}
                            <button onClick={() => setDeleting(staff)} title={t('ลบ', 'Delete')} aria-label={t(`ลบ ${staff.name}`, `Delete ${staff.name}`)} className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-semibold transition-colors cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                              <span className="hidden 2xl:inline">{t('ลบ', 'Delete')}</span>
                            </button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-end gap-1.5 text-slate-400 whitespace-nowrap"
                            title={t('บัญชีผู้ดูแลระบบสูงสุดแก้ไขจากหน้านี้ไม่ได้', 'Super Admin accounts cannot be changed from the panel.')}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>{t('ดูอย่างเดียว', 'Read-only')}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      {filtersActive ? t('ไม่พบบัญชีที่ตรงกับการค้นหา', 'No accounts match your search.') : t('ยังไม่มีบัญชีเจ้าหน้าที่', 'No staff accounts yet.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.total > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 px-4 py-3">
              <span>
                {t(`ทั้งหมด ${data.total} บัญชี`, `${data.total} accounts`)} · {t('หน้า', 'page')} {data.page}/{totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPage(p => Math.max(1, p - 1));
                    setLoading(true);
                  }}
                  disabled={page <= 1}
                  aria-label={t('หน้าก่อนหน้า', 'Previous page')}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setPage(p => Math.min(totalPages, p + 1));
                    setLoading(true);
                  }}
                  disabled={page >= totalPages}
                  aria-label={t('หน้าถัดไป', 'Next page')}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {formAdmin !== undefined && <StaffFormModal key={formAdmin?.id ?? 'new'} admin={formAdmin} onClose={() => setFormAdmin(undefined)} onSaved={afterChange} />}

      {suspending && (
        <ConfirmModal
          tone="amber"
          title={t(`ระงับบัญชี ${suspending.name}?`, `Suspend ${suspending.name}?`)}
          confirmLabel={t('ระงับบัญชี', 'Suspend')}
          onClose={() => setSuspending(null)}
          onConfirm={async () => {
            await suspendAdminAccount(suspending.id);
            afterChange({ ok: true, text: t(`ระงับบัญชี ${suspending.name} แล้ว`, `Suspended ${suspending.name}`) });
          }}
        >
          <p>{t('ผู้ดูแลจะถูกออกจากระบบทุกอุปกรณ์ทันที และเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง', 'They are signed out everywhere immediately and cannot sign in until reactivated.')}</p>
        </ConfirmModal>
      )}

      {deleting && (
        <ConfirmModal
          tone="rose"
          title={t(`ลบบัญชี ${deleting.name}?`, `Delete ${deleting.name}?`)}
          confirmLabel={t('ลบถาวร', 'Delete permanently')}
          requireText={deleting.email}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteAdminAccount(deleting.id);
            afterChange({ ok: true, text: t(`ลบบัญชี ${deleting.email} แล้ว`, `Deleted ${deleting.email}`) });
          }}
        >
          <p>{t('การลบเป็นการถาวร กู้คืนไม่ได้ ระบบจะลบบัญชี การเข้าสู่ระบบ แท็กที่ติดตาม และการแจ้งเตือนทั้งหมดของผู้ดูแลรายนี้', 'This is permanent and cannot be undone. The account, its sign-ins, followed tags and notifications are all removed.')}</p>
          <p className="text-xs text-slate-500">{t('หากต้องการเพียงหยุดการใช้งานชั่วคราว ให้เลือก “ระงับ” แทน', 'If you only need to stop access for now, use “Suspend” instead.')}</p>
        </ConfirmModal>
      )}
    </div>
  );
}
