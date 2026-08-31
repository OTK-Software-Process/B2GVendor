'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { Lock, CheckCircle2, Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { lang } = useApp();
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const token = decodeURIComponent(params?.token ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldError(null);

    if (!token) {
      setFormError(lang === 'en' ? 'Reset token is missing or invalid.' : 'Token สำหรับรีเซ็ตรหัสผ่านไม่ถูกต้อง');
      return;
    }

    if (newPassword.length < 8) {
      setFieldError(lang === 'en' ? 'Password must be at least 8 characters.' : 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError(lang === 'en' ? 'Passwords do not match.' : 'รหัสผ่านไม่ตรงกัน');
      return;
    }

    setSubmitting(true);

    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword,
        confirmNewPassword: confirmPassword,
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldError(error.fields?.newPassword ?? error.fields?.confirmNewPassword ?? error.message);
        setFormError(error.message);
      } else {
        setFormError(lang === 'en' ? 'Something went wrong. Please try again.' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Reset Password' : 'ตั้งรหัสผ่านใหม่'}
            </h1>
            <p className="text-xs text-slate-500">
              {lang === 'en' ? 'Create a new strong password for your account.' : 'กรุณากำหนดรหัสผ่านใหม่ให้ปลอดภัย'}
            </p>
          </div>

          {formError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {formError}
            </div>
          )}

          {!done ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'en' ? 'New Password' : 'รหัสผ่านใหม่'}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'en' ? 'Confirm New Password' : 'ยืนยันรหัสผ่านใหม่'}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>
                {fieldError && <p className="mt-1 text-xs text-rose-600">{fieldError}</p>}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {lang === 'en' ? 'Updating...' : 'กำลังบันทึก...'}
                  </>
                ) : (
                  lang === 'en' ? 'Update Password' : 'บันทึกรหัสผ่านใหม่'
                )}
              </button>
            </form>
          ) : (
            <div className="text-center py-4 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-slate-900">
                {lang === 'en' ? 'Password updated! Redirecting to login...' : 'เปลี่ยนรหัสผ่านสำเร็จ! กำลังพาท่านไปยังหน้าเข้าสู่ระบบ...'}
              </p>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
