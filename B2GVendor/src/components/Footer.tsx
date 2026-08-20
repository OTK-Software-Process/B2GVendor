'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';

export function Footer() {
  const { lang, ingestionRuns } = useApp();
  const latestRun = ingestionRuns[0];

  return (
    <footer className="mt-auto bg-white border-t border-slate-200 pt-12 pb-8 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: About & Disclosure */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <Image src="/Logo.png" alt="B2G Vendor" width={32} height={32} className="w-8 h-8 object-contain shrink-0" />
              <span className="font-extrabold text-base text-slate-900">B2G Vendor</span>
            </div>
            <p className="text-slate-500 leading-relaxed">
              {lang === 'en'
                ? 'Procurement disclosure portal covering multiple Thai government sites. Data is polled from the official api.data.go.th open-data API and refreshed automatically.'
                : 'ศูนย์เปิดเผยและติดตามข้อมูลการจัดซื้อจัดจ้างจากหน่วยงานภาครัฐหลายแห่ง เชื่อมโยงข้อมูลเปิดภาครัฐผ่าน api.data.go.th ดึงข้อมูลและวิเคราะห์หมวดหมู่แท็กอัตโนมัติ'}
            </p>
          </div>

          {/* Col 2: Quick Links */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm uppercase tracking-wider">{lang === 'en' ? 'Quick Navigation' : 'เมนูด่วน'}</h4>
            <ul className="space-y-1.5 font-medium">
              <li><Link href="/" className="text-slate-500 hover:text-emerald-700 transition-colors">{lang === 'en' ? 'Home' : 'หน้าแรก'}</Link></li>
              <li><Link href="/search" className="text-slate-500 hover:text-emerald-700 transition-colors">{lang === 'en' ? 'Search Works' : 'ค้นหาโครงการ'}</Link></li>
              <li><Link href="/agencies" className="text-slate-500 hover:text-emerald-700 transition-colors">{lang === 'en' ? 'Government Sites' : 'หน่วยงานภาครัฐ'}</Link></li>
              <li><Link href="/account/interests" className="text-slate-500 hover:text-emerald-700 transition-colors">{lang === 'en' ? 'Tag Vocabulary' : 'แท็กที่ติดตาม'}</Link></li>
              <li><Link href="/admin" className="text-slate-500 hover:text-sky-700 transition-colors">{lang === 'en' ? 'Admin Dashboard' : 'แดชบอร์ดผู้ดูแลระบบ'}</Link></li>
            </ul>
          </div>

          {/* Col 3: Data Freshness & Ingestion Status */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center gap-1.5">
              <span>{lang === 'en' ? 'Data Freshness' : 'ความสดใหม่ของข้อมูล'}</span>
              <span className="relative inline-flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-40 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
            </h4>
            <p className="text-slate-500">
              {lang === 'en' ? 'Last polling run' : 'รอบการดึงข้อมูลล่าสุด'}
              {latestRun && <span className="text-slate-800 font-mono"> · {latestRun.runId}</span>}
            </p>
            {latestRun && (
              <p className="text-slate-400">{latestRun.startTime} · {latestRun.fetchedCount} {lang === 'en' ? 'items' : 'รายการ'}</p>
            )}
            <p className="text-slate-400">
              {lang === 'en' ? 'Auto-polled periodically from api.data.go.th, per government site' : 'ดึงข้อมูลอัตโนมัติตามรอบเวลา จาก api.data.go.th แยกตามหน่วยงานภาครัฐ'}
            </p>
          </div>

          {/* Col 4: Compliance & Legal */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-sm uppercase tracking-wider">{lang === 'en' ? 'Compliance & Trust' : 'ข้อกำหนดและสิทธิ์'}</h4>
            <div className="space-y-1.5 text-slate-500">
              <p>{lang === 'en' ? 'PDPA Privacy Compliant' : 'คุ้มครองข้อมูลส่วนบุคคล (PDPA)'}</p>
              <p>{lang === 'en' ? 'HTTPS Encrypted Links' : 'ดาวน์โหลดปลอดภัย HTTPS'}</p>
              <p>{lang === 'en' ? 'BMA Contact: 1555' : 'สายด่วนกทม. 1555'}</p>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-[11px] text-slate-400">
          <p>© 2026 B2G Vendor Platform All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-emerald-700 hover:underline transition-colors">{lang === 'en' ? 'Privacy Policy' : 'นโยบายความเป็นส่วนตัว'}</a>
            <a href="#" className="hover:text-emerald-700 hover:underline transition-colors">{lang === 'en' ? 'Accessibility Statement' : 'คำแถลงการเข้าถึงได้'}</a>
            <a href="#" className="hover:text-emerald-700 hover:underline transition-colors">{lang === 'en' ? 'Open Data API' : 'ข้อมูลเปิดภาครัฐ API'}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
