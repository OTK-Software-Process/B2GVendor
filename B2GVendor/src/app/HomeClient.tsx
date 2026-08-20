'use client';

import React from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { SearchBar } from '@/components/SearchBar';
import { WorkCard } from '@/components/WorkCard';
import { useApp } from '@/context/AppContext';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

export function HomeClient() {
  const { lang, works, ingestionRuns, govSites } = useApp();
  const latestRun = ingestionRuns[0];

  const recentWorks = works.slice(0, 4);
  const featuredWork = recentWorks[0];
  const restOfWorks = recentWorks.slice(1);

  return (
    <PublicShell>
      <div className="space-y-16 pb-8">
        {/* Hero Section — open, not boxed */}
        <div className="relative pt-4 pb-2 animate-fade-in-up">
          <div className="max-w-3xl space-y-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <span className="relative inline-flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-40 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              <span>
                {lang === 'en'
                  ? `Live — last synced ${latestRun?.startTime}`
                  : `อัปเดตล่าสุด ${latestRun?.startTime}`}
              </span>
            </div>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05] text-slate-900">
              {lang === 'en' ? (
                <>Government procurement,<br /><span className="bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">made searchable.</span></>
              ) : (
                <>ค้นหาโครงการจัดซื้อจัดจ้าง<br /><span className="bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">จากหน่วยงานภาครัฐ</span></>
              )}
            </h1>

            <p className="text-base text-slate-500 leading-relaxed max-w-xl">
              {lang === 'en'
                ? 'Typo-tolerant, Thai-aware search across every connected government site, with automatic tagging and instant alerts when new work matches your interests.'
                : 'ค้นหาอัจฉริยะรองรับภาษาไทย ครอบคลุมทุกหน่วยงานภาครัฐที่เชื่อมต่อ พร้อมแท็กอัตโนมัติและแจ้งเตือนทันทีเมื่อมีประกาศใหม่ตรงกับความสนใจของคุณ'}
            </p>
          </div>

          <div className="pt-6 max-w-5xl">
            <SearchBar size="large" autoFocus />
          </div>

          <div className="pt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
            <span className="text-slate-400 mr-1">{lang === 'en' ? 'Try:' : 'ลองค้นหา:'}</span>
            <Link href="/search?status=BIDDING" className="text-slate-600 hover:text-emerald-700 underline decoration-slate-300 hover:decoration-emerald-400 underline-offset-4 transition-colors">
              {lang === 'en' ? 'Open for bidding' : 'อยู่ระหว่างเสนอราคา'}
            </Link>
            <span className="text-slate-300">·</span>
            <Link href="/search?agency=agency-yotha" className="text-slate-600 hover:text-emerald-700 underline decoration-slate-300 hover:decoration-emerald-400 underline-offset-4 transition-colors">
              {lang === 'en' ? 'Public Works Dept' : 'สำนักการโยธา'}
            </Link>
            <span className="text-slate-300">·</span>
            <Link href="/search?category=งานก่อสร้างและโยธา" className="text-slate-600 hover:text-emerald-700 underline decoration-slate-300 hover:decoration-emerald-400 underline-offset-4 transition-colors">
              {lang === 'en' ? 'Construction' : 'งานก่อสร้าง'}
            </Link>
            <span className="text-slate-300">·</span>
            <Link href="/search?category=ครุภัณฑ์คอมพิวเตอร์และดิจิทัล" className="text-slate-600 hover:text-emerald-700 underline decoration-slate-300 hover:decoration-emerald-400 underline-offset-4 transition-colors">
              {lang === 'en' ? 'IT & Digital' : 'ไอทีและดิจิทัล'}
            </Link>
          </div>
        </div>

        {/* Recently Ingested / Updated Works — featured + grid, no outer box */}
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                {lang === 'en' ? 'Recently posted' : 'รายการประกาศล่าสุด'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {lang === 'en' ? 'Fresh procurement notices, automatically classified' : 'โครงการจัดซื้อจัดจ้างนำเข้าล่าสุด จัดหมวดหมู่อัตโนมัติ'}
              </p>
            </div>

            <Link
              href="/search"
              className="shrink-0 inline-flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-700"
            >
              <span>{lang === 'en' ? 'View all' : 'ดูทั้งหมด'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {featuredWork && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WorkCard work={featuredWork} layout="row" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
                {restOfWorks.slice(0, 2).map(work => (
                  <WorkCard key={work.id} work={work} layout="grid" />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Browse by Government Site — open list, not a boxed card */}
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                {lang === 'en' ? 'Browse by government site' : 'เรียกดูตามหน่วยงานภาครัฐ'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {lang === 'en' ? 'BMA, Department of Highways, PEA, EGAT, MOPH, depa, DGA, and more' : 'กรุงเทพมหานคร กรมทางหลวง PEA EGAT สป.สธ. depa DGA และหน่วยงานอื่นๆ'}
              </p>
            </div>

            <Link
              href="/agencies"
              className="shrink-0 text-sm font-bold text-sky-700 hover:underline"
            >
              {lang === 'en' ? 'All sites' : 'ดูหน่วยงานทั้งหมด'}
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
            {govSites.map(site => (
              <Link
                key={site.id}
                href={`/agencies?site=${site.id}`}
                className={`group flex items-start justify-between gap-3 py-3 border-b border-slate-100 transition-colors duration-200 ${site.enabled ? 'hover:border-sky-300' : 'opacity-50'}`}
              >
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                    {site.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {site.worksCount} {lang === 'en' ? 'active works' : 'โครงการ'}
                  </p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-sky-600 shrink-0 mt-0.5 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
