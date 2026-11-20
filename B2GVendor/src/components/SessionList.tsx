'use client';

import React, { useEffect, useState } from 'react';
import type { AppLang } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { localizeAuthError } from '@/lib/authMessages';
import { BackendSessionView, fetchMySessions, revokeMyOtherSessions, revokeMySession } from '@/lib/backend';
import { Loader2, LogOut, Monitor } from 'lucide-react';

// Every device signed in to this account, with a way to sign each one out
// (ASVS V7.5.2). Ending a session asks for the password again, so someone who
// only holds a stolen session cannot throw the owner out. The list lives inside
// the profile <form>, so it uses plain buttons (type="button") and no <form>.

type Pending = { kind: 'one'; id: string; label: string } | { kind: 'others' } | null;

export function SessionList({ lang }: { lang: AppLang }) {
  const t = (th: string, en: string) => (lang === 'en' ? en : th);
  const [sessions, setSessions] = useState<BackendSessionView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchMySessions()
      .then(setSessions)
      .catch(() => setLoadError(true));
  }, []);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' });

  const ask = (next: Pending) => {
    setPending(next);
    setPassword('');
    setError(null);
    setNotice(null);
  };

  const confirm = async () => {
    if (!pending || !password) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'one') {
        await revokeMySession(pending.id, password);
        setNotice(t(`ออกจากระบบ ${pending.label} แล้ว`, `Signed out ${pending.label}.`));
      } else {
        const { revoked } = await revokeMyOtherSessions(password);
        setNotice(t(`ออกจากระบบอุปกรณ์อื่น ${revoked} เครื่องแล้ว`, `Signed out ${revoked} other device(s).`));
      }
      setPending(null);
      setPassword('');
      setSessions(await fetchMySessions());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        // Only the password is asked here: the sign-in wording ("email or password") would mislead.
        setError(t('รหัสผ่านไม่ถูกต้อง', 'That password is not correct.'));
      } else {
        setError(err instanceof ApiError ? localizeAuthError(err.message, lang) : t('เกิดข้อผิดพลาด กรุณาลองใหม่', 'Something went wrong. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const others = sessions?.filter(s => !s.isCurrent).length ?? 0;

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('อุปกรณ์ที่เข้าสู่ระบบอยู่', 'Signed-in devices')}</h4>

      {sessions === null && !loadError && (
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('กำลังโหลด...', 'Loading...')}
        </p>
      )}
      {loadError && <p className="text-xs text-slate-400">{t('ไม่สามารถโหลดรายการอุปกรณ์ได้', 'Could not load your devices.')}</p>}

      {sessions && (
        <ul className="space-y-2">
          {sessions.map(session => {
            const label = `${session.os} ${session.browser}`;
            return (
              <li key={session.id} className="text-xs bg-slate-50 p-3 rounded-xl flex items-start gap-2">
                <Monitor className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="font-bold text-slate-900 truncate">
                    {label}
                    {session.isCurrent && <span className="ml-1 font-semibold text-emerald-700">• {t('อุปกรณ์นี้', 'This device')}</span>}
                  </p>
                  <p className="text-slate-400">
                    IP {session.ipAddress ?? t('ไม่ทราบ', 'unknown')} • {t('ใช้งานล่าสุด', 'Last active')} {when(session.lastActiveAt)}
                  </p>
                </div>
                {!session.isCurrent && (
                  <button
                    type="button"
                    onClick={() => ask({ kind: 'one', id: session.id, label })}
                    disabled={busy}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-3 h-3" />
                    {t('ออกจากระบบ', 'Sign out')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {others > 0 && !pending && (
        <button
          type="button"
          onClick={() => ask({ kind: 'others' })}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:border-rose-300 hover:text-rose-700 cursor-pointer"
        >
          {t('ออกจากระบบอุปกรณ์อื่นทั้งหมด', 'Sign out all other devices')}
        </button>
      )}

      {pending && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label htmlFor="session-confirm-password" className="block text-xs text-amber-900">
            {pending.kind === 'one'
              ? t(`ยืนยันด้วยรหัสผ่านเพื่อออกจากระบบ ${pending.label}`, `Enter your password to sign out ${pending.label}.`)
              : t('ยืนยันด้วยรหัสผ่านเพื่อออกจากระบบอุปกรณ์อื่นทั้งหมด', 'Enter your password to sign out all other devices.')}
          </label>
          <input
            id="session-confirm-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault(); // inside the profile form: do not submit it
                void confirm();
              }
            }}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-500"
          />
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !password}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('ยืนยัน', 'Confirm')}
            </button>
            <button
              type="button"
              onClick={() => ask(null)}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 cursor-pointer"
            >
              {t('ยกเลิก', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {notice && <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">{notice}</p>}
    </div>
  );
}
