'use client';

import React, { useEffect, useState } from 'react';
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
import { fetchWorks, toWorkItem, ListWorksParams } from '@/lib/backend';
import { WorkItem } from '@/lib/mock-data';
import { X, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 10;

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, tags, govSites } = useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);

  const q = searchParams.get('q') || '';
  const statusParam = searchParams.get('status') || '';
  const siteParam = searchParams.get('site') || '';
  const tagsParam = searchParams.get('tags') || '';
  const budgetMaxParam = searchParams.get('budgetMax') || '';
  const sortBy = (searchParams.get('sortBy') as ListWorksParams['sort']) || 'date';
  const view = (searchParams.get('view') === 'grid' ? 'grid' : 'row') as 'row' | 'grid';
  const requestedPage = parseInt(searchParams.get('page') || '1', 10) || 1;

  const setView = (nextView: 'row' | 'grid') => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === 'row') {
      params.delete('view');
    } else {
      params.set('view', nextView);
    }
    router.push(`/search?${params.toString()}`);
  };

  // Real, server-side query + pagination against Backend GET /works -- each
  // page navigation actually re-fetches a different slice from Mongo
  // (page/pageSize/total from the API response), it doesn't slice a fixed
  // client-side array.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchWorks({
          q: q || undefined,
          status: (statusParam || undefined) as ListWorksParams['status'],
          siteId: siteParam || undefined,
          tag: tagsParam || undefined,
          budgetMax: budgetMaxParam ? Number(budgetMaxParam) : undefined,
          sort: sortBy,
          page: requestedPage,
          pageSize: PAGE_SIZE
        });
        if (cancelled) return;
        setItems(res.items.map(toWorkItem));
        setTotal(res.total);
      } catch {
        if (!cancelled) setError(lang === 'en' ? 'Failed to load search results.' : 'ไม่สามารถโหลดผลการค้นหาได้');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [q, statusParam, siteParam, tagsParam, budgetMaxParam, sortBy, requestedPage, lang]);

  const removeChip = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    params.delete('page');
    router.push(`/search?${params.toString()}`);
  };

  const removeTagChip = (tagId: string) => {
    const remaining = tagsParam.split(',').filter(id => id && id !== tagId);
    const params = new URLSearchParams(searchParams.toString());
    if (remaining.length > 0) {
      params.set('tags', remaining.join(','));
    } else {
      params.delete('tags');
    }
    params.delete('page');
    router.push(`/search?${params.toString()}`);
  };

  const clearAllChips = () => {
    router.push('/search');
  };

  const selectedTagIds = tagsParam.split(',').filter(Boolean);
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (q) activeChips.push({ key: 'q', label: `คีย์เวิร์ด: "${q}"`, onRemove: () => removeChip('q') });
  if (statusParam) activeChips.push({ key: 'status', label: `สถานะ: ${statusParam}`, onRemove: () => removeChip('status') });
  if (siteParam) {
    activeChips.push({
      key: 'site',
      label: `หน่วยงานภาครัฐ: ${govSites.find(s => s.id === siteParam)?.name ?? siteParam}`,
      onRemove: () => removeChip('site')
    });
  }
  selectedTagIds.forEach(tagId => {
    const tag = tags.find(t => t.id === tagId);
    activeChips.push({ key: `tag-${tagId}`, label: tag ? `แท็ก: ${tag.name}` : tagId, onRemove: () => removeTagChip(tagId) });
  });
  if (budgetMaxParam) {
    activeChips.push({
      key: 'budgetMax',
      label: `งบสูงสุด: ${(parseInt(budgetMaxParam) / 1000000).toFixed(0)} ล้านบาท`,
      onRemove: () => removeChip('budgetMax')
    });
  }

  const matchedQueryTag = q
    ? tags.find(t => t.name.toLowerCase() === q.toLowerCase() || t.aliases.some(a => a.toLowerCase() === q.toLowerCase()))
    : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);

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
        </div>

        <SearchBar size="large" />

        {matchedQueryTag && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-900">
                {lang === 'en' ? 'Found matching tag:' : 'พบแท็กตรงตามคำค้นหา:'} #{matchedQueryTag.name}
              </span>
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
                <button onClick={chip.onRemove} className="hover:text-rose-600 transition-colors">
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
            {total} {lang === 'en' ? 'items' : 'รายการ'}
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
              <option value="budget-desc">{lang === 'en' ? 'Budget: High to Low' : 'งบประมาณ (สูงไปต่ำ)'}</option>
              <option value="budget-asc">{lang === 'en' ? 'Budget: Low to High' : 'งบประมาณ (ต่ำไปสูง)'}</option>
            </select>
          </div>

          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* Results */}
      {error ? (
        <ErrorRetry
          message={error}
          onRetry={() => {
            // Re-run the effect by touching a param round-trip; simplest is
            // to just force a state flip via the page param.
            router.replace(`/search?${searchParams.toString()}`);
          }}
        />
      ) : isLoading ? (
        <LoadingSkeleton count={4} />
      ) : items.length === 0 ? (
        <EmptyState onReset={clearAllChips} />
      ) : (
        <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-4'}>
          {items.map(work => (
            <WorkCard key={work.id} work={work} layout={view} />
          ))}
        </div>
      )}

      {!error && !isLoading && totalPages > 1 && (
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
