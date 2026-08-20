'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { WorkCard } from '@/components/WorkCard';
import { FollowTagButton } from '@/components/FollowTagButton';
import { useApp } from '@/context/AppContext';
import { MOCK_AGENCIES } from '@/lib/mock-data';
import { Building2, ArrowLeft, Layers } from 'lucide-react';

export default function AgencyDetailPage() {
  const params = useParams();
  const { agencyId } = params;
  const { lang, works, tags, govSites } = useApp();

  const agency = MOCK_AGENCIES.find(a => a.id === agencyId) || MOCK_AGENCIES[0];
  const site = govSites.find(s => s.id === agency.siteId);
  const agencyWorks = works.filter(w => w.agencyId === agency.id || w.agencyName.includes(agency.name));

  // Find associated agency tag in taxonomy if exists
  const agencyTag = tags.find(t => t.name.includes(agency.name) || t.aliases.some(a => a.includes(agency.code)));

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        <Link
          href={site ? `/agencies?site=${site.id}` : '/agencies'}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{lang === 'en' ? 'Back to Government Site Directory' : 'กลับสู่ทำเนียบหน่วยงานภาครัฐ'}</span>
        </Link>

        {/* Agency Hero Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              {site && (
                <Link href={`/agencies?site=${site.id}`} className="text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md inline-block hover:bg-sky-100 transition-colors">
                  {site.name}
                </Link>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                  {agency.code}
                </span>
                <span className="text-xs text-slate-400">{agency.category}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                {agency.name}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 max-w-2xl">
                {agency.description}
              </p>
            </div>

            {/* Follow Agency Button */}
            {agencyTag && (
              <div className="shrink-0">
                <FollowTagButton tagId={agencyTag.id} tagName={`หน่วยงาน: ${agency.name}`} variant="button" size="md" />
              </div>
            )}
          </div>
        </div>

        {/* Agency Filtered Works List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              <span>{lang === 'en' ? 'Tenders & Procurement Works' : 'รายการประกาศจัดซื้อจัดจ้างของหน่วยงานนี้'}</span>
            </h2>
            <span className="text-xs text-slate-500">
              {agencyWorks.length} {lang === 'en' ? 'works found' : 'รายการ'}
            </span>
          </div>

          <div className="space-y-4">
            {agencyWorks.map(work => (
              <WorkCard key={work.id} work={work} />
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
