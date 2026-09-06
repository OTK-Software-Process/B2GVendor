'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useApp } from '@/context/AppContext';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, authChecked, lang } = useApp();
  const isAdminRole = role === 'admin' || role === 'superadmin';

  useEffect(() => {
    if (authChecked && !isAdminRole) {
      router.replace('/');
    }
  }, [authChecked, isAdminRole, router]);

  if (!authChecked || !isAdminRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-500 text-sm">
        {lang === 'en' ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-white text-slate-900">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8 max-w-7xl animate-fade-in">
        {children}
      </main>
    </div>
  );
}
