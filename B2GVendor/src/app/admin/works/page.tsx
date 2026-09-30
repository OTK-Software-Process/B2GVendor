'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp, AppLang } from '@/context/AppContext';
import { ErrorRetry } from '@/components/ErrorRetry';
import { BackendAdminWorkList, fetchAdminWorks } from '@/lib/backend';
import { Tag, Search, ChevronLeft, ChevronRight, EyeOff, Pencil } from 'lucide-react';

const PAGE_SIZE = 20;

function formatDate(iso: string | undefined, lang: AppLang): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium' });
}

export default function AdminWorksPage() {
  const { lang, govSites } = useApp();
  const t = (th: string, en: string) => (lang === 'en' ? en : th);

  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [siteId, setSiteId] = useState('');
  const [visibility, setVisibility] = useState<'' | 'visible' | 'hidden'>('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<BackendAdminWorkList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce typing into the search box; a new query goes back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(prev => {
        if (prev !== searchInput.trim()) setPage(1);
        return searchInput.trim();
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let stale = false;
    fetchAdminWorks({
      q: q || undefined,
      siteId: siteId || undefined,
      visibility: visibility || undefined,
      page,
      pageSize: PAGE_SIZE
    })
      .then(result => {
        if (stale) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(err instanceof Error ? err.message : '');
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [q, siteId, visibility, page, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
    setLoading(true);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = q !== '' || siteId !== '' || visibility !== '';

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <Tag className="w-6 h-6 text-sky-600" />
          <span>{t('จัดระเบียบแท็กในโครงการ', 'Work Tag Curation')}</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {t('เลือกโครงการเพื่อแก้ไขแท็กที่ผูกอยู่ (รวมโครงการที่ถูกซ่อนจากหน้าสาธารณะ)', 'Pick a work to correct its tags — including works hidden from the public site.')}
        </p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
        <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label={t('ค้นหาโครงการ', 'Search works')}
            placeholder={t('ค้นหาชื่อโครงการหรือรหัสโครงการ...', 'Search by title or project id...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>
        <select
          value={siteId}
          onChange={e => changeFilter(() => setSiteId(e.target.value))}
          aria-label={t('กรองตามหน่วยงาน', 'Filter by site')}
          className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 text-sm text-slate-700 outline-hidden focus:border-sky-400"
        >
          <option value="">{t('ทุกหน่วยงาน', 'All sites')}</option>
          {govSites.map(site => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={e => changeFilter(() => setVisibility(e.target.value as '' | 'visible' | 'hidden'))}
          aria-label={t('กรองตามการแสดงผล', 'Filter by visibility')}
          className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 text-sm text-slate-700 outline-hidden focus:border-sky-400"
        >
          <option value="">{t('แสดงทั้งหมด', 'All works')}</option>
          <option value="visible">{t('แสดงในหน้าสาธารณะ', 'Visible on public site')}</option>
          <option value="hidden">{t('ถูกซ่อนจากหน้าสาธารณะ', 'Hidden from public site')}</option>
        </select>
      </div>

      {loading && !data && (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-4 w-2/3 bg-slate-100 rounded" />
              <div className="h-3 w-1/3 bg-slate-100 rounded" />
              <div className="h-6 w-1/2 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && error !== null && !data && <ErrorRetry message={error || undefined} onRetry={retry} />}

      {data && data.items.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center text-sm text-slate-500">
          {filtersActive
            ? t('ไม่พบโครงการที่ตรงกับเงื่อนไข', 'No works match your filters.')
            : t('ยังไม่มีโครงการในระบบ — โครงการจะปรากฏหลังจากดึงข้อมูลจากหน่วยงานภาครัฐ', 'No works yet — they appear after the first poll of a government site.')}
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {data.items.map(work => {
              const hidden = work.ingestionRelevance === 'not-related';
              const editableTags = work.tags.filter(tag => tag.facet !== 'site');
              return (
                <div key={work._id} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:border-sky-300 transition-colors">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-sm">{work.title}</h3>
                      {hidden && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <EyeOff className="w-3 h-3" />
                          {t('ซ่อนจากหน้าสาธารณะ', 'Hidden from public')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{work.projectId}</span> · {work.siteId?.name ?? '-'} · {work.status} · {formatDate(work.pubDate, lang)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {editableTags.length === 0 ? (
                        <span className="text-xs text-slate-400">{t('ยังไม่มีแท็ก', 'No tags yet')}</span>
                      ) : (
                        editableTags.map(tag => (
                          <span
                            key={tag._id}
                            className={`text-xs rounded-full border px-2 py-0.5 ${
                              tag.retired ? 'bg-slate-50 border-slate-200 text-slate-400 line-through' : 'bg-sky-50 border-sky-100 text-sky-800'
                            }`}
                          >
                            #{tag.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/admin/works/${work._id}/tags`}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('จัดการแท็ก', 'Edit tags')}
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {t(`ทั้งหมด ${data.total} โครงการ`, `${data.total} works`)} · {t('หน้า', 'page')} {data.page}/{totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPage(p => Math.max(1, p - 1));
                  setLoading(true);
                }}
                disabled={page <= 1}
                aria-label={t('หน้าก่อนหน้า', 'Previous page')}
                className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setPage(p => Math.min(totalPages, p + 1));
                  setLoading(true);
                }}
                disabled={page >= totalPages}
                aria-label={t('หน้าถัดไป', 'Next page')}
                className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
