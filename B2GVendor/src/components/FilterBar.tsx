'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { MOCK_AGENCIES, ProcurementStatus } from '@/lib/mock-data';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';

type FilterKey = 'status' | 'site' | 'agency' | 'category' | 'method' | 'budget';

function FilterBarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, tags, govSites } = useApp();
  const [openKey, setOpenKey] = useState<FilterKey | null>(null);

  const currentStatus = searchParams.get('status') || '';
  const currentSite = searchParams.get('site') || '';
  const currentAgency = searchParams.get('agency') || '';
  const currentCategory = searchParams.get('category') || '';
  const currentMethod = searchParams.get('method') || '';
  const currentBudgetMax = searchParams.get('budgetMax') || '';

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`/search?${params.toString()}`);
  };

  const clearAllFilters = () => {
    const q = searchParams.get('q');
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
    setOpenKey(null);
  };

  const hasActiveFilters = currentStatus || currentSite || currentAgency || currentCategory || currentMethod || currentBudgetMax;
  const activeCount = [currentStatus, currentSite, currentAgency, currentCategory, currentMethod, currentBudgetMax].filter(Boolean).length;

  const statusOptions: { value: ProcurementStatus; labelTh: string; labelEn: string }[] = [
    { value: 'INVITATION', labelTh: 'ประกาศเชิญชวน', labelEn: 'Invitation' },
    { value: 'BIDDING', labelTh: 'อยู่ระหว่างเสนอราคา', labelEn: 'Bidding Open' },
    { value: 'EVALUATION', labelTh: 'พิจารณาผล', labelEn: 'Evaluation' },
    { value: 'AWARDED', labelTh: 'ประกาศผู้ชนะ', labelEn: 'Awarded' },
    { value: 'CANCELLED', labelTh: 'ยกเลิก', labelEn: 'Cancelled' },
  ];

  const budgetOptions = [
    { value: '10000000', label: '≤ 10M ฿' },
    { value: '30000000', label: '≤ 30M ฿' },
    { value: '50000000', label: '≤ 50M ฿' },
    { value: '100000000', label: '≤ 100M ฿' },
  ];

  const categoryTags = tags.filter(t => t.facet === 'category');
  const methodTags = tags.filter(t => t.facet === 'method');

  const toggle = (key: FilterKey) => setOpenKey(prev => (prev === key ? null : key));

  const statusLabel = currentStatus
    ? (lang === 'en' ? statusOptions.find(o => o.value === currentStatus)?.labelEn : statusOptions.find(o => o.value === currentStatus)?.labelTh)
    : (lang === 'en' ? 'Status' : 'สถานะ');
  const siteLabel = currentSite
    ? govSites.find(s => s.id === currentSite)?.shortCode
    : (lang === 'en' ? 'Gov. Site' : 'หน่วยงานภาครัฐ');
  const agencyOptions = currentSite ? MOCK_AGENCIES.filter(a => a.siteId === currentSite) : MOCK_AGENCIES;
  const agencyLabel = currentAgency
    ? MOCK_AGENCIES.find(a => a.id === currentAgency)?.name.split(' ')[0]
    : (lang === 'en' ? 'Agency' : 'หน่วยงาน');
  const categoryLabel = currentCategory || (lang === 'en' ? 'Category' : 'หมวดหมู่');
  const methodLabel = currentMethod ? currentMethod.split(' ')[0] : (lang === 'en' ? 'Method' : 'วิธีจัดซื้อ');
  const budgetLabel = currentBudgetMax
    ? budgetOptions.find(b => b.value === currentBudgetMax)?.label
    : (lang === 'en' ? 'Budget' : 'งบประมาณ');

  const pillClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
      active
        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
    }`;

  const panelClass = 'absolute top-full left-0 mt-2 min-w-[220px] max-w-xs bg-white rounded-2xl border border-slate-200 shadow-lg z-50 p-3 animate-fade-in-up';

  return (
    <div className="relative">
      {openKey && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenKey(null)} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{lang === 'en' ? 'Filters' : 'ตัวกรอง'}</span>
        </span>

        {/* Status */}
        <div className="relative">
          <button onClick={() => toggle('status')} className={pillClass(!!currentStatus)}>
            <span>{statusLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'status' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'status' && (
            <div className={panelClass}>
              {statusOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { updateParam('status', currentStatus === opt.value ? '' : opt.value); setOpenKey(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentStatus === opt.value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {lang === 'en' ? opt.labelEn : opt.labelTh}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Government Site */}
        <div className="relative">
          <button onClick={() => toggle('site')} className={pillClass(!!currentSite)}>
            <span className="truncate max-w-[120px]">{siteLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'site' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'site' && (
            <div className={panelClass}>
              {govSites.map(site => (
                <button
                  key={site.id}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    if (currentSite === site.id) {
                      params.delete('site');
                    } else {
                      params.set('site', site.id);
                    }
                    params.delete('agency');
                    params.delete('page');
                    router.push(`/search?${params.toString()}`);
                    setOpenKey(null);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors ${
                    currentSite === site.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{site.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{site.shortCode}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Agency */}
        <div className="relative">
          <button onClick={() => toggle('agency')} className={pillClass(!!currentAgency)}>
            <span className="truncate max-w-[120px]">{agencyLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'agency' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'agency' && (
            <div className={panelClass}>
              {agencyOptions.map(a => (
                <button
                  key={a.id}
                  onClick={() => { updateParam('agency', currentAgency === a.id ? '' : a.id); setOpenKey(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentAgency === a.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category */}
        <div className="relative">
          <button onClick={() => toggle('category')} className={pillClass(!!currentCategory)}>
            <span className="truncate max-w-[120px]">{categoryLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'category' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'category' && (
            <div className={panelClass}>
              {categoryTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => { updateParam('category', currentCategory === tag.name ? '' : tag.name); setOpenKey(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors ${
                    currentCategory === tag.name ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">({tag.worksCount})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Method */}
        <div className="relative">
          <button onClick={() => toggle('method')} className={pillClass(!!currentMethod)}>
            <span className="truncate max-w-[120px]">{methodLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'method' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'method' && (
            <div className={panelClass}>
              {methodTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => { updateParam('method', currentMethod === tag.name ? '' : tag.name); setOpenKey(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentMethod === tag.name ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Budget */}
        <div className="relative">
          <button onClick={() => toggle('budget')} className={pillClass(!!currentBudgetMax)}>
            <span>{budgetLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'budget' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'budget' && (
            <div className={panelClass}>
              {budgetOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { updateParam('budgetMax', currentBudgetMax === opt.value ? '' : opt.value); setOpenKey(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentBudgetMax === opt.value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors duration-150"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? `Clear (${activeCount})` : `ล้างตัวกรอง (${activeCount})`}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterBar() {
  return <FilterBarContent />;
}
