'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export default function WorkTagCurationLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, account, authChecked, lang } = useApp();
  const canCurateWorkTags = role === 'superadmin' || (role === 'admin' && (
    account?.permissions?.includes('tag:manage') === true ||
    account?.permissions?.includes('poll&tag:manage') === true
  ));

  useEffect(() => {
    if (authChecked && !canCurateWorkTags) {
      router.replace('/admin');
    }
  }, [authChecked, canCurateWorkTags, router]);

  if (!authChecked || !canCurateWorkTags) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-500 text-sm">
        {lang === 'en' ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}
      </div>
    );
  }

  return children;
}