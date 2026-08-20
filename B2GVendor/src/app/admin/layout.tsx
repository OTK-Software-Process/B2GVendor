'use client';

import React from 'react';
import { AdminSidebar } from '@/components/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-white text-slate-900">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8 max-w-7xl animate-fade-in">
        {children}
      </main>
    </div>
  );
}
