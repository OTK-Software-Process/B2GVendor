'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { Mail, CheckCircle2, ArrowLeft, ShieldCheck, Loader2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const { lang } = useApp();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldError(null);
    setSubmitting(true);

    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldError(error.fields?.email ?? error.message);
        setFormError(error.message);
      } else {
        setFormError(
          lang === 'en'
            ? 'Something went wrong. Please try again.'
            : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl py-8 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] sm:p-8">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-emerald-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{lang === 'en' ? 'Back to Login' : 'กลับสู่หน้าเข้าสู่ระบบ'}</span>
            </Link>

            {!submitted ? (
              <div className="mt-6 space-y-6">
                <div className="space-y-2">
                  <div className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                    {lang === 'en' ? 'Account Recovery' : 'กู้คืนบัญชี'}
                  </div>
                  <h1 className="text-2xl font-extrabold text-slate-900">
                    {lang === 'en' ? 'Forgot Password' : 'ลืมรหัสผ่าน'}
                  </h1>
                  <p className="text-sm text-slate-500">
                    {lang === 'en'
                      ? 'Enter your registered email address and we’ll send a secure reset link.'
                      : 'กรอกอีเมลที่ลงทะเบียนไว้ เพื่อรับลิงก์สำหรับตั้งรหัสผ่านใหม่'}
                  </p>
                </div>

                {formError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {formError}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="mb-1.5 block text-xs font-bold text-slate-700">
                      {lang === 'en' ? 'Email Address' : 'อีเมลผู้ใช้งาน'}
                    </label>
                    <div className="relative flex items-center">
                      <Mail className="absolute left-3 h-4 w-4 text-slate-400" />
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))}
                        placeholder="user@example.co.th"
                        required
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    {fieldError && <p className="mt-1.5 text-xs text-rose-600">{fieldError}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {lang === 'en' ? 'Sending…' : 'กำลังส่ง…'}
                      </>
                    ) : (
                      <>
                        {lang === 'en' ? 'Send Reset Link' : 'ส่งลิงก์กู้คืนรหัสผ่าน'}
                      </>
                    )}
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-8 space-y-5 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-extrabold text-slate-900">
                    {lang === 'en' ? 'Reset Email Sent!' : 'ส่งอีเมลรีเซ็ตรหัสผ่านเรียบร้อยแล้ว'}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {lang === 'en'
                      ? 'Please check your inbox for the password reset instructions.'
                      : 'กรุณาตรวจสอบกล่องจดหมายของท่านเพื่อรับคำแนะนำในการตั้งรหัสผ่านใหม่'}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  {lang === 'en'
                    ? 'If the email is registered, you will receive a secure reset link shortly.'
                    : 'หากอีเมลนี้เป็นสมาชิกที่ลงทะเบียนแล้ว ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้ภายในเวลาอันสั้น'}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <Link
                    href="/login"
                    className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                  >
                    {lang === 'en' ? 'Return to Login' : 'กลับสู่หน้าเข้าสู่ระบบ'}
                  </Link>
                </div>
              </div>
            )}
          </div>

          <aside className="hidden rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-8 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex rounded-2xl bg-white p-3 shadow-sm">
                <ShieldCheck className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                  {lang === 'en' ? 'Secure Access' : 'ความปลอดภัย'}
                </p>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900">
                  {lang === 'en' ? 'Quick protection for your account' : 'ปกป้องบัญชีของคุณให้รวดเร็ว'}
                </h3>
              </div>
            </div>

            <div className="space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl border border-white/80 bg-white/70 p-4">
                {lang === 'en'
                  ? 'Use a fresh reset link and choose a strong password you haven’t used before.'
                  : 'ใช้ลิงก์รีเซ็ตรหัสผ่านใหม่ และตั้งรหัสผ่านที่คาดเดายาก และไม่เคยใช้มาก่อน'}
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/70 p-4">
                {lang === 'en'
                  ? 'Need help? Return to login and contact support if the email did not arrive.'
                  : 'ต้องการความช่วยเหลือ? กลับไปหน้าเข้าสู่ระบบและติดต่อฝ่ายสนับสนุนหากยังไม่ได้รับอีเมล'}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}
