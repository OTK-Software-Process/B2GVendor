'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import {
  LayoutDashboard,
  RefreshCw,
  History,
  Sliders,
  Tags,
  Users,
  ShieldCheck,
  Tag,
  ArrowLeft,
  Menu,
  X,
  Lock
} from 'lucide-react';

export function AdminSidebar() {
  const pathname = usePathname();
  const { lang, role, isPolling, triggerPollNow } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isSuperAdmin = role === 'superadmin';

  const navGroups = [
    {
      title: lang === 'en' ? 'Core System' : 'ระบบหลัก',
      items: [
        { href: '/admin', label: lang === 'en' ? 'Dashboard' : 'แดชบอร์ดหลัก', icon: LayoutDashboard },
      ]
    },
    {
      title: lang === 'en' ? 'Ingestion' : 'ระบบดึงข้อมูล',
      items: [
        { href: '/admin/ingestion', label: lang === 'en' ? 'Polling System' : 'ระบบดึงข้อมูล', icon: RefreshCw },
      ]
    },
    {
      title: lang === 'en' ? 'Taxonomy & Works' : 'คำศัพท์แท็ก & รายการ',
      items: [
        { href: '/admin/tags', label: lang === 'en' ? 'Tag Vocabulary' : 'การจัดการแท็ก & ชื่อพ้อง', icon: Tags },
        { href: '/admin/works/W-2026-0891/tags', label: lang === 'en' ? 'Work Tag Curation' : 'จัดระเบียบแท็กในโครงการ', icon: Tag },
      ]
    },
    {
      title: lang === 'en' ? 'Accounts & Security' : 'บัญชี & บันทึกระบบ',
      items: [
        { href: '/admin/accounts', label: lang === 'en' ? 'Vendor Accounts' : 'บัญชีผู้ค้า', icon: Users },
        { href: '/admin/users', label: lang === 'en' ? 'Admin Staff' : 'จัดการเจ้าหน้าที่', icon: ShieldCheck },
        { href: '/admin/audit-log', label: lang === 'en' ? 'Audit Log' : 'บันทึกประวัติการแก้ไข', icon: History },
      ]
    },
    ...(isSuperAdmin ? [{
      title: lang === 'en' ? 'Super Admin Only' : 'สำหรับผู้ดูแลระบบสูงสุด',
      lockIcon: true,
      items: [
        { href: '/admin/source-config', label: lang === 'en' ? 'Source Config' : 'การตั้งค่าแหล่งข้อมูล', icon: Sliders },
      ]
    }] : [])
  ];

  const sidebarInner = (
    <>
      {/* Admin Shell Header */}
      <div className="p-5 border-b border-slate-100">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-700 transition-colors mb-3">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{lang === 'en' ? 'Back to Public Portal' : 'กลับสู่หน้าเว็บสาธารณะ'}</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 text-white flex items-center justify-center font-extrabold text-sm">
            AD
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900 text-base leading-tight">Admin Console</h2>
            <p className="text-[11px] text-sky-700 font-medium">B2G Vendor Management</p>
          </div>
        </div>
      </div>

      {/* Quick Poll Trigger */}
      <div className="p-4 border-b border-slate-100">
        <button
          onClick={() => triggerPollNow()}
          disabled={isPolling}
          className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer ${
            isPolling
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-sky-600 hover:bg-sky-700 text-white'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
          <span>{isPolling ? (lang === 'en' ? 'Polling sites...' : 'กำลังดึงข้อมูล...') : (lang === 'en' ? 'Poll Now' : 'สั่ง Poll Now ทันที')}</span>
        </button>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs">
        {navGroups.map((group, idx) => (
          <div key={idx} className="space-y-2">
            <h3 className="px-3 font-bold uppercase tracking-wider text-[10px] text-slate-400 flex items-center gap-1">
              {'lockIcon' in group && group.lockIcon && <Lock className="w-3 h-3" />}
              <span>{group.title}</span>
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-sky-50 text-sky-700 font-bold border border-sky-200'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-sky-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-100 text-[10px] text-slate-400 text-center">
        <p>B2G Vendor Admin Shell v2.0</p>
        <p>Role Access: Full SuperAdmin</p>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-600 text-white flex items-center justify-center font-bold text-xs">
            AD
          </div>
          <span className="font-bold text-slate-900 text-sm">Admin Console</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg border border-slate-200 text-slate-600 cursor-pointer"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[80vw] bg-white h-full flex flex-col shadow-xl animate-fade-in-up overflow-y-auto">
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-white text-slate-700 min-h-screen border-r border-slate-200 flex-col shrink-0">
        {sidebarInner}
      </aside>
    </>
  );
}
