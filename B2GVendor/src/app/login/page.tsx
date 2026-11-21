'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp, AccountView } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/adminAccess';
import { localizeAuthError } from '@/lib/authMessages';
import { Lock, Mail, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';

// What POST /auth/login answers: the account, or -- for an account with two-step
// sign-in -- a challenge, with the second step still owed (POST /auth/mfa/verify).
type LoginAnswer = AccountView | { mfaRequired: true };
type VerifiedAccount = AccountView & { mfa?: { method: 'totp' | 'recovery_code'; recoveryCodesRemaining?: number } };

export default function LoginPage() {
  const router = useRouter();
  const { lang, signIn } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // The second step: the password was right and the account has two-step sign-in.
  const [secondStep, setSecondStep] = useState(false);
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  // Where to go once signed in. A staff account that has not set up two-step
  // sign-in is sent to do that first (the server refuses it everywhere else).
  const finishSignIn = (account: AccountView, recoveryUsed = false) => {
    signIn(account);
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    if (account.mfaSetupRequired) {
      router.push(`/account/security${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    } else if (recoveryUsed) {
      router.push('/account/security?recovery=1');
    } else {
      // Returning from a guarded page (e.g. /admin) sends the user back there.
      router.push(next ?? '/account');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const answer = await api.post<LoginAnswer>('/auth/login', { email, password });
      if ('mfaRequired' in answer) {
        // The password is no longer needed in the page; the challenge cookie holds the rest.
        setPassword('');
        setSecondStep(true);
        return;
      }
      finishSignIn(answer);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.code === 'EMAIL_NOT_VERIFIED'
          ? lang === 'en'
            ? 'Please verify your email address using the link we sent before signing in.'
            : 'กรุณายืนยันอีเมลจากลิงก์ที่เราส่งให้ก่อนเข้าสู่ระบบ'
          : localizeAuthError(err.message, lang));
        setFieldErrors(err.fields ?? {});
      } else {
        setFormError(lang === 'en' ? 'Something went wrong. Please try again.' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const account = await api.post<VerifiedAccount>('/auth/mfa/verify', { code: code.trim() });
      finishSignIn(account, account.mfa?.method === 'recovery_code');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.code === 'NOT_AUTHENTICATED') {
        // The 5 minutes ran out (or the challenge was used): start again from the password.
        setSecondStep(false);
        setCode('');
        setFormError(lang === 'en' ? 'That sign-in timed out. Please enter your password again.' : 'หมดเวลาการเข้าสู่ระบบ กรุณากรอกรหัสผ่านอีกครั้ง');
      } else if (err instanceof ApiError) {
        setFormError(localizeAuthError(err.message, lang));
        setCode('');
      } else {
        setFormError(lang === 'en' ? 'Something went wrong. Please try again.' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (secondStep) {
    return (
      <PublicShell>
        <div className="max-w-md mx-auto py-8 space-y-6">
          <form onSubmit={handleVerify} className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900">
                {lang === 'en' ? 'Two-step verification' : 'ยืนยันตัวตนสองขั้นตอน'}
              </h1>
              <p className="text-xs text-slate-500">
                {useRecoveryCode
                  ? lang === 'en' ? 'Enter one of your recovery codes. Each works once.' : 'กรอกรหัสกู้คืนหนึ่งรหัส ใช้ได้รหัสละหนึ่งครั้ง'
                  : lang === 'en' ? 'Enter the 6-digit code from your authenticator app.' : 'กรอกรหัส 6 หลักจากแอปยืนยันตัวตนของคุณ'}
              </p>
            </div>

            {formError && (
              <div role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                {formError}
              </div>
            )}

            <div>
              <label htmlFor="mfa-code" className="block text-xs font-bold text-slate-700 mb-1">
                {useRecoveryCode
                  ? lang === 'en' ? 'Recovery code' : 'รหัสกู้คืน'
                  : lang === 'en' ? 'Authenticator code' : 'รหัสจากแอปยืนยันตัวตน'}
              </label>
              <input
                id="mfa-code"
                name="mfa-code"
                type="text"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                spellCheck={false}
                maxLength={useRecoveryCode ? 40 : 6}
                value={code}
                onChange={(e) => setCode(useRecoveryCode ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-center font-mono text-lg tracking-widest text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting || (!useRecoveryCode && code.length !== 6)}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <span>
                {submitting
                  ? (lang === 'en' ? 'Checking…' : 'กำลังตรวจสอบ…')
                  : (lang === 'en' ? 'Verify and sign in' : 'ยืนยันและเข้าสู่ระบบ')}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={() => { setUseRecoveryCode((on) => !on); setCode(''); setFormError(null); }}
                className="font-bold text-emerald-600 hover:underline cursor-pointer"
              >
                {useRecoveryCode
                  ? (lang === 'en' ? 'Use the authenticator app instead' : 'ใช้แอปยืนยันตัวตนแทน')
                  : (lang === 'en' ? 'Use a recovery code' : 'ใช้รหัสกู้คืน')}
              </button>
              <button
                type="button"
                onClick={() => { setSecondStep(false); setCode(''); setFormError(null); setUseRecoveryCode(false); }}
                className="text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                {lang === 'en' ? 'Start again' : 'เริ่มใหม่'}
              </button>
            </div>
          </form>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden">
              <Image
                src="/Logo.png"
                alt="B2G Vendor logo"
                width={56}
                height={56}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Unified Portal Login' : 'เข้าสู่ระบบ B2G Vendor'}
            </h1>
            <p className="text-xs text-slate-500">
              {lang === 'en' ? 'Single login for personal & registered vendors (Legacy routes 302 redirected)' : 'ระบบเข้าสู่ระบบแบบรวมศูนย์แห่งเดียว (ยกเลิกระบบแยกประเภทเดิม)'}
            </p>
          </div>

          {formError && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-bold text-slate-700 mb-1">
                {lang === 'en' ? 'Email Address' : 'อีเมลผู้ใช้งาน'}
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
              {fieldErrors.email && <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>}
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="password" className="block text-xs font-bold text-slate-700">
                  {lang === 'en' ? 'Password' : 'รหัสผ่าน'}
                </label>
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((show) => !show)}
                  aria-label={lang === 'en'
                    ? showPassword ? 'Hide password' : 'Show password'
                    : showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <Link href="/forgot-password" className="text-xs text-emerald-600 hover:underline">
                  {lang === 'en' ? 'Forgot Password?' : 'ลืมรหัสผ่าน?'}
                </Link>
              </div>
              {fieldErrors.password && <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <span>
                {submitting
                  ? (lang === 'en' ? 'Signing in…' : 'กำลังเข้าสู่ระบบ…')
                  : (lang === 'en' ? 'Sign In' : 'เข้าสู่ระบบ')}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="text-center pt-4 border-t border-slate-100 text-xs text-slate-500">
            <span>{lang === 'en' ? "Don't have an account?" : 'ยังไม่มีบัญชีผู้ใช้งาน?'} </span>
            <Link href="/register" className="font-bold text-emerald-600 hover:underline">
              {lang === 'en' ? 'Register Now' : 'ลงทะเบียนบัญชีใหม่'}
            </Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
