'use client';

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SearchBar } from '@/components/SearchBar';
import { FilterBar } from '@/components/FilterBar';
import { WorkCard } from '@/components/WorkCard';
import { ViewToggle } from '@/components/ViewToggle';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { ErrorRetry } from '@/components/ErrorRetry';
import { FollowTagButton } from '@/components/FollowTagButton';
import { useApp } from '@/context/AppContext';
import { X, ArrowUpDown, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 3;

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, works, tags, govSites } = useApp();

  const [simulatedError, setSimulatedError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const q = searchParams.get('q') || '';
  const statusParam = searchParams.get('status') || '';
  const siteParam = searchParams.get('site') || '';
  const agencyParam = searchParams.get('agency') || '';
  const categoryParam = searchParams.get('category') || '';
  const methodParam = searchParams.get('method') || '';
  const budgetMaxParam = searchParams.get('budgetMax') || '';
  const sortBy = searchParams.get('sortBy') || 'date';
  const view = (searchParams.get('view') === 'grid' ? 'grid' : 'row') as 'row' | 'grid';

  const setView = (nextView: 'row' | 'grid') => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === 'row') {
      params.delete('view');
    } else {
      params.set('view', nextView);
    }
    router.push(`/search?${params.toString()}`);
  };

  let filteredWorks = works.filter(work => {
    if (q) {
      const qLower = q.toLowerCase();
      const matchTitle = work.title.toLowerCase().includes(qLower);
      const matchAgency = work.agencyName.toLowerCase().includes(qLower);
      const matchSite = work.siteName.toLowerCase().includes(qLower);
      const matchCategory = work.category.toLowerCase().includes(qLower);
      const matchTags = work.tags.some(t => t.name.toLowerCase().includes(qLower) || t.aliases.some(a => a.toLowerCase().includes(qLower)));
      if (!matchTitle && !matchAgency && !matchSite && !matchCategory && !matchTags) return false;
    }
    if (statusParam && work.status !== statusParam) return false;
    if (siteParam && work.siteId !== siteParam) return false;
    if (agencyParam && work.agencyId !== agencyParam) return false;
    if (categoryParam && work.category !== categoryParam) return false;
    if (methodParam && work.methodLabel !== methodParam && !work.tags.some(t => t.name === methodParam)) return false;
    if (budgetMaxParam && work.budget > parseInt(budgetMaxParam, 10)) return false;
    return true;
  });

  filteredWorks = [...filteredWorks].sort((a, b) => {
    if (sortBy === 'budget-desc') return b.budget - a.budget;
    if (sortBy === 'budget-asc') return a.budget - b.budget;
    if (sortBy === 'closing') return a.closingDate.localeCompare(b.closingDate);
    return b.publishDate.localeCompare(a.publishDate);
  });

  const removeChip = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    params.delete('page');
    router.push(`/search?${params.toString()}`);
  };

  const clearAllChips = () => {
    router.push('/search');
  };

  const activeChips: { key: string; label: string }[] = [];
  if (q) activeChips.push({ key: 'q', label: `คีย์เวิร์ด: "${q}"` });
  if (statusParam) activeChips.push({ key: 'status', label: `สถานะ: ${statusParam}` });
  if (siteParam) activeChips.push({ key: 'site', label: `หน่วยงานภาครัฐ: ${govSites.find(s => s.id === siteParam)?.name ?? siteParam}` });
  if (agencyParam) activeChips.push({ key: 'agency', label: `หน่วยงาน: ${agencyParam}` });
  if (categoryParam) activeChips.push({ key: 'category', label: `หมวดหมู่: ${categoryParam}` });
  if (methodParam) activeChips.push({ key: 'method', label: `วิธี: ${methodParam}` });
  if (budgetMaxParam) activeChips.push({ key: 'budgetMax', label: `งบสูงสุด: ${(parseInt(budgetMaxParam)/1000000).toFixed(0)} ล้านบาท` });

  const matchedQueryTag = q ? tags.find(t => t.name.toLowerCase() === q.toLowerCase() || t.aliases.some(a => a.toLowerCase() === q.toLowerCase())) : null;

  const totalPages = Math.max(1, Math.ceil(filteredWorks.length / PAGE_SIZE));
  const requestedPage = parseInt(searchParams.get('page') || '1', 10) || 1;
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const pagedWorks = filteredWorks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(page));
    }
    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Full-width search header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Search Procurement Works' : 'ค้นหาประกาศจัดซื้อจัดจ้าง'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {lang === 'en' ? 'Typo-tolerant search with one-click tag following' : 'ค้นหาแบบ Typo-tolerant เชื่อมโยงระบบแท็กและสิทธิ์การติดตาม'}
            </p>
          </div>

          <button
            onClick={() => setSimulatedError(!simulatedError)}
            className="text-xs px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center gap-1 font-medium transition-colors duration-150"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{simulatedError ? (lang === 'en' ? 'Turn off error test' : 'ปิดการจำลอง Error') : (lang === 'en' ? 'Test error state' : 'ทดสอบ Error State')}</span>
          </button>
        </div>

        <SearchBar size="large" />

        {matchedQueryTag && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-900">
                {lang === 'en' ? 'Found matching tag:' : 'พบแท็กตรงตามคำค้นหา:'} #{matchedQueryTag.name}
              </span>
              <span className="text-slate-500">({matchedQueryTag.followerCount} ผู้ติดตาม)</span>
            </div>
            <FollowTagButton tagId={matchedQueryTag.id} tagName={matchedQueryTag.name} variant="button" size="sm" />
          </div>
        )}

        <FilterBar />

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {activeChips.map(chip => (
              <span key={chip.key} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full font-medium">
                <span>{chip.label}</span>
                <button onClick={() => removeChip(chip.key)} className="hover:text-rose-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
            <button onClick={clearAllChips} className="text-xs text-rose-600 hover:underline font-semibold">
              {lang === 'en' ? 'Clear all' : 'ล้างทั้งหมด'}
            </button>
          </div>
        )}
      </div>

      {/* Results toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-b border-slate-100 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            {lang === 'en' ? 'Results:' : 'ผลการค้นหา:'}
          </span>
          <span className="text-sm font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
            {filteredWorks.length} {lang === 'en' ? 'items' : 'รายการ'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams.toString());
                params.set('sortBy', e.target.value);
                params.delete('page');
                router.push(`/search?${params.toString()}`);
              }}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 outline-hidden font-semibold hover:border-emerald-300 transition-colors"
            >
              <option value="date">{lang === 'en' ? 'Newest Ingested' : 'วันที่ประกาศล่าสุด'}</option>
              <option value="closing">{lang === 'en' ? 'Closing Soonest' : 'วันปิดรับซองใกล้สุด'}</option>
              <option value="budget-desc">{lang === 'en' ? 'Budget: High to Low' : 'งบประมาณ (สูงไปต่ำ)'}</option>
              <option value="budget-asc">{lang === 'en' ? 'Budget: Low to High' : 'งบประมาณ (ต่ำไปสูง)'}</option>
            </select>
          </div>

          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* Results */}
      {simulatedError ? (
        <ErrorRetry
          message="เกิดข้อผิดพลาดในการโหลดรายการค้นหาชั่วคราว (จำลองสถานะข้อผิดพลาด)"
          onRetry={() => setSimulatedError(false)}
        />
      ) : isLoading ? (
        <LoadingSkeleton count={4} />
      ) : filteredWorks.length === 0 ? (
        <EmptyState onReset={clearAllChips} />
      ) : (
        <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-4'}>
          {pagedWorks.map(work => (
            <WorkCard key={work.id} work={work} layout={view} />
          ))}
        </div>
      )}

      {!simulatedError && !isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-500 font-medium">
            {lang === 'en'
              ? `Page ${currentPage} of ${totalPages}`
              : `หน้า ${currentPage} จาก ${totalPages}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-emerald-400 hover:text-emerald-700 transition-all duration-150"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'Previous' : 'ก่อนหน้า'}</span>
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
              <button
                key={pageNum}
                onClick={() => goToPage(pageNum)}
                className={`w-8 h-8 text-xs font-bold rounded-xl transition-all duration-150 ${
                  pageNum === currentPage
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700'
                }`}
              >
                {pageNum}
              </button>
            ))}
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-emerald-400 hover:text-emerald-700 transition-all duration-150"
            >
              <span>{lang === 'en' ? 'Next' : 'ถัดไป'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
