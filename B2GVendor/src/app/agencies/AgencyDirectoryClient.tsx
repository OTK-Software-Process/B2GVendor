'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { MOCK_AGENCIES } from '@/lib/mock-data';
import { useApp } from '@/context/AppContext';
import { Building2, Search, ArrowRight, Landmark, X } from 'lucide-react';

export function AgencyDirectoryClient() {
  const { lang, govSites } = useApp();
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

  const scopedAgencies = selectedSiteId ? MOCK_AGENCIES.filter(a => a.siteId === selectedSiteId) : MOCK_AGENCIES;

  const filteredAgencies = scopedAgencies.filter(a =>
    a.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
    a.code.toLowerCase().includes(filterQuery.toLowerCase()) ||
    a.category.toLowerCase().includes(filterQuery.toLowerCase())
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
            {lang === 'en' ? 'Pick a government site to drill into its departments and procurement works' : 'เลือกหน่วยงานภาครัฐเพื่อดูหน่วยงานย่อยและรายการจัดซื้อจัดจ้างของแต่ละแห่ง'}
          </p>
        </div>

        {/* Government Site Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {govSites.map(site => {
            const active = selectedSiteId === site.id;
            const agencyCount = MOCK_AGENCIES.filter(a => a.siteId === site.id).length;
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
                      {lang === 'en' ? 'Coming soon' : 'เร็วๆ นี้'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-snug line-clamp-2">{site.name}</p>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  {agencyCount} {lang === 'en' ? 'depts' : 'หน่วยงานย่อย'} · {site.worksCount} {lang === 'en' ? 'works' : 'โครงการ'}
                </p>
              </button>
            );
          })}
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
            placeholder={lang === 'en' ? 'Filter departments by name, code, or category...' : 'กรองรายชื่อหน่วยงานย่อย รหัส หรือหมวดหมู่...'}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAgencies.map(agency => (
          <div key={agency.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4 hover:border-emerald-500 transition-all">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg">
                  {agency.code}
                </span>
                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                  {agency.worksCount} {lang === 'en' ? 'active works' : 'โครงการ'}
                </span>
              </div>
              <h3 className="font-bold text-lg text-slate-900">{agency.name}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{agency.description}</p>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">{agency.category}</span>
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

        {filteredAgencies.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-slate-400 flex flex-col items-center gap-2">
            <Building2 className="w-8 h-8 text-slate-300" />
            <span>{lang === 'en' ? 'No departments match this filter.' : 'ไม่พบหน่วยงานย่อยที่ตรงกับตัวกรอง'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
