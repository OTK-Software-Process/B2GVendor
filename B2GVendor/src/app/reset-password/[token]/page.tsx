'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { Lock, CheckCircle2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { lang } = useApp();
  const [done, setDone] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDone(true);
    setTimeout(() => router.push('/login'), 2000);
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
              {lang === 'en' ? 'Token verified. Create a new strong password for your account.' : 'ยืนยัน Token สำเร็จ กรุณากำหนดรหัสผ่านใหม่'}
            </p>
          </div>

          {!done ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'en' ? 'New Password' : 'รหัสผ่านใหม่'}
                </label>
                <input
                  type="password"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'en' ? 'Confirm New Password' : 'ยืนยันรหัสผ่านใหม่'}
                </label>
                <input
                  type="password"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
              >
                {lang === 'en' ? 'Update Password' : 'บันทึกรหัสผ่านใหม่'}
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
