'use client';

import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import { formatDate, setupEmailMessage, Translate } from '@/lib/adminUi';
import { ErrorRetry } from '@/components/ErrorRetry';
import { initialQueryParam } from '@/lib/auditUi';
import {
  BackendAccountStatus,
  BackendAccountType,
  BackendVendor,
  BackendVendorList,
  createVendor,
  deleteVendor,
  fetchVendors,
  reactivateVendor,
  sendVendorPasswordLink,
  suspendVendor,
  updateVendor
} from '@/lib/backend';
import {
  Users,
  Search,
  UserPlus,
  X,
  Ban,
  CheckCircle2,
  Trash2,
  Pencil,
  Mail,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2
} from 'lucide-react';

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

function VendorFormModal({
  vendor,
  onClose,
  onSaved
}: {
  vendor: BackendVendor | null; // null = create
  onClose: () => void;
  onSaved: (message: { ok: boolean; text: string }) => void;
}) {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);
  const isEdit = vendor !== null;

  const [name, setName] = useState(vendor?.name ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [type, setType] = useState<BackendAccountType>(vendor?.type ?? 'individual');
  const [companyName, setCompanyName] = useState(vendor?.businessProfile?.companyName ?? '');
  const [taxId, setTaxId] = useState(vendor?.businessProfile?.taxId ?? '');
  const [saving, setSaving] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const isBusiness = type === 'business';
  const requiredMissing = !name.trim() || (!isEdit && !email.trim()) || (isBusiness && (!companyName.trim() || !taxId.trim()));
  const unchanged =
    isEdit &&
    name.trim() === vendor.name &&
    phone.trim() === (vendor.phone ?? '') &&
    (!isBusiness || (companyName.trim() === (vendor.businessProfile?.companyName ?? '') && taxId.trim() === (vendor.businessProfile?.taxId ?? '')));

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.fields) {
      setFieldErrors(err.fields);
      setFormError(err.code === 'EMAIL_ALREADY_REGISTERED' ? t('อีเมลนี้ถูกใช้งานแล้ว', 'This email is already in use.') : null);
    } else {
      setFormError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    }
  };

  const save = async () => {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (isEdit) {
        await updateVendor(vendor.id, {
          name: name.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          ...(isBusiness ? { businessProfile: { companyName: companyName.trim(), taxId: taxId.trim() } } : {})
        });
        onSaved({ ok: true, text: t(`บันทึกบัญชี ${name.trim()} แล้ว`, `Saved account ${name.trim()}`) });
      } else {
        const result = await createVendor({
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          type,
          ...(isBusiness ? { businessProfile: { companyName: companyName.trim(), taxId: taxId.trim() } } : {})
        });
        const mail = setupEmailMessage(result.vendor.email, result.setupEmail, t);
        onSaved({ ok: mail.ok, text: t(`สร้างบัญชี ${result.vendor.name} แล้ว — `, `Created account ${result.vendor.name} — `) + mail.text });
      }
    } catch (err) {
      handleError(err);
      setSaving(false);
    }
  };

  const sendLink = async () => {
    if (!vendor) return;
    setSendingLink(true);
    setLinkNotice(null);
    try {
      setLinkNotice(setupEmailMessage(vendor.email, await sendVendorPasswordLink(vendor.id), t));
    } catch (err) {
      setLinkNotice({ ok: false, text: err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong') });
    } finally {
      setSendingLink(false);
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
      <div role="dialog" aria-modal="true" aria-labelledby="vendor-form-title" className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-5 animate-scale-in">
        <div className="flex items-center justify-between">
          <h2 id="vendor-form-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            {isEdit ? <Pencil className="w-5 h-5 text-sky-600" /> : <UserPlus className="w-5 h-5 text-sky-600" />}
            <span>{isEdit ? t('แก้ไขบัญชีผู้ค้า', 'Edit Vendor Account') : t('เพิ่มบัญชีผู้ค้า', 'Add Vendor Account')}</span>
          </h2>
          <button onClick={onClose} aria-label={t('ปิด', 'Close')} className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="vf-name" className="text-xs font-bold text-slate-500 uppercase">{t('ชื่อ-นามสกุล', 'Name')}</label>
            <input id="vf-name" type="text" autoFocus value={name} maxLength={150} onChange={e => setName(e.target.value)} className={inputClass('name')} />
            {fieldError('name')}
          </div>

          <div>
            <label htmlFor="vf-email" className="text-xs font-bold text-slate-500 uppercase">{t('อีเมล', 'Email')}</label>
            <input id="vf-email" type="email" value={email} disabled={isEdit} onChange={e => setEmail(e.target.value)} className={inputClass('email')} />
            {isEdit && <p className="text-[11px] text-slate-500 mt-1">{t('เปลี่ยนอีเมลไม่ได้ (ใช้เป็นตัวตนของบัญชี)', 'The email cannot be changed (it identifies the account).')}</p>}
            {fieldError('email')}
          </div>

          <div>
            <label htmlFor="vf-phone" className="text-xs font-bold text-slate-500 uppercase">{t('เบอร์โทรศัพท์ (ไม่บังคับ)', 'Phone (optional)')}</label>
            <input id="vf-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0812345678" className={inputClass('phone')} />
            {fieldError('phone')}
          </div>

          <div>
            <label htmlFor="vf-type" className="text-xs font-bold text-slate-500 uppercase">{t('ประเภทบัญชี', 'Account Type')}</label>
            <select id="vf-type" value={type} disabled={isEdit} onChange={e => setType(e.target.value as BackendAccountType)} className={inputClass('type')}>
              <option value="individual">{t('บุคคล', 'Individual')}</option>
              <option value="business">{t('นิติบุคคล', 'Business')}</option>
            </select>
            {isEdit && <p className="text-[11px] text-slate-500 mt-1">{t('ประเภทบัญชีเปลี่ยนไม่ได้หลังสร้าง', 'The account type cannot be changed.')}</p>}
          </div>

          {isBusiness && (
            <div className="space-y-3">
              <div>
                <label htmlFor="vf-company" className="text-xs font-bold text-slate-500 uppercase">{t('ชื่อบริษัท', 'Company Name')}</label>
                <input id="vf-company" type="text" value={companyName} maxLength={200} onChange={e => setCompanyName(e.target.value)} className={inputClass('businessProfile.companyName')} />
                {fieldError('businessProfile.companyName')}
              </div>
              <div>
                <label htmlFor="vf-tax" className="text-xs font-bold text-slate-500 uppercase">{t('เลขประจำตัวผู้เสียภาษี (13 หลัก)', 'Tax ID (13 digits)')}</label>
                <input id="vf-tax" type="text" inputMode="numeric" value={taxId} maxLength={13} onChange={e => setTaxId(e.target.value)} className={`${inputClass('businessProfile.taxId')} font-mono`} />
                {fieldError('businessProfile.taxId')}
                {fieldError('businessProfile')}
              </div>
            </div>
          )}
        </div>

        {!isEdit && (
          <p className="flex items-start gap-2 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-xl p-3">
            <Mail className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            {t('ผู้ดูแลไม่ต้องตั้งรหัสผ่าน — ระบบจะส่งอีเมลลิงก์ให้ผู้ค้าตั้งรหัสผ่านเอง (ลิงก์อายุ 1 ชั่วโมง)', 'You do not set a password. The vendor is emailed a link to choose their own (valid for 1 hour).')}
          </p>
        )}

        {isEdit && (
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <button
              type="button"
              onClick={() => void sendLink()}
              disabled={sendingLink || vendor.status === 'suspended'}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {sendingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              {t('ส่งลิงก์ตั้งรหัสผ่าน', 'Send password link')}
            </button>
            {vendor.status === 'suspended' && (
              <p className="text-[11px] text-slate-500">{t('บัญชีถูกระงับ — เปิดใช้งานก่อนจึงจะส่งลิงก์ได้', 'Suspended account — reactivate it before sending a link.')}</p>
            )}
            {linkNotice && (
              <p role="status" className={`text-xs rounded-xl p-3 border ${linkNotice.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-900 bg-amber-50 border-amber-200'}`}>
                {linkNotice.text}
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
            {isEdit ? t('บันทึก', 'Save') : t('เพิ่มบัญชี', 'Add Account')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function VendorAccountsPage() {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);

  const [searchInput, setSearchInput] = useState(() => initialQueryParam('q'));
  const [q, setQ] = useState(() => initialQueryParam('q'));
  const [status, setStatus] = useState<'' | BackendAccountStatus>('');
  const [type, setType] = useState<'' | BackendAccountType>('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<BackendVendorList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [formVendor, setFormVendor] = useState<BackendVendor | null | undefined>(undefined); // undefined = closed, null = create
  const [suspending, setSuspending] = useState<BackendVendor | null>(null);
  const [deleting, setDeleting] = useState<BackendVendor | null>(null);
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
    fetchVendors({ q: q || undefined, status: status || undefined, type: type || undefined, sort, page, pageSize: PAGE_SIZE })
      .then(result => {
        if (stale) return;
        // Deleting the last row of a later page: fall back to the last page that still exists.
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
  }, [q, status, type, sort, page, reloadKey]);

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
    setFormVendor(undefined);
    setSuspending(null);
    setDeleting(null);
    showNotice(message);
    setReloadKey(k => k + 1);
  };

  const reactivate = async (vendor: BackendVendor) => {
    setActionError(null);
    try {
      await reactivateVendor(vendor.id);
      afterChange({ ok: true, text: t(`เปิดใช้งานบัญชี ${vendor.name} อีกครั้งแล้ว`, `Reactivated ${vendor.name}`) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = q !== '' || status !== '' || type !== '';
  const summary = data?.summary;

  const statusTabs: { key: '' | BackendAccountStatus; label: string; count: number | undefined }[] = [
    { key: '', label: t('ทั้งหมด', 'All'), count: summary?.total },
    { key: 'active', label: t('ใช้งานอยู่', 'Active'), count: summary?.active },
    { key: 'suspended', label: t('ถูกระงับ', 'Suspended'), count: summary?.suspended }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-600" />
            <span>{t('บัญชีผู้ค้า', 'Vendor Accounts')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t('บัญชีผู้ใช้งานแบบรวมศูนย์ ทั้งบุคคลและนิติบุคคล ค้นหา เพิ่ม ระงับ หรือลบได้', 'Unified accounts — individual and business — search, add, suspend, or remove')}
          </p>
        </div>

        <button
          onClick={() => setFormVendor(null)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t('เพิ่มบัญชี', 'Add Account')}</span>
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
            aria-label={t('ค้นหาบัญชี', 'Search accounts')}
            placeholder={t('ค้นหาชื่อ อีเมล ชื่อบริษัท หรือเลขภาษี...', 'Search name, email, company or tax ID...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-200 bg-white" role="group" aria-label={t('กรองตามสถานะ', 'Filter by status')}>
          {statusTabs.map(tab => (
            <button
              key={tab.key || 'all'}
              onClick={() => changeFilter(() => setStatus(tab.key))}
              aria-pressed={status === tab.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${status === tab.key ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-sky-700'}`}
            >
              {tab.label} {tab.count !== undefined && <span className="opacity-70">{tab.count}</span>}
            </button>
          ))}
        </div>

        <select
          value={type}
          onChange={e => changeFilter(() => setType(e.target.value as '' | BackendAccountType))}
          aria-label={t('กรองตามประเภทบัญชี', 'Filter by account type')}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 outline-hidden focus:border-sky-400"
        >
          <option value="">{t('ทุกประเภท', 'All types')}</option>
          <option value="individual">{t('บุคคล', 'Individual')}</option>
          <option value="business">{t('นิติบุคคล', 'Business')}</option>
        </select>

        <select
          value={sort}
          onChange={e => changeFilter(() => setSort(e.target.value as 'newest' | 'oldest' | 'name'))}
          aria-label={t('เรียงลำดับ', 'Sort')}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 outline-hidden focus:border-sky-400"
        >
          <option value="newest">{t('ลงทะเบียนล่าสุด', 'Newest first')}</option>
          <option value="oldest">{t('ลงทะเบียนเก่าสุด', 'Oldest first')}</option>
          <option value="name">{t('ชื่อ ก-ฮ', 'Name A–Z')}</option>
        </select>
      </div>

      {loading && !data && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-3 animate-pulse" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
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
                  <th className="p-4">{t('ชื่อ & อีเมล', 'Name & Email')}</th>
                  <th className="p-4">{t('ประเภทบัญชี', 'Type')}</th>
                  <th className="p-4">{t('แท็กที่ติดตาม', 'Followed Tags')}</th>
                  <th className="p-4">{t('วันที่ลงทะเบียน', 'Registered')}</th>
                  <th className="p-4">{t('ใช้งานล่าสุด', 'Last active')}</th>
                  <th className="p-4">{t('สถานะ', 'Status')}</th>
                  <th className="p-4 text-right">{t('จัดการ', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {data.items.map(account => (
                  <tr key={account.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{account.name}</p>
                      <p className="text-slate-400 text-[11px] font-mono">{account.email}</p>
                      {account.businessProfile && <p className="text-slate-500 text-[11px] mt-0.5">{account.businessProfile.companyName}</p>}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${account.type === 'business' ? 'bg-sky-50 text-sky-700 border-sky-100' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {account.type === 'business' ? t('นิติบุคคล', 'Business') : t('บุคคล', 'Individual')}
                      </span>
                    </td>
                    <td className="p-4 text-slate-600">{account.followedTagsCount}</td>
                    <td className="p-4 text-slate-400 whitespace-nowrap">{formatDate(account.createdAt, lang)}</td>
                    <td className="p-4 text-slate-400 whitespace-nowrap">{account.lastActiveAt ? formatDate(account.lastActiveAt, lang) : t('ยังไม่เคยเข้าใช้', 'Never')}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${account.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                        {account.status === 'active' ? t('ใช้งานอยู่', 'Active') : t('ถูกระงับ', 'Suspended')}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        <button onClick={() => setFormVendor(account)} title={t('แก้ไข', 'Edit')} aria-label={t(`แก้ไข ${account.name}`, `Edit ${account.name}`)} className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-800 font-semibold transition-colors cursor-pointer">
                          <Pencil className="w-4 h-4" />
                          <span className="hidden 2xl:inline">{t('แก้ไข', 'Edit')}</span>
                        </button>
                        {account.status === 'active' ? (
                          <button onClick={() => setSuspending(account)} title={t('ระงับ', 'Suspend')} aria-label={t(`ระงับ ${account.name}`, `Suspend ${account.name}`)} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 font-semibold transition-colors cursor-pointer">
                            <Ban className="w-4 h-4" />
                            <span className="hidden 2xl:inline">{t('ระงับ', 'Suspend')}</span>
                          </button>
                        ) : (
                          <button onClick={() => void reactivate(account)} title={t('เปิดใช้', 'Activate')} aria-label={t(`เปิดใช้ ${account.name}`, `Activate ${account.name}`)} className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-semibold transition-colors cursor-pointer">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="hidden 2xl:inline">{t('เปิดใช้', 'Activate')}</span>
                          </button>
                        )}
                        <button onClick={() => setDeleting(account)} title={t('ลบ', 'Delete')} aria-label={t(`ลบ ${account.name}`, `Delete ${account.name}`)} className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-semibold transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                          <span className="hidden 2xl:inline">{t('ลบ', 'Delete')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      {filtersActive ? t('ไม่พบบัญชีที่ตรงกับการค้นหา', 'No accounts match your search.') : t('ยังไม่มีบัญชีผู้ค้า', 'No vendor accounts yet.')}
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

      {formVendor !== undefined && <VendorFormModal key={formVendor?.id ?? 'new'} vendor={formVendor} onClose={() => setFormVendor(undefined)} onSaved={afterChange} />}

      {suspending && (
        <ConfirmModal
          tone="amber"
          title={t(`ระงับบัญชี ${suspending.name}?`, `Suspend ${suspending.name}?`)}
          confirmLabel={t('ระงับบัญชี', 'Suspend')}
          onClose={() => setSuspending(null)}
          onConfirm={async () => {
            await suspendVendor(suspending.id);
            afterChange({ ok: true, text: t(`ระงับบัญชี ${suspending.name} แล้ว`, `Suspended ${suspending.name}`) });
          }}
        >
          <p>{t('ผู้ค้าจะถูกออกจากระบบทุกอุปกรณ์ทันที และเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ข้อมูลและแท็กที่ติดตามยังอยู่ครบ', 'They are signed out everywhere immediately and cannot sign in until reactivated. Their data and followed tags are kept.')}</p>
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
            await deleteVendor(deleting.id);
            afterChange({ ok: true, text: t(`ลบบัญชี ${deleting.email} แล้ว`, `Deleted ${deleting.email}`) });
          }}
        >
          <p>{t('การลบเป็นการถาวร กู้คืนไม่ได้ ระบบจะลบบัญชี การเข้าสู่ระบบ แท็กที่ติดตาม และการแจ้งเตือนทั้งหมดของผู้ค้ารายนี้', 'This is permanent and cannot be undone. The account, its sign-ins, followed tags and notifications are all removed.')}</p>
          <p className="text-xs text-slate-500">{t('หากต้องการเพียงหยุดการใช้งานชั่วคราว ให้เลือก “ระงับ” แทน', 'If you only need to stop access for now, use “Suspend” instead.')}</p>
        </ConfirmModal>
      )}
    </div>
  );
}
