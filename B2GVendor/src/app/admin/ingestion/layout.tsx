'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export default function IngestionLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, account, authChecked, lang } = useApp();
  const canManagePoll = role === 'superadmin' || (role === 'admin' && (
    account?.permissions?.includes('poll:manage') === true ||
    account?.permissions?.includes('poll&tag:manage') === true
  ));

  useEffect(() => {
    if (authChecked && !canManagePoll) {
      router.replace('/admin');
    }
  }, [authChecked, canManagePoll, router]);

  if (!authChecked || !canManagePoll) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-500 text-sm">
        {lang === 'en' ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}
      </div>
    );
  }

  return children;
}