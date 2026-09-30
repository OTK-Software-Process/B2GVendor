'use client';

import Link from 'next/link';
import { ArrowRight, Compass, House, Search } from 'lucide-react';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';

export default function NotFound() {
  const { lang } = useApp();
  const isEnglish = lang === 'en';

  return (
    <PublicShell>
      <section className="relative isolate flex min-h-[58vh] items-center overflow-hidden py-12 sm:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -right-16 top-8 h-56 w-56 rounded-full border border-emerald-100 sm:right-8 sm:top-4 sm:h-72 sm:w-72" />
          <div className="absolute -right-8 top-16 h-40 w-40 rounded-full border border-sky-100 sm:right-16 sm:top-12 sm:h-56 sm:w-56" />
          <div className="absolute bottom-12 left-0 h-px w-1/3 bg-gradient-to-r from-transparent via-sky-100 to-transparent" />
        </div>

        <div className="mx-auto grid w-full max-w-5xl items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
          <div aria-hidden="true" className="relative flex min-h-52 items-center justify-center sm:min-h-72">
            <div className="absolute left-1/2 top-1/2 h-px w-[84%] -translate-x-1/2 -translate-y-1/2 rotate-[-15deg] border-t border-dashed border-slate-300" />
            <div className="relative flex items-center font-black leading-none text-slate-900">
              <span className="text-[8rem] text-sky-700 sm:text-[12rem]">4</span>
              <span className="relative text-[8rem] text-emerald-600 sm:text-[12rem]">
                0
                <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] border-white bg-white text-sky-700 shadow-sm sm:h-16 sm:w-16">
                  <Compass className="h-7 w-7 sm:h-9 sm:w-9" strokeWidth={2.4} />
                </span>
              </span>
              <span className="text-[8rem] text-sky-700 sm:text-[12rem]">4</span>
            </div>
            <span className="absolute bottom-4 left-[18%] h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
            <span className="absolute right-[16%] top-5 h-2.5 w-2.5 rounded-full bg-sky-500 ring-4 ring-sky-100" />
          </div>

          <div className="max-w-lg">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
              <span className="h-px w-7 bg-emerald-500" />
              {isEnglish ? '404 / Page not found' : '404 / ไม่พบหน้า'}
            </p>
            <h1 className="max-w-md text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">
              {isEnglish ? 'This page isn’t on the map.' : 'ไม่พบหน้าที่คุณกำลังมองหา'}
            </h1>
            <p className="mt-4 max-w-md text-base leading-7 text-slate-600">
              {isEnglish
                ? 'The link may be outdated, or the page may have moved. Let’s get you back to the procurement portal.'
                : 'ลิงก์นี้อาจหมดอายุหรือหน้านี้อาจถูกย้ายแล้ว กลับไปเริ่มต้นที่หน้าหลักของระบบจัดซื้อจัดจ้างได้เลย'}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <House className="h-4 w-4" />
                {isEnglish ? 'Back to Home' : 'กลับหน้าหลัก'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/search"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:border-sky-400 hover:text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
              >
                <Search className="h-4 w-4" />
                {isEnglish ? 'Search works' : 'ค้นหาโครงการ'}
              </Link>
            </div>

            <p className="mt-8 border-l-2 border-sky-200 pl-3 text-xs leading-5 text-slate-500">
              {isEnglish
                ? 'Looking for a government procurement notice? Search by agency, project, or keyword.'
                : 'กำลังมองหาประกาศจัดซื้อจัดจ้าง? ลองค้นหาด้วยชื่อหน่วยงาน โครงการ หรือคำสำคัญ'}
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}