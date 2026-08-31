'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { lang, authChecked, role } = useApp();
  const isLoggedIn = role !== 'visitor';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authChecked && !isLoggedIn) {
      router.replace('/login');
    }
  }, [authChecked, isLoggedIn, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await api.post('/account/change-password', {
        currentPassword,
        newPassword,
        confirmNewPassword: confirmPassword,
      });

      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError(lang === 'en' ? 'Unable to update your password.' : 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!authChecked || !isLoggedIn) {
    return (
      <PublicShell>
        <div className="py-16 text-center text-sm text-slate-500">
          {lang === 'en' ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl py-8 sm:py-10">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Link
              href="/account"
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-emerald-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{lang === 'en' ? 'Back to Account' : 'กลับสู่หน้าบัญชี'}</span>
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              {lang === 'en' ? 'Security' : 'ความปลอดภัย'}
            </div>
          </div>

          {!done ? (
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-3xl bg-slate-50 p-6">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                  <KeyRound className="h-7 w-7" />
                </div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  {lang === 'en' ? 'Change Password' : 'เปลี่ยนรหัสผ่าน'}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  {lang === 'en'
                    ? 'Keep your account secure by updating your password on a regular basis.'
                    : 'รักษาความปลอดภัยของบัญชีด้วยการเปลี่ยนรหัสผ่านเป็นประจำ'}
                </p>
                <ul className="mt-5 space-y-3 text-sm text-slate-600">
                  <li className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    {lang === 'en' ? 'Use at least 8 characters.' : 'ใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร'}
                  </li>
                  <li className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    {lang === 'en' ? 'Avoid reusing recent passwords.' : 'หลีกเลี่ยงการใช้รหัสผ่านซ้ำกับที่เคยใช้ก่อน'}
                  </li>
                  <li className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    {lang === 'en' ? 'Keep it unique to this account.' : 'ใช้รหัสผ่านที่ไม่ซ้ำกับบัญชีอื่น'}
                  </li>
                </ul>
              </div>

              <div className="space-y-5">
                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="currentPassword" className="mb-1.5 block text-xs font-bold text-slate-700">
                      {lang === 'en' ? 'Current Password' : 'รหัสผ่านปัจจุบัน'}
                    </label>
                    <input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      required
                    />
                    {fieldErrors.currentPassword && (
                      <p className="mt-1 text-xs text-rose-600">{fieldErrors.currentPassword}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="newPassword" className="mb-1.5 block text-xs font-bold text-slate-700">
                      {lang === 'en' ? 'New Password' : 'รหัสผ่านใหม่'}
                    </label>
                    <input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      required
                    />
                    {fieldErrors.newPassword && (
                      <p className="mt-1 text-xs text-rose-600">{fieldErrors.newPassword}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-bold text-slate-700">
                      {lang === 'en' ? 'Confirm New Password' : 'ยืนยันรหัสผ่านใหม่'}
                    </label>
                    <input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      required
                    />
                    {fieldErrors.confirmNewPassword && (
                      <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirmNewPassword}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {lang === 'en' ? 'Updating…' : 'กำลังบันทึก…'}
                      </>
                    ) : (
                      <>
                        {lang === 'en' ? 'Update Password' : 'บันทึกรหัสผ่าน'}
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="space-y-5 py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900">
                  {lang === 'en' ? 'Password Updated' : 'เปลี่ยนรหัสผ่านสำเร็จ'}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {lang === 'en'
                    ? 'Your password has been changed successfully.'
                    : 'รหัสผ่านของท่านถูกเปลี่ยนเรียบร้อยแล้ว'}
                </p>
              </div>

              <div className="flex justify-center gap-3">
                <Link
                  href="/account"
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                >
                  {lang === 'en' ? 'Back to Account' : 'กลับสู่หน้าบัญชี'}
                </Link>
                <Link
                  href="/login"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                >
                  {lang === 'en' ? 'Login Again' : 'เข้าสู่ระบบอีกครั้ง'}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
