'use client';

import React from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { RefreshCw, Activity, Users, Tags, ArrowRight, CheckCircle2, Clock, Landmark } from 'lucide-react';
import { MOCK_VENDOR_ACCOUNTS } from '@/lib/mock-data';

export default function AdminDashboardPage() {
  const { lang, ingestionRuns, isPolling, triggerPollNow, tags, govSites } = useApp();
  const latestRun = ingestionRuns[0];
  const activeVendorCount = MOCK_VENDOR_ACCOUNTS.filter(a => a.status === 'active').length;
  const enabledSiteCount = govSites.filter(s => s.enabled).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {lang === 'en' ? 'Admin Dashboard' : 'แดชบอร์ดระบบผู้ดูแลระบบ (Admin Console)'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en' ? 'System health snapshot, api.data.go.th auto-polling status across all government sites, and recent audit activity' : 'ภาพรวมสถานะระบบ B2G Vendor การดึงข้อมูลอัตโนมัติจากทุกหน่วยงานภาครัฐ และสถิติหลัก'}
          </p>
        </div>

        <button
          onClick={() => triggerPollNow()}
          disabled={isPolling}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all duration-150 ${
            isPolling
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-sky-600 hover:bg-sky-700 text-white'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin' : ''}`} />
          <span>{isPolling ? (lang === 'en' ? 'Polling In Progress...' : 'กำลังดึงข้อมูล...') : (lang === 'en' ? 'Poll Now' : 'สั่ง Poll Now ทันที')}</span>
        </button>
      </div>

      {/* System Health Snapshot Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Last Poll Run */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>{lang === 'en' ? 'Last Poll Status' : 'สถานะการดึงข้อมูลล่าสุด'}</span>
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{latestRun?.status || 'SUCCESS'}</span>
            </span>
            <p className="text-xs font-mono text-slate-900 font-bold mt-2">{latestRun?.runId}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{latestRun?.startTime}</p>
          </div>
        </div>

        {/* Card 2: Next Scheduled Run */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>{lang === 'en' ? 'Next Scheduled Run' : 'รอบดึงข้อมูลถัดไป'}</span>
            <Clock className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">{lang === 'en' ? 'Every 15 minutes' : 'ทุก 15 นาที'}</p>
            <p className="text-xs text-sky-700 font-semibold mt-1">{lang === 'en' ? 'Runs automatically in the background' : 'ทำงานอัตโนมัติในเบื้องหลัง'}</p>
          </div>
        </div>

        {/* Card 3: Connected Government Sites */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>{lang === 'en' ? 'Connected Government Sites' : 'หน่วยงานภาครัฐที่เชื่อมต่อ'}</span>
            <Landmark className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="text-2xl font-extrabold text-slate-900">{enabledSiteCount} <span className="text-xs text-slate-400">/ {govSites.length}</span></p>
            <p className="text-xs text-slate-400 mt-1">{lang === 'en' ? 'Enabled via api.data.go.th polling' : 'เปิดใช้งานผ่านการ Poll api.data.go.th'}</p>
          </div>
        </div>

        {/* Card 4: Tag Vocabulary Count */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>{lang === 'en' ? 'Active Tags Taxonomy' : 'คลังคำศัพท์แท็ก'}</span>
            <Tags className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-extrabold text-slate-900">{tags.length} <span className="text-xs text-slate-400">tags</span></p>
            <p className="text-xs text-slate-400 mt-1">{lang === 'en' ? 'Across site, category, agency, method & keyword' : 'ครอบคลุมหน่วยงานภาครัฐ หมวดหมู่ หน่วยงานย่อย วิธีจัดซื้อ และคำสำคัญ'}</p>
          </div>
        </div>

        {/* Card 5: Active Vendor Accounts */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>{lang === 'en' ? 'Active Vendor Accounts' : 'บัญชีผู้ค้าที่ใช้งานอยู่'}</span>
            <Users className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="text-2xl font-extrabold text-slate-900">{activeVendorCount} <span className="text-xs text-slate-400">accounts</span></p>
            <p className="text-xs text-slate-400 mt-1">{lang === 'en' ? 'Individual + business, unified login' : 'บุคคลและนิติบุคคล ล็อกอินเดียว'}</p>
          </div>
        </div>
      </div>

      {/* Quick Admin Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base flex items-center justify-between border-b border-slate-100 pb-3">
            <span>{lang === 'en' ? 'Ingestion Controls' : 'ระบบจัดการการดึงข้อมูล'}</span>
            <Link href="/admin/ingestion" className="text-xs text-sky-700 hover:underline flex items-center gap-1">
              <span>{lang === 'en' ? 'Manage' : 'เข้าจัดการ'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </h3>
          <p className="text-xs text-slate-500">
            ตั้งค่าช่วงเวลา สโคปหน่วยงาน และการทริกเกอร์ Poll Now พร้อมระบบConcurrency Guard
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/ingestion" className="px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold transition-colors">
              ตั้งค่ากำหนดเวลา (Schedule)
            </Link>
            <Link href="/admin/ingestion/runs" className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">
              ดูประวัติ Run Log
            </Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base flex items-center justify-between border-b border-slate-100 pb-3">
            <span>{lang === 'en' ? 'Tag Vocabulary' : 'จัดการคำศัพท์แท็ก'}</span>
            <Link href="/admin/tags" className="text-xs text-sky-700 hover:underline flex items-center gap-1">
              <span>{lang === 'en' ? 'Manage Tags' : 'จัดการคลังแท็ก'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </h3>
          <p className="text-xs text-slate-500">
            นิยามคำพ้องความหมาย (Synonyms) และปลดระวางแท็กที่ไม่ใช้งาน พร้อมบันทึก Audit Log
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/tags" className="px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold transition-colors">
              คลังแท็กหลัก
            </Link>
            <Link href="/admin/audit-log" className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">
              ดู Audit Trail
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
