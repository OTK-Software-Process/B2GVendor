'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { StatusBadge } from '@/components/StatusBadge';
import { FollowTagButton } from '@/components/FollowTagButton';
import { TORDownloadList } from '@/components/TORDownloadList';
import { useApp } from '@/context/AppContext';
import {
  Building2,
  Calendar,
  DollarSign,
  FileText,
  History,
  ArrowLeft,
  Share2,
  ShieldCheck,
  Tag,
  Edit3
} from 'lucide-react';

export default function WorkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { id } = params;
  const { lang, works, role } = useApp();

  const work = works.find(w => w.id === id) || works[0]; // fallback to first work item if id not found for demo

  const formattedBudget = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0
  }).format(work.budget);

  return (
    <PublicShell>
      <div className="max-w-4xl mx-auto space-y-8 pb-12">
        {/* Back Link & Deep Link Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-emerald-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{lang === 'en' ? 'Back to Search Results' : 'กลับสู่รายการค้นหา'}</span>
          </Link>

          {(role === 'admin' || role === 'superadmin') && (
            <Link
              href={`/admin/works/${work.id}/tags`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'Curate Tags in Admin' : 'จัดระเบียบแท็กใน Admin'}</span>
            </Link>
          )}
        </div>

        {/* Main Work Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <StatusBadge status={work.status} size="lg" />
              <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                ID: {work.id}
              </span>
            </div>

            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                alert(lang === 'en' ? 'Deep-link copied to clipboard!' : 'คัดลอกลิงก์ตรงสำหรับแจ้งเตือนแล้ว!');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 hover:bg-slate-50"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{lang === 'en' ? 'Share Deep-Link' : 'แชร์ Deep-Link'}</span>
            </button>
          </div>

          <div>
            <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 leading-snug">
              {work.title}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
              {work.description}
            </p>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-xs text-slate-400 font-medium block">{lang === 'en' ? 'Government Site' : 'หน่วยงานภาครัฐ'}</span>
              <span className="text-sm font-bold text-sky-700">{work.siteName}</span>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-xs text-slate-400 font-medium block">{lang === 'en' ? 'Budget' : 'งบประมาณกลาง'}</span>
              <span className="text-lg font-bold text-emerald-700">{formattedBudget}</span>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-xs text-slate-400 font-medium block">{lang === 'en' ? 'Agency Owner' : 'หน่วยงานเจ้าของโครงการ'}</span>
              <Link href={`/agencies/${work.agencyId}`} className="text-sm font-bold text-slate-900 hover:text-emerald-600 truncate block">
                {work.agencyName}
              </Link>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-xs text-slate-400 font-medium block">{lang === 'en' ? 'Closing Date' : 'วันปิดรับซองเสนอราคา'}</span>
              <span className="text-sm font-bold text-amber-700">{work.closingDate}</span>
            </div>
          </div>

          {/* Applied Tags Section */}
          <div className="pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-emerald-600" />
              <span>{lang === 'en' ? 'Tags Applied to this Work (Click to Follow):' : 'แท็กประจำโครงการนี้ (คลิกเพื่อติดตาม):'}</span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {work.tags.map(tag => (
                <FollowTagButton key={tag.id} tagId={tag.id} tagName={tag.name} variant="badge" size="sm" />
              ))}
            </div>
          </div>
        </div>

        {/* TOR Downloads Component */}
        <TORDownloadList files={work.torFiles} />

        {/* Status Change Timeline */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-lg text-slate-900">
              {lang === 'en' ? 'Status History & Change Detection' : 'ประวัติการอัปเดตและตรวจจับการเปลี่ยนแปลง'}
            </h3>
          </div>

          <div className="relative pl-6 border-l-2 border-slate-200 space-y-6">
            {work.history.map((item, idx) => (
              <div key={idx} className="relative">
                <div className="absolute -left-[31px] top-1 w-3.5 h-3.5 rounded-full bg-emerald-600 border-2 border-white" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">{item.date}</span>
                    <StatusBadge status={item.status} size="sm" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 font-medium">
                    {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
