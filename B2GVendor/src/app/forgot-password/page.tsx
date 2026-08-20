'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { Mail, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const { lang } = useApp();
  const [submitted, setSubmitted] = useState(false);

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-600">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Back to Login' : 'กลับสู่หน้าเข้าสู่ระบบ'}</span>
          </Link>

          {!submitted ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900">
                  {lang === 'en' ? 'Forgot Password' : 'ลืมรหัสผ่าน'}
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  {lang === 'en' ? 'Enter your registered email address to receive password reset instructions.' : 'กรอกอีเมลที่ลงทะเบียนไว้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของท่าน'}
                </p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Email Address' : 'อีเมลผู้ใช้งาน'}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="user@example.co.th"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
                >
                  {lang === 'en' ? 'Send Reset Link' : 'ส่งลิงก์กู้คืนรหัสผ่าน'}
                </button>
              </form>
            </div>
          ) : (
            <div className="text-center py-4 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'en' ? 'Reset Email Sent!' : 'ส่งอีเมลรีเซ็ตรหัสผ่านเรียบร้อยแล้ว'}
              </h2>
              <p className="text-xs text-slate-500">
                {lang === 'en' ? 'Please check your inbox. Click the token link inside to set a new password.' : 'กรุณาตรวจสอบกล่องข้อความในอีเมลของท่าน และกดลิงก์เพื่อกำหนดรหัสผ่านใหม่'}
              </p>
              <div className="pt-2">
                <Link href="/reset-password/demo-token-123" className="text-xs font-bold text-emerald-600 hover:underline">
                  {lang === 'en' ? '[Demo Shortcut: Open Reset Password Page]' : '[ทางลัดสาธิต: เปิดหน้าตั้งรหัสผ่านใหม่]'}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
