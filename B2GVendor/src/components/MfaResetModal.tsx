'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldOff, X } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { localizeAuthError } from '@/lib/authMessages';
import { BackendIdentityCheck, BackendMfaResetInput, MFA_IDENTITY_CHECKS } from '@/lib/backend';

// An administrator removing someone's two-step sign-in because they lost their
// authenticator AND their recovery codes (ASVS V6.4.4). The form makes the
// administrator say how they checked who is asking, and why, and asks for their own
// password; all of it is recorded in the audit log. See docs/Security.md section 15.

const IDENTITY_LABEL: Record<BackendIdentityCheck, { th: string; en: string }> = {
  in_person: { th: 'พบตัวต่อตัว พร้อมตรวจเอกสารยืนยันตัวตน', en: 'In person, with identity documents' },
  video_call: { th: 'วิดีโอคอล พร้อมตรวจเอกสารยืนยันตัวตน', en: 'Video call, with identity documents' },
  callback_to_known_number: { th: 'โทรกลับไปยังเบอร์ที่มีอยู่ในระบบอยู่แล้ว', en: 'Called back on a number already on file' },
  other_documented: { th: 'วิธีอื่น (ระบุในเหตุผลด้านล่าง)', en: 'Another way (describe it in the reason)' }
};

export function MfaResetModal({
  name,
  email,
  onSubmit,
  onDone,
  onClose
}: {
  name: string;
  email: string;
  onSubmit: (input: BackendMfaResetInput) => Promise<{ sessionsRevoked: number }>;
  onDone: (result: { sessionsRevoked: number }) => void;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const t = (th: string, en: string) => (lang === 'en' ? en : th);
  const [identityCheck, setIdentityCheck] = useState<BackendIdentityCheck | ''>('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const ready = identityCheck !== '' && reason.trim().length >= 10 && password.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit({ password, identityCheck, reason: reason.trim() });
      onDone(result);
    } catch (err) {
      setError(err instanceof ApiError ? localizeAuthError(err.message, lang) : t('เกิดข้อผิดพลาด', 'Something went wrong'));
      setPassword('');
      setBusy(false);
    }
  };

  const inputClass = 'mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400';
  const labelClass = 'text-xs font-bold text-slate-500 uppercase';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 animate-fade-in">
      <form
        onSubmit={submit}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mfa-reset-title"
        className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4 animate-scale-in"
      >
        <div className="flex items-center justify-between">
          <h2 id="mfa-reset-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldOff className="w-5 h-5 text-amber-600" />
            <span>{t('รีเซ็ตการยืนยันตัวตนสองขั้นตอน', 'Reset two-step sign-in')}</span>
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('ปิด', 'Close')} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="flex gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {t(
              `ทำเมื่อ ${name} (${email}) ทำแอปยืนยันตัวตนและรหัสกู้คืนหายทั้งหมด และคุณตรวจสอบแล้วว่าเป็นตัวเขาจริง การรีเซ็ตจะออกจากระบบทุกอุปกรณ์ของบัญชีนี้ ส่งอีเมลแจ้งเจ้าของบัญชี และบันทึกลงบันทึกการตรวจสอบ`,
              `Do this only when ${name} (${email}) has lost both their authenticator and their recovery codes, and you have checked it is really them. It signs this account out everywhere, emails its owner, and is recorded in the audit log.`
            )}
          </span>
        </p>

        <div>
          <label htmlFor="mfa-reset-check" className={labelClass}>{t('ตรวจสอบตัวตนอย่างไร', 'How was their identity checked?')}</label>
          <select id="mfa-reset-check" value={identityCheck} onChange={e => setIdentityCheck(e.target.value as BackendIdentityCheck | '')} className={inputClass} required>
            <option value="">{t('— เลือก —', '— Choose —')}</option>
            {MFA_IDENTITY_CHECKS.map(check => (
              <option key={check} value={check}>{lang === 'en' ? IDENTITY_LABEL[check].en : IDENTITY_LABEL[check].th}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="mfa-reset-reason" className={labelClass}>{t('สิ่งที่ตรวจสอบ (อย่างน้อย 10 ตัวอักษร)', 'What was checked (at least 10 characters)')}</label>
          <textarea id="mfa-reset-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={3} className={inputClass} required />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{reason.length}/500</p>
        </div>

        <div>
          <label htmlFor="mfa-reset-password" className={labelClass}>{t('รหัสผ่านของคุณเอง', 'Your own password')}</label>
          <input id="mfa-reset-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} required />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 cursor-pointer">
            {t('ยกเลิก', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('รีเซ็ต', 'Reset')}
          </button>
        </div>
      </form>
    </div>
  );
}
