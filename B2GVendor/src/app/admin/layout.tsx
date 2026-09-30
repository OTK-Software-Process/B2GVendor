'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useApp } from '@/context/AppContext';
import { canAccessAdminPath, isAdminRole } from '@/lib/adminAccess';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { role, authChecked, lang } = useApp();
  const isVisitor = role === 'visitor';

  // Nobody signed in (or the session expired): send them to login and bring
  // them back to this page afterwards.
  useEffect(() => {
    if (authChecked && isVisitor) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [authChecked, isVisitor, pathname, router]);

  if (!authChecked || isVisitor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-500 text-sm">
        {lang === 'en' ? 'Checking access…' : 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…'}
      </div>
    );
  }

  // Signed in, but not allowed here: a vendor account, or an Admin opening a
  // Super-Admin-only page.
  if (!canAccessAdminPath(role, pathname)) {
    const needsSuperAdmin = isAdminRole(role);
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="max-w-md w-full text-center space-y-4 border border-slate-200 rounded-3xl p-10">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
            <Lock className="w-5 h-5 text-amber-600" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">
            {lang === 'en' ? 'Access denied' : 'ไม่มีสิทธิ์เข้าถึง'}
          </h1>
          <p className="text-sm text-slate-500">
            {needsSuperAdmin
              ? lang === 'en'
                ? 'This page is restricted to Super Admins.'
                : 'หน้านี้สงวนไว้สำหรับผู้ดูแลระบบสูงสุดเท่านั้น'
              : lang === 'en'
                ? 'Your account does not have admin access.'
                : 'บัญชีของคุณไม่มีสิทธิ์เข้าใช้งานส่วนผู้ดูแลระบบ'}
          </p>
          <Link
            href={needsSuperAdmin ? '/admin' : '/'}
            className="inline-block px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold"
          >
            {needsSuperAdmin
              ? lang === 'en' ? 'Back to dashboard' : 'กลับสู่แดชบอร์ด'
              : lang === 'en' ? 'Back to home' : 'กลับสู่หน้าหลัก'}
          </Link>
        </div>
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
