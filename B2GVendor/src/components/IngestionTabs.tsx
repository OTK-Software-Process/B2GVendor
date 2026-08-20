'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export function IngestionTabs() {
  const pathname = usePathname();
  const { lang } = useApp();

  const tabs = [
    { href: '/admin/ingestion', label: lang === 'en' ? 'Poll & Schedule' : 'ตั้งเวลา & Poll Now' },
    { href: '/admin/ingestion/runs', label: lang === 'en' ? 'Run History' : 'ประวัติการดึงข้อมูล' }
  ];

  return (
    <div className="flex items-center gap-1 -mb-px">
      {tabs.map(tab => {
        const isRunsTab = tab.href === '/admin/ingestion/runs';
        const active = isRunsTab ? pathname.startsWith('/admin/ingestion/runs') : pathname === '/admin/ingestion';
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors duration-150 ${
              active
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
