'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { WorkCard } from '@/components/WorkCard';
import { FollowTagButton } from '@/components/FollowTagButton';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useApp } from '@/context/AppContext';
import { fetchWorks, toWorkItem } from '@/lib/backend';
import { WorkItem } from '@/lib/mock-data';
import { Building2, ArrowLeft, Layers } from 'lucide-react';

export default function AgencyDetailPage() {
  const params = useParams();
  const { agencyId } = params;
  const { lang, tags } = useApp();

  // "Agency" here is a real Tag with facet='agency' -- there's no separate
  // Agency entity on the backend (see AgencyDirectoryClient.tsx).
  const agencyTag = tags.find(t => t.id === agencyId);

  const [agencyWorks, setAgencyWorks] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (typeof agencyId !== 'string') return;
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        const res = await fetchWorks({ tag: agencyId as string, pageSize: 50 });
        if (!cancelled) setAgencyWorks(res.items.map(toWorkItem));
      } catch {
        if (!cancelled) setAgencyWorks([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        <Link
          href="/agencies"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{lang === 'en' ? 'Back to Government Site Directory' : 'กลับสู่ทำเนียบหน่วยงานภาครัฐ'}</span>
        </Link>

        {/* Agency Hero Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-600" />
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {agencyTag?.name ?? (lang === 'en' ? 'Unknown agency' : 'ไม่พบหน่วยงานย่อยนี้')}
                </h1>
              </div>
              {agencyTag && agencyTag.aliases.length > 0 && (
                <p className="text-xs sm:text-sm text-slate-600 max-w-2xl">
                  {agencyTag.aliases.join(' · ')}
                </p>
              )}
            </div>

            {/* Follow Agency Button */}
            {agencyTag && (
              <div className="shrink-0">
                <FollowTagButton tagId={agencyTag.id} tagName={agencyTag.name} variant="button" size="md" />
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
            {!isLoading && (
              <span className="text-xs text-slate-500">
                {agencyWorks.length} {lang === 'en' ? 'works found' : 'รายการ'}
              </span>
            )}
          </div>

          {isLoading ? (
            <LoadingSkeleton count={3} />
          ) : (
            <div className="space-y-4">
              {agencyWorks.map(work => (
                <WorkCard key={work.id} work={work} />
              ))}
              {agencyWorks.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">
                  {lang === 'en' ? 'No works tagged with this agency yet.' : 'ยังไม่มีโครงการที่ติดแท็กหน่วยงานนี้'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
