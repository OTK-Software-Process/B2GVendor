'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';

type Translate = (th: string, en: string) => string;

/**
 * Confirmation dialog for risky admin actions (suspend, delete, ...).
 * `requireText` makes the admin type an exact value (e.g. the account's email)
 * before the confirm button unlocks -- for irreversible actions.
 */
export function ConfirmModal({
  tone,
  title,
  children,
  confirmLabel,
  requireText,
  onConfirm,
  onClose
}: {
  tone: 'amber' | 'rose';
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** When set, the admin must type this exact text (case-insensitive) to enable the button. */
  requireText?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const armed = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md space-y-4 animate-scale-in">
        <h2 id="confirm-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
          <AlertTriangle className={`w-5 h-5 ${tone === 'rose' ? 'text-rose-600' : 'text-amber-600'}`} />
          {title}
        </h2>
        <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
        {requireText && (
          <div>
            <label htmlFor="confirm-typed" className="text-xs font-bold text-slate-500">
              {t(`พิมพ์ ${requireText} เพื่อยืนยัน`, `Type ${requireText} to confirm`)}
            </label>
            <input
              id="confirm-typed"
              type="text"
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-900 outline-hidden focus:border-rose-400"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 cursor-pointer">
            {t('ยกเลิก', 'Cancel')}
          </button>
          <button
            onClick={() => void go()}
            disabled={busy || !armed}
            className={`px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer ${
              tone === 'rose' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
