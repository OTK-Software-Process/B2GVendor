'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useApp, AppLang } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { ErrorRetry } from '@/components/ErrorRetry';
import { initialQueryParam } from '@/lib/auditUi';
import {
  BackendAdminTag,
  BackendTagConflicts,
  BackendTagFacet,
  BackendTagMatch,
  checkTagDuplicates,
  createAdminTag,
  fetchAdminTags,
  reactivateAdminTag,
  retireAdminTag,
  updateAdminTag
} from '@/lib/backend';
import {
  Tags,
  Plus,
  Search,
  Trash2,
  X,
  Info,
  Pencil,
  Lock,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';

const FACETS: BackendTagFacet[] = ['site', 'agency', 'method', 'category', 'keyword'];
const EDITABLE_FACETS: Exclude<BackendTagFacet, 'site'>[] = ['category', 'agency', 'method', 'keyword'];

const FACET_LABEL: Record<BackendTagFacet, { th: string; en: string }> = {
  site: { th: 'หน่วยงานภาครัฐ (Site)', en: 'Site' },
  agency: { th: 'หน่วยงาน (Agency)', en: 'Agency' },
  method: { th: 'วิธีจัดซื้อจัดจ้าง (Method)', en: 'Method' },
  category: { th: 'หมวดหมู่งาน (Category)', en: 'Category' },
  keyword: { th: 'คำสำคัญ (Keyword)', en: 'Keyword' }
};

type Translate = (th: string, en: string) => string;

function sameAliases(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

function MatchList({ matches, t, lang }: { matches: BackendTagMatch[]; t: Translate; lang: AppLang }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {matches.map(m => (
        <li key={m.tagId} className="text-xs">
          <span className="font-bold">#{m.name}</span>{' '}
          <span className="text-slate-500">
            ({FACET_LABEL[m.facet][lang]}
            {m.retired ? `, ${t('ปลดระวางแล้ว', 'retired')}` : ''})
          </span>
          {m.candidateTerm.trim().toLowerCase() !== m.existingTerm.trim().toLowerCase() && (
            <span className="text-slate-500">
              {' '}
              — “{m.candidateTerm}” ≈ “{m.existingTerm}”
            </span>
          )}
          {m.similarity < 1 && <span className="text-slate-500"> · {Math.round(m.similarity * 100)}%</span>}
        </li>
      ))}
    </ul>
  );
}

function TagFormModal({
  tag,
  onClose,
  onSaved
}: {
  tag: BackendAdminTag | null; // null = create
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);
  const isEdit = tag !== null;
  const isSiteTag = tag?.facet === 'site';

  const [name, setName] = useState(tag?.name ?? '');
  const [facet, setFacet] = useState<Exclude<BackendTagFacet, 'site'>>(
    tag && tag.facet !== 'site' ? tag.facet : 'category'
  );
  const [aliases, setAliases] = useState<string[]>(tag?.aliases ?? []);
  const [aliasInput, setAliasInput] = useState('');
  const [result, setResult] = useState<{ key: string; conflicts: BackendTagConflicts } | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const trimmedName = name.trim();
  // Identifies the exact input a duplicate-check result belongs to, so a stale
  // result (or "create anyway" confirmation) never applies to edited input.
  const currentKey = JSON.stringify({ n: trimmedName, a: aliases, f: isEdit ? tag.facet : facet });
  const isChecked = result?.key === currentKey;
  const conflicts = isChecked ? result.conflicts : null;
  const checking = trimmedName !== '' && !isChecked;
  const confirmed = confirmedKey === currentKey;

  // Live duplicate check, debounced. State is only set inside the timer /
  // promise callbacks.
  useEffect(() => {
    if (!trimmedName) return;
    let stale = false;
    const key = currentKey;
    const timer = setTimeout(() => {
      checkTagDuplicates({
        name: trimmedName,
        aliases,
        facet: isEdit ? tag.facet : facet,
        excludeId: tag?._id
      })
        .then(conflictsResult => {
          if (!stale) setResult({ key, conflicts: conflictsResult });
        })
        .catch(() => {
          // The server re-checks on save anyway, so a failed pre-check just means no early warning.
          if (!stale) setResult({ key, conflicts: { exact: [], similar: [] } });
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const addAlias = () => {
    const value = aliasInput.trim();
    if (!value) return;
    const exists = aliases.some(a => a.toLowerCase() === value.toLowerCase());
    if (!exists && value.toLowerCase() !== trimmedName.toLowerCase()) setAliases([...aliases, value]);
    setAliasInput('');
  };

  const hasExact = (conflicts?.exact.length ?? 0) > 0;
  const hasSimilar = (conflicts?.similar.length ?? 0) > 0;
  const unchanged = isEdit && trimmedName === tag.name && sameAliases(aliases, tag.aliases);
  const canSave = trimmedName !== '' && !saving && !checking && !hasExact && (!hasSimilar || confirmed) && !unchanged;

  const handleSave = async () => {
    // Fold in an alias the admin typed but did not press Add for.
    const pendingAlias = aliasInput.trim();
    const finalAliases =
      pendingAlias && !aliases.some(a => a.toLowerCase() === pendingAlias.toLowerCase())
        ? [...aliases, pendingAlias]
        : aliases;

    setSaving(true);
    setSubmitError(null);
    try {
      if (isEdit) {
        await updateAdminTag(tag._id, {
          ...(isSiteTag ? {} : { name: trimmedName }),
          aliases: finalAliases,
          confirmNearDuplicate: confirmed || undefined
        });
        onSaved(t(`บันทึกแท็ก #${trimmedName} แล้ว`, `Saved tag #${trimmedName}`));
      } else {
        await createAdminTag({
          name: trimmedName,
          facet,
          aliases: finalAliases,
          confirmNearDuplicate: confirmed || undefined
        });
        onSaved(t(`สร้างแท็ก #${trimmedName} แล้ว`, `Created tag #${trimmedName}`));
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'DUPLICATE_TAG' || err.code === 'NEAR_DUPLICATE_TAG')) {
        // Someone else may have created a clashing tag since the live check ran.
        const matches = ((err.details as { matches?: BackendTagMatch[] } | undefined)?.matches ?? []);
        setResult({
          key: currentKey,
          conflicts: err.code === 'DUPLICATE_TAG' ? { exact: matches, similar: [] } : { exact: [], similar: matches }
        });
      } else {
        setSubmitError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
      }
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-form-title"
        className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5 animate-scale-in"
      >
        <div className="flex items-center justify-between">
          <h2 id="tag-form-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            {isEdit ? <Pencil className="w-5 h-5 text-sky-600" /> : <Plus className="w-5 h-5 text-sky-600" />}
            <span>{isEdit ? t('แก้ไขแท็ก', 'Edit Tag') : t('สร้างแท็กใหม่', 'Create New Tag')}</span>
          </h2>
          <button onClick={onClose} aria-label={t('ปิด', 'Close')} className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="tag-name" className="text-xs font-bold text-slate-500 uppercase">
              {t('ชื่อแท็ก', 'Tag Name')}
            </label>
            <input
              id="tag-name"
              type="text"
              autoFocus
              disabled={isSiteTag}
              value={name}
              maxLength={200}
              onChange={e => setName(e.target.value)}
              placeholder={t('เช่น งานก่อสร้าง', 'e.g. Road construction')}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400 disabled:bg-slate-50 disabled:text-slate-500"
            />
            {isSiteTag && (
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                {t('ชื่อแท็กหน่วยงานตั้งตามหน่วยงานภาครัฐ แก้ไขได้ที่การตั้งค่าแหล่งข้อมูล', 'A site tag is named after its government site. Rename it in Source Configuration.')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="tag-facet" className="text-xs font-bold text-slate-500 uppercase">
              {t('กลุ่มแท็ก (Facet)', 'Facet')}
            </label>
            <select
              id="tag-facet"
              value={isEdit ? tag.facet : facet}
              disabled={isEdit}
              onChange={e => setFacet(e.target.value as Exclude<BackendTagFacet, 'site'>)}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {(isEdit ? FACETS : EDITABLE_FACETS).map(f => (
                <option key={f} value={f}>
                  {FACET_LABEL[f][lang]}
                </option>
              ))}
            </select>
            {isEdit && (
              <p className="text-[11px] text-slate-500 mt-1">{t('กลุ่มแท็กเปลี่ยนไม่ได้หลังสร้าง', 'The facet cannot be changed after creation.')}</p>
            )}
          </div>

          <div>
            <label htmlFor="tag-alias" className="text-xs font-bold text-slate-500 uppercase">
              {t('คำพ้องความหมาย (Aliases)', 'Aliases (synonyms)')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="tag-alias"
                type="text"
                value={aliasInput}
                maxLength={200}
                onChange={e => setAliasInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder={t('พิมพ์แล้วกด Enter เพื่อเพิ่ม', 'Type and press Enter to add')}
                className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
              />
              <button
                type="button"
                onClick={addAlias}
                disabled={!aliasInput.trim()}
                className="px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                {t('เพิ่ม', 'Add')}
              </button>
            </div>
            {aliases.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {aliases.map(alias => (
                  <li key={alias} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded-full pl-2.5 pr-1 py-0.5">
                    <span>{alias}</span>
                    <button
                      type="button"
                      onClick={() => setAliases(aliases.filter(a => a !== alias))}
                      aria-label={t(`ลบคำพ้อง ${alias}`, `Remove alias ${alias}`)}
                      className="p-0.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 mt-1.5">
              {t('คำพ้องช่วยให้ AI จัดงานเข้าแท็กนี้ได้แม้เอกสารใช้คำอื่น และป้องกันการสร้างแท็กซ้ำ', 'Synonyms help the AI file work under this tag when a document uses another word, and prevent duplicate tags.')}
            </p>
          </div>

          {/* Duplicate check feedback */}
          <div aria-live="polite" className="space-y-2">
            {checking && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('กำลังตรวจสอบชื่อซ้ำ…', 'Checking for duplicates…')}
              </p>
            )}
            {hasExact && conflicts && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800">
                <p className="text-xs font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {conflicts.exact[0].retired
                    ? t('มีแท็กชื่อนี้ที่ปลดระวางแล้ว — ให้เปิดใช้งานแท็กเดิมแทนการสร้างซ้ำ', 'A retired tag with this name exists — reactivate it instead of creating a duplicate.')
                    : t('ชื่อหรือคำพ้องนี้ถูกใช้แล้ว — ใช้แท็กเดิม หรือปลดระวางแท็กเดิมก่อน', 'This name or alias is already used — use the existing tag, or retire it first.')}
                </p>
                <MatchList matches={conflicts.exact} t={t} lang={lang} />
              </div>
            )}
            {!hasExact && hasSimilar && conflicts && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">
                <p className="text-xs font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t('คล้ายกับแท็กที่มีอยู่ — แนะนำให้ปลดระวางแท็กที่ซ้ำซ้อนแทนการมีทั้งสองแท็ก', 'Similar to an existing tag — retire the redundant one instead of keeping both.')}
                </p>
                <MatchList matches={conflicts.similar} t={t} lang={lang} />
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={e => setConfirmedKey(e.target.checked ? currentKey : null)}
                    className="accent-amber-600"
                  />
                  {isEdit ? t('เข้าใจแล้ว บันทึกต่อ', 'I understand, save anyway') : t('เข้าใจแล้ว สร้างต่อ', 'I understand, create anyway')}
                </label>
              </div>
            )}
            {!checking && conflicts && !hasExact && !hasSimilar && trimmedName && (
              <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('ไม่พบชื่อซ้ำ', 'No duplicates found')}
              </p>
            )}
            {submitError && (
              <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {submitError}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer">
            {t('ยกเลิก', 'Cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? t('บันทึก', 'Save') : t('สร้างแท็ก', 'Create Tag')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retire confirmation
// ---------------------------------------------------------------------------

function RetireModal({
  tag,
  onClose,
  onRetired
}: {
  tag: BackendAdminTag;
  onClose: () => void;
  onRetired: (message: string) => void;
}) {
  const { lang } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await retireAdminTag(tag._id);
      onRetired(t(`ปลดระวางแท็ก #${tag.name} แล้ว`, `Retired tag #${tag.name}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
      <div role="alertdialog" aria-modal="true" aria-labelledby="retire-title" className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md space-y-4 animate-scale-in">
        <h2 id="retire-title" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-rose-600" />
          {t(`ปลดระวางแท็ก #${tag.name}?`, `Retire tag #${tag.name}?`)}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          {t(
            'แท็กจะไม่ถูกเสนอให้ติดตามหรือใช้ติดแท็กงานใหม่ และหายจากตัวกรองสาธารณะ ไม่มีการลบข้อมูล — เปิดใช้งานกลับได้ภายหลัง',
            'The tag will no longer be offered for following or tagging new work, and disappears from public filters. Nothing is deleted — you can reactivate it later.'
          )}
        </p>
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
          {t(
            `ยังผูกกับ ${tag.worksCount} โครงการ และมี ${tag.followerCount} ผู้ติดตาม (ข้อมูลเหล่านี้คงอยู่)`,
            `Still linked to ${tag.worksCount} works and ${tag.followerCount} followers (these are kept).`
          )}
        </p>
        {error && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 cursor-pointer">
            {t('ยกเลิก', 'Cancel')}
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('ปลดระวาง', 'Retire')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminTagsPage() {
  const { lang, refreshTags } = useApp();
  const t: Translate = (th, en) => (lang === 'en' ? en : th);

  const [tags, setTags] = useState<BackendAdminTag[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState(() => initialQueryParam('q'));
  const [facetFilter, setFacetFilter] = useState<BackendTagFacet | 'all'>('all');
  const [showRetired, setShowRetired] = useState(false);

  const [formTag, setFormTag] = useState<BackendAdminTag | null | undefined>(undefined); // undefined = closed, null = create
  const [retiring, setRetiring] = useState<BackendAdminTag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Always load every tag (including retired) once; the filters below are
  // applied client-side so toggling them is instant.
  useEffect(() => {
    let stale = false;
    fetchAdminTags({ includeRetired: true })
      .then(list => {
        if (stale) return;
        setTags(list);
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
  }, [reloadKey]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };

  // After any change: re-read the admin list, and refresh the public taxonomy
  // (search filters, follow buttons) so nothing shows stale tags.
  const afterChange = (message: string) => {
    setFormTag(undefined);
    setRetiring(null);
    setActionError(null);
    setNotice(message);
    setReloadKey(k => k + 1);
    void refreshTags().catch(() => {});
    window.setTimeout(() => setNotice(current => (current === message ? null : current)), 5000);
  };

  const reactivate = async (tag: BackendAdminTag) => {
    setActionError(null);
    try {
      await reactivateAdminTag(tag._id);
      afterChange(t(`เปิดใช้งานแท็ก #${tag.name} อีกครั้งแล้ว`, `Reactivated tag #${tag.name}`));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    }
  };

  const counts = useMemo(() => {
    const byFacet: Record<string, number> = { all: 0 };
    for (const tag of tags) {
      if (tag.retired && !showRetired) continue;
      byFacet.all += 1;
      byFacet[tag.facet] = (byFacet[tag.facet] ?? 0) + 1;
    }
    return byFacet;
  }, [tags, showRetired]);

  const visibleTags = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tags.filter(tag => {
      if (tag.retired && !showRetired) return false;
      if (facetFilter !== 'all' && tag.facet !== facetFilter) return false;
      if (!q) return true;
      return tag.name.toLowerCase().includes(q) || tag.aliases.some(a => a.toLowerCase().includes(q));
    });
  }, [tags, searchQuery, facetFilter, showRetired]);

  const retiredCount = tags.filter(tag => tag.retired).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Tags className="w-6 h-6 text-sky-600" />
            <span>{t('การจัดการคลังแท็กและชื่อพ้อง', 'Tag Vocabulary & Alias Management')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t('สร้างแท็กหลัก กำหนดคำพ้อง (Aliases) และปลดระวางแท็กที่ไม่ใช้งานแล้ว', 'Create canonical tags, define aliases, and retire tags that are no longer needed')}
          </p>
        </div>

        <button
          onClick={() => setFormTag(null)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t('สร้างแท็กใหม่', 'Create New Tag')}</span>
        </button>
      </div>

      {/* How tagging works */}
      <div className="flex items-start gap-2.5 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-2xl p-4">
        <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {lang === 'en' ? (
            <>New work is tagged <strong>automatically</strong> on every poll, and the AI is given each tag&apos;s <strong>aliases (synonyms)</strong> as hints. <strong>Government site tags</strong> are created automatically when a Super Admin adds a site in Source Configuration. <strong>Duplicates are retired, never merged</strong> — retire the redundant tag and keep the canonical one; retiring deletes nothing and can be undone. A new tag applies to future polls; it does not retroactively re-tag existing work.</>
          ) : (
            <>งานใหม่จะถูก<strong>ติดแท็กอัตโนมัติ</strong>ทุกครั้งที่ดึงข้อมูล โดย AI จะได้รับ<strong>คำพ้องความหมาย (Aliases)</strong> ของแต่ละแท็กเป็นแนวทาง <strong>แท็กหน่วยงานภาครัฐ</strong>ถูกสร้างอัตโนมัติเมื่อผู้ดูแลระบบสูงสุดเพิ่มหน่วยงานในหน้าการตั้งค่าแหล่งข้อมูล <strong>แท็กซ้ำซ้อนให้ปลดระวาง ไม่รวมแท็ก</strong> — ปลดระวางแท็กที่ซ้ำและเก็บแท็กหลักไว้ การปลดระวางไม่ลบข้อมูลและกู้คืนได้ แท็กใหม่มีผลกับการดึงข้อมูลรอบถัดไป ไม่ย้อนไปติดแท็กงานเก่า</>
          )}
        </p>
      </div>

      {notice && (
        <div role="status" className="flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}
      {actionError && (
        <div role="alert" className="flex items-center gap-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4" />
          {actionError}
        </div>
      )}

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label={t('ค้นหาแท็ก', 'Search tags')}
            placeholder={t('ค้นหาแท็กหรือคำพ้องความหมาย (Aliases)...', 'Search tag name or aliases...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('กรองตามกลุ่มแท็ก', 'Filter by facet')}>
            {(['all', ...FACETS] as const).map(f => (
              <button
                key={f}
                onClick={() => setFacetFilter(f)}
                aria-pressed={facetFilter === f}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
                  facetFilter === f ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f === 'all' ? t('ทั้งหมด', 'All') : FACET_LABEL[f][lang].replace(/ \(.*\)/, '')}{' '}
                <span className="opacity-70">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} className="accent-sky-600" />
            {t(`แสดงแท็กที่ปลดระวางแล้ว (${retiredCount})`, `Show retired tags (${retiredCount})`)}
          </label>
        </div>
      </div>

      {/* Content */}
      {loading && tags.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-4 w-24 bg-slate-100 rounded" />
              <div className="h-5 w-48 bg-slate-100 rounded" />
              <div className="h-10 w-full bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && error !== null && tags.length === 0 && <ErrorRetry message={error || undefined} onRetry={reload} />}

      {!loading && error === null && visibleTags.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center text-sm text-slate-500">
          {tags.length === 0
            ? t('ยังไม่มีแท็กในระบบ กด “สร้างแท็กใหม่” เพื่อเริ่มต้น', 'No tags yet. Press “Create New Tag” to add the first one.')
            : t('ไม่พบแท็กที่ตรงกับเงื่อนไข', 'No tags match your filters.')}
        </div>
      )}

      {visibleTags.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleTags.map(tag => (
            <div
              key={tag._id}
              className={`bg-white border rounded-2xl p-5 space-y-3 flex flex-col justify-between transition-colors duration-150 ${
                tag.retired ? 'border-slate-200 opacity-75' : 'border-slate-200 hover:border-sky-300'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
                    {tag.facet}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {tag.followerCount} {t('ผู้ติดตาม', 'followers')} • {tag.worksCount} {t('โครงการ', 'works')}
                  </span>
                </div>

                <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2 flex-wrap">
                  <span>#{tag.name}</span>
                  {tag.retired && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                      {t('ปลดระวางแล้ว', 'Retired')}
                    </span>
                  )}
                  {tag.includeInIngestionFilter && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                      {t('ตัวกรองการดึงข้อมูล', 'Ingestion filter')}
                    </span>
                  )}
                </h3>

                <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <span className="font-semibold text-slate-600">Aliases: </span>
                  {tag.aliases.length > 0 ? (
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {tag.aliases.map(alias => (
                        <span key={alias} className="bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-700">
                          {alias}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>{t('ไม่มี', 'none')}</span>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-4 text-xs font-semibold">
                {tag.retired ? (
                  <button onClick={() => void reactivate(tag)} className="text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors cursor-pointer">
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('เปิดใช้งานอีกครั้ง', 'Reactivate')}</span>
                  </button>
                ) : (
                  <>
                    <button onClick={() => setFormTag(tag)} className="text-sky-700 hover:text-sky-800 flex items-center gap-1 transition-colors cursor-pointer">
                      <Pencil className="w-3.5 h-3.5" />
                      <span>{t('แก้ไข', 'Edit')}</span>
                    </button>
                    {tag.facet === 'site' ? (
                      <span
                        className="text-slate-400 flex items-center gap-1 cursor-not-allowed"
                        title={t('แท็กหน่วยงานปลดระวางไม่ได้ ให้ปิดหน่วยงานในการตั้งค่าแหล่งข้อมูล', 'Site tags cannot be retired — disable the site in Source Configuration.')}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>{t('จัดการโดยระบบ', 'Managed by site')}</span>
                      </span>
                    ) : (
                      <button onClick={() => setRetiring(tag)} className="text-rose-600 hover:text-rose-700 flex items-center gap-1 transition-colors cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t('ปลดระวาง', 'Retire Tag')}</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {formTag !== undefined && <TagFormModal key={formTag?._id ?? 'new'} tag={formTag} onClose={() => setFormTag(undefined)} onSaved={afterChange} />}
      {retiring && <RetireModal tag={retiring} onClose={() => setRetiring(null)} onRetired={afterChange} />}
    </div>
  );
}
