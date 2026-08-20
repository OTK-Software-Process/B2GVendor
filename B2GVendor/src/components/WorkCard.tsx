'use client';

import React from 'react';
import Link from 'next/link';
import { WorkItem } from '@/lib/mock-data';
import { StatusBadge } from './StatusBadge';
import { FollowTagButton } from './FollowTagButton';
import { useApp } from '@/context/AppContext';
import { Building2, ChevronRight } from 'lucide-react';

interface WorkCardProps {
  work: WorkItem;
  layout?: 'row' | 'grid';
}

export function WorkCard({ work, layout = 'row' }: WorkCardProps) {
  const { lang } = useApp();

  const formattedBudget = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0
  }).format(work.budget);

  const tagChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {work.tags.slice(0, layout === 'grid' ? 2 : undefined).map(tag => (
        <FollowTagButton key={tag.id} tagId={tag.id} tagName={tag.name} size="sm" />
      ))}
    </div>
  );

  if (layout === 'grid') {
    return (
      <div className="group bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200 hover:border-emerald-400 hover:shadow-[0_4px_20px_-6px_rgba(5,150,105,0.25)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={work.status} size="sm" />
            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md">{work.siteName}</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">{work.id}</span>
        </div>

        <Link
          href={`/works/${work.id}`}
          className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2 leading-snug"
        >
          {work.title}
        </Link>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="truncate">{work.agencyName}</span>
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="font-bold text-emerald-700">{formattedBudget}</span>
          <span className="text-amber-700 font-medium">{work.closingDate}</span>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          {tagChips}
          <Link
            href={`/works/${work.id}`}
            className="shrink-0 inline-flex items-center text-emerald-600 group-hover:translate-x-0.5 transition-transform duration-200"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="group bg-white border border-slate-200 rounded-2xl p-5 transition-all duration-200 hover:border-emerald-400 hover:shadow-[0_4px_20px_-6px_rgba(5,150,105,0.2)]">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={work.status} size="sm" />
            <span className="text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">{work.siteName}</span>
            <span className="text-xs text-slate-400 font-mono">ID: {work.id}</span>
          </div>

          <Link
            href={`/works/${work.id}`}
            className="block text-base sm:text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2"
          >
            {work.title}
          </Link>
          <p className="text-xs sm:text-sm text-slate-500 line-clamp-2">
            {work.description}
          </p>

          <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs text-slate-500 pt-1">
            <Link href={`/agencies/${work.agencyId}`} className="flex items-center gap-1.5 hover:text-emerald-700 font-medium transition-colors">
              <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate max-w-[220px]">{work.agencyName}</span>
            </Link>
            <span>{work.methodLabel}</span>
          </div>

          {tagChips}
        </div>

        {/* Side metrics */}
        <div className="flex lg:flex-col items-center lg:items-end justify-between gap-2 lg:gap-3 lg:w-48 shrink-0 lg:border-l lg:border-slate-100 lg:pl-4">
          <div className="text-left lg:text-right">
            <span className="text-[11px] text-slate-400 block">{lang === 'en' ? 'Budget' : 'งบประมาณกลาง'}</span>
            <span className="text-base sm:text-lg font-bold text-emerald-700">{formattedBudget}</span>
          </div>
          <div className="text-left lg:text-right">
            <span className="text-[11px] text-slate-400 block">{lang === 'en' ? 'Closes' : 'ปิดรับซอง'}</span>
            <span className="text-xs sm:text-sm font-semibold text-amber-700">{work.closingDate}</span>
          </div>
          <Link
            href={`/works/${work.id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline shrink-0"
          >
            <span>{lang === 'en' ? 'Details & TOR' : 'ดูรายละเอียด'}</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
        </div>
      </div>
    </div>
  );
}
