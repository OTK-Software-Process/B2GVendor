'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { ProcurementStatus } from '@/lib/mock-data';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';

type FilterKey = 'status' | 'site' | 'agency' | 'category' | 'method' | 'budget';

function FilterBarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, tags, govSites } = useApp();
  const [openKey, setOpenKey] = useState<FilterKey | null>(null);

  const currentStatus = searchParams.get('status') || '';
  const currentSite = searchParams.get('site') || '';
  // Agency / category / method are all just different facets of the same
  // Tag taxonomy on the real backend (Backend/src/models/tag.model.ts), and
  // the /works API filters by tag id(s) via a single `tags` param (matches
  // any, comma-separated) -- there's no separate agency/category/method
  // field on a Work. So all three dropdowns below toggle membership in this
  // one shared list.
  const selectedTagIds = (searchParams.get('tags') || '').split(',').filter(Boolean);
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

  const toggleTag = (tagId: string) => {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    updateParam('tags', next.join(','));
    setOpenKey(null);
  };

  const clearAllFilters = () => {
    const q = searchParams.get('q');
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
    setOpenKey(null);
  };

  const hasActiveFilters = currentStatus || currentSite || selectedTagIds.length > 0 || currentBudgetMax;
  const activeCount = [currentStatus, currentSite, currentBudgetMax].filter(Boolean).length + selectedTagIds.length;

  const statusOptions: { value: ProcurementStatus; labelTh: string; labelEn: string }[] = [
    { value: 'PLANNED', labelTh: 'อยู่ระหว่างวางแผน', labelEn: 'Planned' },
    { value: 'DRAFT_TOR', labelTh: 'ร่าง TOR', labelEn: 'Draft TOR' },
    { value: 'BIDDING', labelTh: 'อยู่ระหว่างเสนอราคา', labelEn: 'Bidding Open' },
    { value: 'AMENDED', labelTh: 'แก้ไขประกาศ', labelEn: 'Amended' },
    { value: 'AWARDED', labelTh: 'ประกาศผู้ชนะ', labelEn: 'Awarded' },
    { value: 'CANCELLED', labelTh: 'ยกเลิก', labelEn: 'Cancelled' }
  ];

  const budgetOptions = [
    { value: '10000000', label: '≤ 10M ฿' },
    { value: '30000000', label: '≤ 30M ฿' },
    { value: '50000000', label: '≤ 50M ฿' },
    { value: '100000000', label: '≤ 100M ฿' }
  ];

  const agencyTags = tags.filter(t => t.facet === 'agency');
  const categoryTags = tags.filter(t => t.facet === 'category');
  const methodTags = tags.filter(t => t.facet === 'method');

  const toggle = (key: FilterKey) => setOpenKey(prev => (prev === key ? null : key));

  const statusLabel = currentStatus
    ? (lang === 'en' ? statusOptions.find(o => o.value === currentStatus)?.labelEn : statusOptions.find(o => o.value === currentStatus)?.labelTh)
    : (lang === 'en' ? 'Status' : 'สถานะ');
  const siteLabel = currentSite
    ? govSites.find(s => s.id === currentSite)?.shortCode
    : (lang === 'en' ? 'Gov. Site' : 'หน่วยงานภาครัฐ');

  const selectedAgencyCount = agencyTags.filter(t => selectedTagIds.includes(t.id)).length;
  const selectedCategoryCount = categoryTags.filter(t => selectedTagIds.includes(t.id)).length;
  const selectedMethodCount = methodTags.filter(t => selectedTagIds.includes(t.id)).length;

  const agencyLabel = selectedAgencyCount > 0
    ? `${lang === 'en' ? 'Agency' : 'หน่วยงาน'} (${selectedAgencyCount})`
    : (lang === 'en' ? 'Agency' : 'หน่วยงาน');
  const categoryLabel = selectedCategoryCount > 0
    ? `${lang === 'en' ? 'Category' : 'หมวดหมู่'} (${selectedCategoryCount})`
    : (lang === 'en' ? 'Category' : 'หมวดหมู่');
  const methodLabel = selectedMethodCount > 0
    ? `${lang === 'en' ? 'Method' : 'วิธีจัดซื้อ'} (${selectedMethodCount})`
    : (lang === 'en' ? 'Method' : 'วิธีจัดซื้อ');
  const budgetLabel = currentBudgetMax
    ? budgetOptions.find(b => b.value === currentBudgetMax)?.label
    : (lang === 'en' ? 'Budget' : 'งบประมาณ');

  const pillClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
      active
        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
    }`;

  const panelClass = 'absolute top-full left-0 mt-2 min-w-[220px] max-w-xs max-h-72 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-lg z-50 p-3 animate-fade-in-up';

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
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
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
                    params.delete('page');
                    router.push(`/search?${params.toString()}`);
                    setOpenKey(null);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer ${
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
          <button onClick={() => toggle('agency')} className={pillClass(selectedAgencyCount > 0)}>
            <span className="truncate max-w-[120px]">{agencyLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'agency' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'agency' && (
            <div className={panelClass}>
              {agencyTags.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">{lang === 'en' ? 'No agency tags yet' : 'ยังไม่มีแท็กหน่วยงาน'}</p>
              )}
              {agencyTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                    selectedTagIds.includes(tag.id) ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category */}
        <div className="relative">
          <button onClick={() => toggle('category')} className={pillClass(selectedCategoryCount > 0)}>
            <span className="truncate max-w-[120px]">{categoryLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'category' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'category' && (
            <div className={panelClass}>
              {categoryTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    selectedTagIds.includes(tag.id) ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Method */}
        <div className="relative">
          <button onClick={() => toggle('method')} className={pillClass(selectedMethodCount > 0)}>
            <span className="truncate max-w-[120px]">{methodLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${openKey === 'method' ? 'rotate-180' : ''}`} />
          </button>
          {openKey === 'method' && (
            <div className={panelClass}>
              {methodTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                    selectedTagIds.includes(tag.id) ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
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
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
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
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors duration-150 cursor-pointer"
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
