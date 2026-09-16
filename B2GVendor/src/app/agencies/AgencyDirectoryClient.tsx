'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { fetchWorks, toTagItem } from '@/lib/backend';
import { TagItem } from '@/lib/mock-data';
import { Building2, Search, ArrowRight, Landmark, X } from 'lucide-react';

export function AgencyDirectoryClient() {
  const { lang, govSites, tags } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filterQuery, setFilterQuery] = useState('');

  const selectedSiteId = searchParams.get('site') || '';
  const selectedSite = govSites.find(s => s.id === selectedSiteId);

  const selectSite = (siteId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (selectedSiteId === siteId) {
      params.delete('site');
    } else {
      params.set('site', siteId);
    }
    router.push(`/agencies?${params.toString()}`);
  };

  // Agency (department) is just a Tag with facet='agency' -- there's no
  // dedicated Agency entity on the backend. A Tag isn't itself scoped to a
  // site, so to show "this site's departments" we derive it from the
  // agency-facet tags actually present on that site's ingested works.
  const [siteScopedAgencyTags, setSiteScopedAgencyTags] = useState<TagItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const allAgencyTags = tags.filter(t => t.facet === 'agency');

  useEffect(() => {
    if (!selectedSiteId) return;

    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        const res = await fetchWorks({ siteId: selectedSiteId, pageSize: 50 });
        if (cancelled) return;
        const seen = new Map<string, TagItem>();
        res.items.forEach(work => {
          work.tags
            .filter(t => t.facet === 'agency')
            .forEach(t => {
              if (!seen.has(t._id)) seen.set(t._id, toTagItem(t));
            });
        });
        setSiteScopedAgencyTags(Array.from(seen.values()));
      } catch {
        if (!cancelled) setSiteScopedAgencyTags([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId]);

  const agencyTags = selectedSiteId ? siteScopedAgencyTags : allAgencyTags;
  const showLoading = isLoading && Boolean(selectedSiteId);

  const filteredAgencies = agencyTags.filter(a =>
    a.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
    a.aliases.some(alias => alias.toLowerCase().includes(filterQuery.toLowerCase()))
  );

  return (
    <div className="space-y-8 pb-12">
      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-600" />
            <span>{lang === 'en' ? 'Browse by Government Site' : 'เรียกดูตามหน่วยงานภาครัฐ'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en' ? 'Pick a government site to see the departments (agency tags) present in its ingested works' : 'เลือกหน่วยงานภาครัฐเพื่อดูแท็กหน่วยงานย่อยที่พบในโครงการที่นำเข้าแล้วของแต่ละแห่ง'}
          </p>
        </div>

        {/* Government Site Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {govSites.map(site => {
            const active = selectedSiteId === site.id;
            return (
              <button
                key={site.id}
                onClick={() => selectSite(site.id)}
                disabled={!site.enabled}
                className={`text-left p-4 rounded-2xl border-2 transition-all duration-150 ${
                  active
                    ? 'border-emerald-500 bg-emerald-50'
                    : site.enabled
                      ? 'border-slate-200 hover:border-emerald-300 bg-white'
                      : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-sm text-slate-900">{site.shortCode}</span>
                  {!site.enabled && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                      {lang === 'en' ? 'Disabled' : 'ปิดใช้งาน'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-snug line-clamp-2">{site.name}</p>
              </button>
            );
          })}
          {govSites.length === 0 && (
            <p className="col-span-full text-sm text-slate-400 py-4">
              {lang === 'en' ? 'No government sites configured yet.' : 'ยังไม่มีการตั้งค่าหน่วยงานภาครัฐ'}
            </p>
          )}
        </div>

        {selectedSite && (
          <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 w-fit">
            <span className="font-semibold text-emerald-800">
              {lang === 'en' ? `Showing: ${selectedSite.name}` : `กำลังแสดง: ${selectedSite.name}`}
            </span>
            <button onClick={() => selectSite(selectedSite.id)} className="text-emerald-600 hover:text-emerald-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="relative flex items-center rounded-2xl bg-slate-50 border border-slate-200 px-4 py-2">
          <Search className="w-5 h-5 text-slate-400 mr-3" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={lang === 'en' ? 'Filter departments by name...' : 'กรองรายชื่อหน่วยงานย่อยตามชื่อ...'}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {showLoading && (
          <p className="col-span-full text-center py-8 text-sm text-slate-400">
            {lang === 'en' ? 'Loading departments…' : 'กำลังโหลดรายชื่อหน่วยงานย่อย…'}
          </p>
        )}

        {!showLoading && filteredAgencies.map(agency => (
          <div key={agency.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4 hover:border-emerald-500 transition-all">
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-slate-900">{agency.name}</h3>
              {agency.aliases.length > 0 && (
                <p className="text-xs text-slate-500 leading-relaxed">{agency.aliases.join(' · ')}</p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <Link
                href={`/agencies/${agency.id}`}
                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                <span>{lang === 'en' ? 'View Agency Works' : 'ดูรายการโครงการ'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}

        {!showLoading && filteredAgencies.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-slate-400 flex flex-col items-center gap-2">
            <Building2 className="w-8 h-8 text-slate-300" />
            <span>{lang === 'en' ? 'No departments match this filter.' : 'ไม่พบหน่วยงานย่อยที่ตรงกับตัวกรอง'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
