'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { QrCode } from '@/components/QrCode';
import { useApp, AccountView } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/adminAccess';
import { localizeAuthError } from '@/lib/authMessages';
import { formatDateTime } from '@/lib/datetime';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCopy, Download, KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react';

// Two-step sign-in: an authenticator app plus ten recovery codes (docs/Security.md
// section 15; API: docs/API.md section 5). Admin and Super Admin accounts must set
// it up before the admin area opens for them -- the server refuses them until then,
// and this is where the admin layout sends them.

interface MfaStatus {
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  required: boolean;
  setupRequired: boolean;
}

interface SetupStarted {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

interface CodesIssued {
  recoveryCodes: string[];
}

type Lang = 'th' | 'en';

const INPUT_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const PRIMARY_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer';
const CARD = 'rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4';

function groupsOfFour(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function describeError(err: unknown, lang: Lang): string {
  if (err instanceof ApiError) return localizeAuthError(err.message, lang);
  return lang === 'en' ? 'Something went wrong. Please try again.' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  type = 'text',
  value,
  onChange,
  autoComplete,
  inputMode,
  mono = false,
  maxLength,
  autoFocus = false
}: {
  id: string;
  label: string;
  hint?: string;
  type?: 'text' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  inputMode?: 'numeric' | 'text';
  mono?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-slate-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        autoFocus={autoFocus}
        spellCheck={false}
        className={`${INPUT_CLASS} ${mono ? 'font-mono tracking-widest' : ''}`}
        required
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- recovery codes

function RecoveryCodesPanel({ codes, lang, onDone }: { codes: string[]; lang: Lang; onDone: () => void }) {
  const en = lang === 'en';
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: the codes are on screen and can be selected by hand.
    }
  };

  const download = () => {
    const file = new Blob([`B2G Vendor recovery codes\nEach works once.\n\n${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'b2g-vendor-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={CARD}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{en ? 'Your recovery codes' : 'รหัสกู้คืนของคุณ'}</h2>
          <p className="text-xs text-slate-500">
            {en ? 'Shown only this once. Each code works once.' : 'แสดงเพียงครั้งเดียว ใช้ได้รหัสละหนึ่งครั้ง'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {en
            ? 'If you lose your phone, these are the only way back in without asking an administrator. Keep them somewhere safe and apart from your password.'
            : 'หากทำโทรศัพท์หาย รหัสเหล่านี้คือทางเดียวที่จะเข้าสู่ระบบได้โดยไม่ต้องขอให้ผู้ดูแลระบบช่วย เก็บไว้ในที่ปลอดภัยและแยกจากรหัสผ่าน'}
        </p>
      </div>

      <ul data-testid="recovery-codes" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {codes.map(code => (
          <li key={code} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center font-mono text-sm tracking-wider text-slate-900 select-all">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
        >
          <ClipboardCopy className="h-4 w-4" />
          {copied ? (en ? 'Copied' : 'คัดลอกแล้ว') : en ? 'Copy' : 'คัดลอก'}
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
        >
          <Download className="h-4 w-4" />
          {en ? 'Download as a file' : 'ดาวน์โหลดเป็นไฟล์'}
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
        <span>{en ? 'I have saved these codes somewhere safe.' : 'ฉันเก็บรหัสเหล่านี้ไว้ในที่ปลอดภัยแล้ว'}</span>
      </label>

      <button type="button" disabled={!saved} onClick={onDone} className={PRIMARY_BUTTON}>
        {en ? 'Done' : 'เสร็จสิ้น'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- turning it on

function EnableFlow({ lang, onEnabled }: { lang: Lang; onEnabled: (codes: string[]) => void | Promise<void> }) {
  const en = lang === 'en';
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<SetupStarted | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.post<SetupStarted>('/account/mfa/setup', { password }));
      setPassword('');
    } catch (err) {
      setError(describeError(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const issued = await api.post<CodesIssued>('/account/mfa/enable', { code: code.trim() });
      await onEnabled(issued.recoveryCodes);
    } catch (err) {
      setError(describeError(err, lang));
      if (err instanceof ApiError && /setup has expired/i.test(err.message)) {
        setSetup(null);
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!setup) {
    return (
      <form onSubmit={start} className={CARD}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">{en ? 'Set up two-step sign-in' : 'ตั้งค่าการยืนยันตัวตนสองขั้นตอน'}</h2>
            <p className="text-xs text-slate-500">
              {en ? 'Step 1 of 3 · Confirm it is you' : 'ขั้นที่ 1 จาก 3 · ยืนยันว่าเป็นคุณ'}
            </p>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>{en ? 'Install an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or Authy).' : 'ติดตั้งแอปยืนยันตัวตนบนโทรศัพท์ (เช่น Google Authenticator, Microsoft Authenticator หรือ Authy)'}</li>
          <li>{en ? 'Scan the QR code we show you.' : 'สแกน QR code ที่เราแสดงให้'}</li>
          <li>{en ? 'Enter the 6-digit code it shows, and keep the recovery codes we give you.' : 'กรอกรหัส 6 หลักที่แอปแสดง และเก็บรหัสกู้คืนที่เราให้ไว้'}</li>
        </ol>
        <ErrorBox message={error} />
        <Field
          id="mfa-password"
          type="password"
          label={en ? 'Your password' : 'รหัสผ่านของคุณ'}
          hint={en ? 'We ask again before changing how you sign in.' : 'เราขอรหัสผ่านอีกครั้งก่อนเปลี่ยนวิธีเข้าสู่ระบบ'}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {en ? 'Continue' : 'ดำเนินการต่อ'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className={CARD}>
      <div>
        <h2 className="text-lg font-extrabold text-slate-900">{en ? 'Scan, then confirm' : 'สแกนและยืนยัน'}</h2>
        <p className="text-xs text-slate-500">
          {en ? `Step 2 of 3 · This setup stays open for ${Math.round(setup.expiresInSeconds / 60)} minutes` : `ขั้นที่ 2 จาก 3 · การตั้งค่านี้เปิดอยู่ ${Math.round(setup.expiresInSeconds / 60)} นาที`}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-4">
        <QrCode value={setup.otpauthUri} label={en ? 'QR code for your authenticator app' : 'QR code สำหรับแอปยืนยันตัวตน'} />
        <button type="button" onClick={() => setShowKey(show => !show)} aria-expanded={showKey} className="cursor-pointer text-xs font-bold text-emerald-700 hover:underline">
          {showKey ? (en ? 'Hide the key' : 'ซ่อนรหัสลับ') : en ? 'Cannot scan? Enter the key by hand' : 'สแกนไม่ได้? กรอกรหัสลับเอง'}
        </button>
        {showKey && (
          <div className="w-full space-y-1 text-center">
            <p className="font-mono text-base font-bold tracking-widest break-all text-slate-900 select-all" data-testid="mfa-secret">
              {groupsOfFour(setup.secret)}
            </p>
            <p className="text-xs text-slate-500">
              {en ? 'Choose “time-based” when the app asks. Anyone who has this key can make your codes: do not share it.' : 'เลือกแบบ “ตามเวลา” เมื่อแอปถาม ใครมีรหัสลับนี้ก็สร้างรหัสของคุณได้ อย่าแบ่งปัน'}
            </p>
          </div>
        )}
      </div>

      <ErrorBox message={error} />
      <Field
        id="mfa-code"
        label={en ? '6-digit code from the app' : 'รหัส 6 หลักจากแอป'}
        value={code}
        onChange={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
        autoComplete="one-time-code"
        inputMode="numeric"
        mono
        maxLength={6}
        autoFocus
      />
      <button type="submit" disabled={busy || code.length !== 6} className={PRIMARY_BUTTON}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {en ? 'Turn on two-step sign-in' : 'เปิดใช้การยืนยันตัวตนสองขั้นตอน'}
      </button>
      <button
        type="button"
        onClick={() => {
          setSetup(null);
          setCode('');
          setError(null);
        }}
        className="w-full cursor-pointer text-center text-xs font-bold text-slate-500 hover:text-slate-700"
      >
        {en ? 'Start again' : 'เริ่มใหม่'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- already on

function EnabledPanel({
  lang,
  status,
  onNewCodes,
  onDisabled
}: {
  lang: Lang;
  status: MfaStatus;
  onNewCodes: (codes: string[]) => void;
  onDisabled: () => void | Promise<void>;
}) {
  const en = lang === 'en';
  const [regenPassword, setRegenPassword] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [offPassword, setOffPassword] = useState('');
  const [offCode, setOffCode] = useState('');
  const [offBusy, setOffBusy] = useState(false);
  const [offError, setOffError] = useState<string | null>(null);

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);
    setRegenBusy(true);
    try {
      const issued = await api.post<CodesIssued>('/account/mfa/recovery-codes', { password: regenPassword, code: regenCode.trim() });
      setRegenPassword('');
      setRegenCode('');
      onNewCodes(issued.recoveryCodes);
    } catch (err) {
      setRegenError(describeError(err, lang));
    } finally {
      setRegenBusy(false);
    }
  };

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setOffError(null);
    setOffBusy(true);
    try {
      await api.post('/account/mfa/disable', { password: offPassword, code: offCode.trim() });
      setOffPassword('');
      setOffCode('');
      await onDisabled();
    } catch (err) {
      setOffError(describeError(err, lang));
    } finally {
      setOffBusy(false);
    }
  };

  const low = status.recoveryCodesRemaining <= 3;

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900" data-testid="mfa-on">
              {en ? 'Two-step sign-in is on' : 'เปิดใช้การยืนยันตัวตนสองขั้นตอนอยู่'}
            </h2>
            <p className="text-xs text-slate-500">
              {status.enabledAt ? (en ? `Since ${formatDateTime(status.enabledAt, lang)}` : `ตั้งแต่ ${formatDateTime(status.enabledAt, lang)}`) : null}
            </p>
          </div>
        </div>
        <p className={`rounded-2xl border px-4 py-3 text-sm ${low ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {en
            ? `Recovery codes left: ${status.recoveryCodesRemaining} of 10.`
            : `รหัสกู้คืนที่เหลือ: ${status.recoveryCodesRemaining} จาก 10`}
          {low ? (en ? ' Make new ones below before they run out.' : ' สร้างชุดใหม่ด้านล่างก่อนที่จะหมด') : ''}
        </p>
      </div>

      <form onSubmit={regenerate} className={CARD}>
        <h3 className="text-base font-bold text-slate-900">{en ? 'Make new recovery codes' : 'สร้างรหัสกู้คืนชุดใหม่'}</h3>
        <p className="text-sm text-slate-500">
          {en ? 'The old codes stop working at once. You need your password and a current code.' : 'รหัสชุดเก่าจะใช้ไม่ได้ทันที ต้องใช้รหัสผ่านและรหัสปัจจุบัน'}
        </p>
        <ErrorBox message={regenError} />
        <Field id="regen-password" type="password" label={en ? 'Your password' : 'รหัสผ่านของคุณ'} value={regenPassword} onChange={setRegenPassword} autoComplete="current-password" />
        <Field
          id="regen-code"
          label={en ? 'Code from the app (or a recovery code)' : 'รหัสจากแอป (หรือรหัสกู้คืน)'}
          value={regenCode}
          onChange={setRegenCode}
          autoComplete="one-time-code"
          mono
          maxLength={40}
        />
        <button type="submit" disabled={regenBusy} className={PRIMARY_BUTTON}>
          {regenBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {en ? 'Make new codes' : 'สร้างรหัสชุดใหม่'}
        </button>
      </form>

      {status.required ? (
        <div className={CARD}>
          <h3 className="text-base font-bold text-slate-900">{en ? 'Turning it off' : 'การปิดใช้งาน'}</h3>
          <p className="text-sm text-slate-500">
            {en
              ? 'Two-step sign-in is required for your role, so it cannot be turned off. If you lose your authenticator and your recovery codes, a Super Admin can reset it after checking who you are.'
              : 'บทบาทของคุณต้องใช้การยืนยันตัวตนสองขั้นตอน จึงปิดไม่ได้ หากทำแอปและรหัสกู้คืนหายทั้งหมด ผู้ดูแลระบบสูงสุดรีเซ็ตให้ได้หลังตรวจสอบตัวตนของคุณ'}
          </p>
        </div>
      ) : (
        <form onSubmit={turnOff} className={`${CARD} border-rose-200`}>
          <h3 className="text-base font-bold text-rose-800">{en ? 'Turn off two-step sign-in' : 'ปิดการยืนยันตัวตนสองขั้นตอน'}</h3>
          <p className="text-sm text-slate-500">
            {en ? 'Your account will be protected by your password alone, and your other devices will be signed out.' : 'บัญชีจะป้องกันด้วยรหัสผ่านเพียงอย่างเดียว และอุปกรณ์อื่นจะถูกออกจากระบบ'}
          </p>
          <ErrorBox message={offError} />
          <Field id="off-password" type="password" label={en ? 'Your password' : 'รหัสผ่านของคุณ'} value={offPassword} onChange={setOffPassword} autoComplete="current-password" />
          <Field
            id="off-code"
            label={en ? 'Code from the app (or a recovery code)' : 'รหัสจากแอป (หรือรหัสกู้คืน)'}
            value={offCode}
            onChange={setOffCode}
            autoComplete="one-time-code"
            mono
            maxLength={40}
          />
          <button
            type="submit"
            disabled={offBusy}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {offBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {en ? 'Turn off' : 'ปิดใช้งาน'}
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function AccountSecurityPage() {
  const router = useRouter();
  const { lang, authChecked, role, signIn } = useApp();
  const en = lang === 'en';
  const isLoggedIn = role !== 'visitor';
  const isStaff = role === 'admin' || role === 'superadmin';

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (authChecked && !isLoggedIn) {
      router.replace('/login?next=%2Faccount%2Fsecurity');
    }
  }, [authChecked, isLoggedIn, router]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get<MfaStatus>('/account/mfa'));
      setLoadError(null);
    } catch (err) {
      setLoadError(describeError(err, lang));
    }
  }, [lang]);

  useEffect(() => {
    if (!authChecked || !isLoggedIn) return;
    let cancelled = false;
    api
      .get<MfaStatus>('/account/mfa')
      .then(loaded => {
        if (cancelled) return;
        setStatus(loaded);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(describeError(err, lang));
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, isLoggedIn, lang]);

  // The account the rest of the app holds says whether the admin area is open to it
  // (mfaSetupRequired), so it is re-read whenever the second factor changes.
  const refreshAccount = useCallback(async () => {
    try {
      signIn(await api.get<AccountView>('/account/profile'));
    } catch {
      // Best effort: the next page load reads it again.
    }
  }, [signIn]);

  const handleEnabled = async (issued: string[]) => {
    setCodes(issued);
    await Promise.all([refreshAccount(), loadStatus()]);
  };

  const handleCodesDone = () => {
    setCodes(null);
    // A staff account that was sent here to set this up goes on to where it was heading.
    if (isStaff) {
      const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
      if (next) router.push(next);
    }
  };

  if (!authChecked || !isLoggedIn) {
    return (
      <PublicShell>
        <div className="py-16 text-center text-sm text-slate-500">{en ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}</div>
      </PublicShell>
    );
  }

  const mustSetUp = !!status && status.setupRequired;
  const recoveryUsed = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('recovery') === '1';

  return (
    <PublicShell>
      <div className="mx-auto max-w-2xl space-y-6 py-8 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/account" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-emerald-600">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{en ? 'Back to Account' : 'กลับสู่หน้าบัญชี'}</span>
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            {en ? 'Account security' : 'ความปลอดภัยบัญชี'}
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-slate-900">{en ? 'Two-step sign-in' : 'การยืนยันตัวตนสองขั้นตอน'}</h1>

        {mustSetUp && codes === null && (
          <div role="status" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {en
                ? 'Your role must use two-step sign-in. The admin area opens as soon as you have set it up.'
                : 'บทบาทของคุณต้องใช้การยืนยันตัวตนสองขั้นตอน ส่วนผู้ดูแลระบบจะเปิดให้ทันทีเมื่อคุณตั้งค่าเสร็จ'}
            </p>
          </div>
        )}

        {recoveryUsed && codes === null && (
          <div role="status" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {en
                ? 'You signed in with a recovery code, which is now used up. If you have a new phone, set up the app again; and make new recovery codes before they run out.'
                : 'คุณเข้าสู่ระบบด้วยรหัสกู้คืน ซึ่งใช้ไปแล้ว หากเปลี่ยนโทรศัพท์ ให้ตั้งค่าแอปใหม่ และสร้างรหัสกู้คืนชุดใหม่ก่อนที่จะหมด'}
            </p>
          </div>
        )}

        {loadError && <ErrorBox message={loadError} />}

        {!status && !loadError && (
          <div className="py-10 text-center text-sm text-slate-500">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            {en ? 'Loading…' : 'กำลังโหลด…'}
          </div>
        )}

        {status && codes !== null && <RecoveryCodesPanel codes={codes} lang={lang} onDone={handleCodesDone} />}

        {status && codes === null && !status.available && (
          <div className={CARD}>
            <p className="text-sm text-slate-600">
              {en ? 'Two-step sign-in is not available on this server yet. An administrator needs to configure it.' : 'เซิร์ฟเวอร์นี้ยังไม่เปิดให้ใช้การยืนยันตัวตนสองขั้นตอน ผู้ดูแลระบบต้องตั้งค่าก่อน'}
            </p>
          </div>
        )}

        {status && codes === null && status.available && !status.enabled && <EnableFlow lang={lang} onEnabled={handleEnabled} />}

        {status && codes === null && status.available && status.enabled && (
          <EnabledPanel
            lang={lang}
            status={status}
            onNewCodes={issued => {
              setCodes(issued);
              void loadStatus();
            }}
            onDisabled={async () => {
              await Promise.all([refreshAccount(), loadStatus()]);
            }}
          />
        )}
      </div>
    </PublicShell>
  );
}
