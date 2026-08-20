'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';

export default function VerifyEmailPage() {
  const { lang, setRole } = useApp();
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVerified(true);
      setRole('user');
    }, 1500);
    return () => clearTimeout(timer);
  }, [setRole]);

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 text-center space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          {!verified ? (
            <div className="space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto animate-spin">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'en' ? 'Verifying your email token...' : 'กำลังตรวจสอบการยืนยันอีเมล...'}
              </h2>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto" />
              <h1 className="text-2xl font-extrabold text-slate-900">
                {lang === 'en' ? 'Email Verified Successfully!' : 'ยืนยันอีเมลสำเร็จเรียบร้อย!'}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === 'en' ? 'Your account is active. You can now follow tags and manage notifications.' : 'บัญชีผู้ใช้งานของคุณเปิดทำงานแล้ว สามารถติดตามแท็กและตั้งค่าการรับข่าวสารได้ทันที'}
              </p>
              <div className="pt-2">
                <Link
                  href="/account"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
                >
                  <span>{lang === 'en' ? 'Go to Account Dashboard' : 'ไปที่หน้าจัดการบัญชี'}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
