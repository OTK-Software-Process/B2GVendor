'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { ErrorRetry } from '@/components/ErrorRetry';
import {
  BackendAdminWork,
  BackendAdminWorkDetail,
  BackendTag,
  BackendTagFacet,
  fetchAdminWork,
  fetchTags,
  setAdminWorkTags
} from '@/lib/backend';
import {
  Tag,
  ArrowLeft,
  Save,
  ShieldCheck,
  X,
  Search,
  Lock,
  Check,
  AlertTriangle,
  EyeOff,
  Info,
  RotateCcw,
  Loader2
} from 'lucide-react';

const PICKER_FACETS: Exclude<BackendTagFacet, 'site'>[] = ['category', 'keyword', 'method', 'agency'];
const FACET_LABEL: Record<Exclude<BackendTagFacet, 'site'>, { th: string; en: string }> = {
  category: { th: 'หมวดหมู่งาน', en: 'Category' },
  keyword: { th: 'คำสำคัญ', en: 'Keyword' },
  method: { th: 'วิธีจัดซื้อจัดจ้าง', en: 'Method' },
  agency: { th: 'หน่วยงาน', en: 'Agency' }
};

export default function WorkTagCurationPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { lang } = useApp();
  const t = (th: string, en: string) => (lang === 'en' ? en : th);

  const [detail, setDetail] = useState<BackendAdminWorkDetail | null>(null);
  const [allTags, setAllTags] = useState<BackendTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The editable selection (site tags are fixed and never part of it).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    Promise.all([fetchAdminWork(id), fetchTags()])
      .then(([workDetail, tags]) => {
        if (stale) return;
        setDetail(workDetail);
        setAllTags(tags);
        setSelectedIds(workDetail.work.tags.filter(tag => tag.facet !== 'site').map(tag => tag._id));
        setError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError({
          message: err instanceof Error ? err.message : '',
          notFound: err instanceof ApiError && err.status === 404
        });
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [id, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };

  const work: BackendAdminWork | null = detail?.work ?? null;
  const originalIds = useMemo(() => (work ? work.tags.filter(tag => tag.facet !== 'site').map(tag => tag._id) : []), [work]);

  // Everything we know by id: the work's own tags (may include retired ones) plus the active vocabulary.
  const tagById = useMemo(() => {
    const map = new Map<string, { _id: string; name: string; facet: BackendTagFacet; retired?: boolean; aliases?: string[] }>();
    for (const tag of allTags) map.set(tag._id, tag);
    for (const tag of work?.tags ?? []) if (!map.has(tag._id)) map.set(tag._id, tag);
    return map;
  }, [allTags, work]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const addedIds = selectedIds.filter(v => !originalIds.includes(v));
  const removedIds = originalIds.filter(v => !selectedSet.has(v));
  const dirty = addedIds.length > 0 || removedIds.length > 0;

  // Would saving flip the work in/out of the public site (ingestion topic filter)?
  const relevancePreview = useMemo(() => {
    if (!detail?.ingestionFilter.active || !work) return null;
    const inScope = new Set(detail.ingestionFilter.inScopeTagIds);
    const siteTagIds = work.tags.filter(tag => tag.facet === 'site').map(tag => tag._id);
    const nextShown = [...selectedIds, ...siteTagIds].some(v => inScope.has(v));
    const currentlyHidden = work.ingestionRelevance === 'not-related';
    if (nextShown && currentlyHidden) return 'will-show' as const;
    if (!nextShown && !currentlyHidden) return 'will-hide' as const;
    return null;
  }, [detail, work, selectedIds]);

  const toggle = (tagId: string) => {
    setNotice(null);
    setSelectedIds(prev => (prev.includes(tagId) ? prev.filter(v => v !== tagId) : [...prev, tagId]));
  };
  const reset = () => setSelectedIds(originalIds);

  const pickerGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PICKER_FACETS.map(facet => ({
      facet,
      tags: allTags.filter(
        tag =>
          tag.facet === facet &&
          !tag.retired &&
          (!q || tag.name.toLowerCase().includes(q) || (tag.aliases ?? []).some(a => a.toLowerCase().includes(q)))
      )
    })).filter(group => group.tags.length > 0);
  }, [allTags, search]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await setAdminWorkTags(id, selectedIds);
      setDetail(prev => (prev ? { ...prev, work: result.work } : prev));
      setSelectedIds(result.work.tags.filter(tag => tag.facet !== 'site').map(tag => tag._id));
      const parts: string[] = [];
      if (result.added.length) parts.push(t(`เพิ่ม ${result.added.length} แท็ก`, `${result.added.length} added`));
      if (result.removed.length) parts.push(t(`นำออก ${result.removed.length} แท็ก`, `${result.removed.length} removed`));
      setNotice(t('บันทึกแท็กของโครงการแล้ว', 'Work tags saved') + (parts.length ? ` — ${parts.join(', ')}` : ''));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 space-y-3 animate-pulse">
          <div className="h-5 w-1/2 bg-slate-100 rounded" />
          <div className="h-3 w-1/3 bg-slate-100 rounded" />
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-8 h-48 animate-pulse" />
      </div>
    );
  }

  if (error || !work || !detail) {
    return (
      <div className="space-y-6">
        <Link href="/admin/works" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-sky-700 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>{t('กลับสู่รายการโครงการ', 'Back to works')}</span>
        </Link>
        {error?.notFound ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-10 text-center text-sm text-slate-500">
            {t('ไม่พบโครงการนี้', 'This work could not be found.')}
          </div>
        ) : (
          <ErrorRetry message={error?.message || undefined} onRetry={retry} />
        )}
      </div>
    );
  }

  const siteTags = work.tags.filter(tag => tag.facet === 'site');
  const hidden = work.ingestionRelevance === 'not-related';

  return (
    <div className="space-y-8">
      <Link href="/admin/works" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-sky-700 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        <span>{t('กลับสู่รายการโครงการ', 'Back to works')}</span>
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-3">
        <div className="flex items-center gap-2">
          <Tag className="w-6 h-6 text-sky-600" />
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">{t('จัดระเบียบและกำหนดแท็กในโครงการ', 'Work Tag Curation')}</h1>
        </div>
        <p className="text-sm font-semibold text-slate-800">{work.title}</p>
        <p className="text-xs text-slate-500">
          <span className="font-mono">{work.projectId}</span> · {work.siteId?.name} · {work.status}
          {!hidden && (
            <>
              {' · '}
              <Link href={`/works/${work._id}`} className="text-sky-700 hover:underline">
                {t('ดูหน้าสาธารณะ', 'View public page')}
              </Link>
            </>
          )}
        </p>
        {hidden && (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <EyeOff className="w-4 h-4" />
            {t('โครงการนี้ถูกซ่อนจากหน้าสาธารณะ เพราะไม่มีแท็กตัวกรองการดึงข้อมูล', 'This work is hidden from the public site because it has no ingestion-filter tag.')}
          </p>
        )}
      </div>

      {notice && (
        <div role="status" className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex items-start gap-2.5 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-2xl p-4">
        <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t(
            'แท็กที่นำออกด้วยมือจะไม่ถูกระบบดึงข้อมูลเพิ่มกลับมาอีก และการแก้ไขแท็กที่นี่ไม่ส่งการแจ้งเตือนถึงผู้ติดตาม แท็กหน่วยงานถูกกำหนดโดยระบบและแก้ไขไม่ได้',
            'A tag you remove here is never re-added by future polls, and editing tags does not send notifications to followers. The site tag is set by the system and cannot be changed.'
          )}
        </p>
      </div>

      {/* Current tags */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-4">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">{t('แท็กของโครงการนี้', 'Tags on this work')}</h2>
        <ul className="flex flex-wrap gap-2">
          {siteTags.map(tag => (
            <li key={tag._id} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-600 rounded-full px-3 py-1" title={t('แท็กหน่วยงาน — แก้ไขไม่ได้', 'Site tag — cannot be changed')}>
              <Lock className="w-3 h-3" />#{tag.name}
            </li>
          ))}
          {selectedIds.map(tagId => {
            const tag = tagById.get(tagId);
            if (!tag) return null;
            const isNew = addedIds.includes(tagId);
            return (
              <li
                key={tagId}
                className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full pl-3 pr-1 py-1 border ${
                  isNew ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-800'
                }`}
              >
                <span>
                  #{tag.name}
                  {tag.retired && <span className="ml-1 opacity-70">({t('ปลดระวาง', 'retired')})</span>}
                </span>
                <button
                  onClick={() => toggle(tagId)}
                  aria-label={t(`นำแท็ก ${tag.name} ออก`, `Remove tag ${tag.name}`)}
                  className="p-1 rounded-full hover:bg-white/70 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            );
          })}
          {selectedIds.length === 0 && siteTags.length === 0 && <li className="text-xs text-slate-400">{t('ยังไม่มีแท็ก', 'No tags yet')}</li>}
          {selectedIds.length === 0 && siteTags.length > 0 && <li className="text-xs text-slate-400 self-center">{t('ยังไม่มีแท็กอื่น', 'No other tags')}</li>}
        </ul>
      </section>

      {/* Picker */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-5">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">{t('เพิ่มหรือนำแท็กออก', 'Add or remove tags')}</h2>

        <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label={t('ค้นหาแท็ก', 'Search tags')}
            placeholder={t('ค้นหาแท็กหรือคำพ้องความหมาย...', 'Search tags or aliases...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        {pickerGroups.length === 0 && <p className="text-sm text-slate-500 text-center py-4">{t('ไม่พบแท็ก', 'No tags found.')}</p>}

        {pickerGroups.map(group => (
          <div key={group.facet} className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{FACET_LABEL[group.facet][lang]}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.tags.map(tag => {
                const isSelected = selectedSet.has(tag._id);
                return (
                  <button
                    key={tag._id}
                    type="button"
                    onClick={() => toggle(tag._id)}
                    aria-pressed={isSelected}
                    className={`text-left p-3 rounded-2xl border-2 transition-all duration-150 flex items-center justify-between gap-3 cursor-pointer ${
                      isSelected ? 'border-sky-500 bg-sky-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-semibold text-sm">#{tag.name}</span>
                    <span className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center text-xs ${isSelected ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-300'}`}>
                      {isSelected ? <Check className="w-3.5 h-3.5" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Pending change summary */}
        {dirty && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs space-y-1.5" aria-live="polite">
            <p className="font-bold text-slate-700">{t('การเปลี่ยนแปลงที่ยังไม่บันทึก', 'Unsaved changes')}</p>
            {addedIds.length > 0 && (
              <p className="text-emerald-800">
                + {addedIds.map(v => `#${tagById.get(v)?.name ?? v}`).join(', ')}
              </p>
            )}
            {removedIds.length > 0 && (
              <p className="text-rose-700">
                − {removedIds.map(v => `#${tagById.get(v)?.name ?? v}`).join(', ')}
              </p>
            )}
          </div>
        )}

        {relevancePreview && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {relevancePreview === 'will-hide'
                ? t('หากบันทึก โครงการนี้จะถูกซ่อนจากหน้าสาธารณะ เพราะไม่เหลือแท็กตัวกรองการดึงข้อมูล', 'Saving will HIDE this work from the public site: it no longer has an ingestion-filter tag.')
                : t('หากบันทึก โครงการนี้จะแสดงในหน้าสาธารณะ เพราะมีแท็กตัวกรองการดึงข้อมูลแล้ว', 'Saving will SHOW this work on the public site: it now has an ingestion-filter tag.')}
            </p>
          </div>
        )}

        {saveError && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {saveError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={reset}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('ยกเลิกการเปลี่ยนแปลง', 'Reset')}
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors duration-150 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{t('บันทึกการจัดระเบียบแท็ก', 'Save tags')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
