'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { AuditChanges, AuditMetadata } from '@/components/AuditChanges';
import { ErrorRetry } from '@/components/ErrorRetry';
import { canAccessAdminPath } from '@/lib/adminAccess';
import {
  TONE_CLASS,
  actionLabel,
  actionTone,
  actorTitle,
  entityLink,
  entityTypeLabel,
  formatDateTime,
  initialQueryParam,
  localDayBoundary,
  roleLabel
} from '@/lib/auditUi';
import {
  BackendAuditEntry,
  BackendAuditFilters,
  BackendAuditList,
  fetchAuditEntry,
  fetchAuditFilters,
  fetchAuditLog
} from '@/lib/backend';
import {
  ShieldCheck,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Bot,
  UserX,
  X,
  Loader2,
  Filter,
  AlertTriangle
} from 'lucide-react';

const PAGE_SIZE = 25;

export default function AdminAuditLogPage() {
  const { lang, role, account } = useApp();
  const t = (th: string, en: string) => (lang === 'en' ? en : th);

  // Filters. Their OPTIONS come from the API; nothing about what is audited is listed here.
  const [searchInput, setSearchInput] = useState(() => initialQueryParam('q'));
  const [q, setQ] = useState(() => initialQueryParam('q'));
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState(() => initialQueryParam('entityType'));
  const [entityId, setEntityId] = useState(() => initialQueryParam('entityId'));
  const [entityName, setEntityName] = useState(() => initialQueryParam('entityName')); // only for display in the "one item" chip
  const [actor, setActor] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<BackendAuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [filters, setFilters] = useState<BackendAuditFilters | null>(null);
  const [filtersFailed, setFiltersFailed] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullEntries, setFullEntries] = useState<Record<string, BackendAuditEntry>>({});
  const [loadingFull, setLoadingFull] = useState<Set<string>>(new Set());
  const [fullError, setFullError] = useState<string | null>(null);

  const dateError = fromDay !== '' && toDay !== '' && fromDay > toDay;

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

  // The dropdown options: distinct actions, entity types and actors that exist in the log.
  useEffect(() => {
    let stale = false;
    fetchAuditFilters()
      .then(result => {
        if (stale) return;
        setFilters(result);
        setFiltersFailed(false);
      })
      .catch(() => {
        if (!stale) setFiltersFailed(true); // the page still works: search and dates need no list
      });
    return () => {
      stale = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (dateError) return; // wait for a valid range instead of sending one the API rejects
    let stale = false;
    fetchAuditLog({
      q: q || undefined,
      actor: actor || undefined,
      action: action ? [action] : undefined,
      entityType: entityType ? [entityType] : undefined,
      entityId: entityId || undefined,
      from: fromDay ? localDayBoundary(fromDay, 'start') : undefined,
      to: toDay ? localDayBoundary(toDay, 'end') : undefined,
      sort,
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
  }, [q, actor, action, entityType, entityId, fromDay, toDay, sort, page, reloadKey, dateError]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
    setLoading(true);
    setExpanded(new Set());
  };
  const clearFilters = () =>
    changeFilter(() => {
      setSearchInput('');
      setQ('');
      setAction('');
      setEntityType('');
      setEntityId('');
      setEntityName('');
      setActor('');
      setFromDay('');
      setToDay('');
    });

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loadAllChanges = async (id: string) => {
    setFullError(null);
    setLoadingFull(prev => new Set(prev).add(id));
    try {
      const full = await fetchAuditEntry(id);
      setFullEntries(prev => ({ ...prev, [id]: full }));
    } catch (err) {
      setFullError(err instanceof Error ? err.message : t('เกิดข้อผิดพลาด', 'Something went wrong'));
    } finally {
      setLoadingFull(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersActive = q !== '' || action !== '' || entityType !== '' || entityId !== '' || actor !== '' || fromDay !== '' || toDay !== '';
  const selectClass = 'bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 outline-hidden focus:border-sky-400 max-w-full';

  const actorOptionLabel = (a: BackendAuditFilters['actors'][number]) => {
    if (a.type === 'anonymous') return t('ยังไม่ได้เข้าสู่ระบบ', 'Not signed in');
    if (a.type === 'system') return `${t('ระบบ', 'System')}: ${a.label ?? 'system'}`;
    return `${a.name ? `${a.name} · ` : ''}${a.email ?? a.key}${a.role ? ` (${roleLabel(a.role, lang)})` : ''}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-sky-600" />
            <span>{t('บันทึกประวัติการทำรายการ (Audit Trail Log)', 'Audit Log & Trail')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t('บันทึกถาวรที่แก้ไขหรือลบไม่ได้ ว่าใครทำอะไรกับสิ่งใด เมื่อไหร่ และข้อมูลเปลี่ยนจากอะไรเป็นอะไร', 'A permanent, read-only record of who changed what, and when, with the before and after values.')}
          </p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="px-3 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{t('รีเฟรช', 'Refresh')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Filter className="w-3.5 h-3.5" />
          {t('ตัวกรอง', 'Filters')}
        </div>

        <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3 shrink-0" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label={t('ค้นหาในบันทึก', 'Search the log')}
            placeholder={t('ค้นหาชื่อรายการ อีเมลผู้ดำเนินการ การกระทำ หรือรหัส...', 'Search an item name, actor email, action or id...')}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={action} onChange={e => changeFilter(() => setAction(e.target.value))} aria-label={t('กรองตามการกระทำ', 'Filter by action')} className={selectClass}>
            <option value="">{t('ทุกการกระทำ', 'All actions')}</option>
            {filters?.actions.map(a => (
              <option key={a} value={a}>
                {actionLabel(a, lang)} ({a})
              </option>
            ))}
          </select>

          <select value={entityType} onChange={e => changeFilter(() => setEntityType(e.target.value))} aria-label={t('กรองตามประเภท', 'Filter by item type')} className={selectClass}>
            <option value="">{t('ทุกประเภท', 'All item types')}</option>
            {filters?.entityTypes.map(type => (
              <option key={type} value={type}>
                {entityTypeLabel(type)}
              </option>
            ))}
          </select>

          <select value={actor} onChange={e => changeFilter(() => setActor(e.target.value))} aria-label={t('กรองตามผู้ดำเนินการ', 'Filter by actor')} className={selectClass}>
            <option value="">{t('ทุกผู้ดำเนินการ', 'All actors')}</option>
            {filters?.actors.map(a => (
              <option key={a.key} value={a.key}>
                {actorOptionLabel(a)}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            {t('ตั้งแต่', 'From')}
            <input
              type="date"
              value={fromDay}
              max={toDay || undefined}
              onChange={e => changeFilter(() => setFromDay(e.target.value))}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 outline-hidden focus:border-sky-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            {t('ถึง', 'To')}
            <input
              type="date"
              value={toDay}
              min={fromDay || undefined}
              onChange={e => changeFilter(() => setToDay(e.target.value))}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 outline-hidden focus:border-sky-400"
            />
          </label>

          <select value={sort} onChange={e => changeFilter(() => setSort(e.target.value as 'newest' | 'oldest'))} aria-label={t('เรียงลำดับ', 'Sort')} className={selectClass}>
            <option value="newest">{t('ใหม่สุดก่อน', 'Newest first')}</option>
            <option value="oldest">{t('เก่าสุดก่อน', 'Oldest first')}</option>
          </select>

          {filtersActive && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 cursor-pointer">
              <X className="w-3.5 h-3.5" />
              {t('ล้างตัวกรอง', 'Clear filters')}
            </button>
          )}
        </div>

        {entityId && (
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-100 rounded-full pl-3 pr-1.5 py-1">
            {t('แสดงเฉพาะประวัติของรายการเดียว', 'Showing the history of one item only')}
            <span className="font-bold">{entityName || <code className="font-mono text-[11px]">{entityId}</code>}</span>
            <button onClick={() => changeFilter(() => { setEntityId(''); setEntityName(''); })} aria-label={t('เลิกกรองตามรายการ', 'Stop filtering by this item')} className="p-0.5 rounded-full hover:bg-white cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </p>
        )}
        {dateError && (
          <p role="alert" className="text-xs font-semibold text-rose-700">
            {t('วันที่เริ่มต้องไม่อยู่หลังวันที่สิ้นสุด', '"From" must not be after "To".')}
          </p>
        )}
        {filtersFailed && (
          <p className="text-[11px] text-amber-800">
            {t('โหลดรายการตัวกรองไม่สำเร็จ — ยังค้นหาและเลือกวันที่ได้ตามปกติ', 'The filter lists could not be loaded. Search and dates still work.')}
          </p>
        )}
      </div>

      {loading && !data && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-3 animate-pulse" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 w-full bg-slate-100 rounded" />
          ))}
        </div>
      )}

      {!loading && error !== null && !data && <ErrorRetry message={error || undefined} onRetry={reload} />}

      {/* A refresh failed but results are on screen: say so, rather than quietly showing stale data. */}
      {!loading && error !== null && data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t('โหลดข้อมูลล่าสุดไม่สำเร็จ — ผลที่แสดงอาจไม่ใช่ข้อมูลปัจจุบัน', 'Could not load the latest entries. The results below may be out of date.')}</span>
          <button onClick={reload} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />
            {t('ลองใหม่', 'Retry')}
          </button>
        </div>
      )}

      {data && (
        <div className={`bg-white border border-slate-200 rounded-3xl overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="p-4 w-10" aria-label={t('ขยาย', 'Expand')} />
                  <th className="p-4 whitespace-nowrap">{t('วัน-เวลา', 'When')}</th>
                  <th className="p-4">{t('ผู้ดำเนินการ', 'Actor')}</th>
                  <th className="p-4">{t('การกระทำ', 'Action')}</th>
                  <th className="p-4">{t('รายการ', 'Item')}</th>
                  <th className="p-4">{t('สิ่งที่เปลี่ยน', 'Changed')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map(entry => {
                  const open = expanded.has(entry.id);
                  const full = fullEntries[entry.id];
                  const shown = full ?? entry;
                  const link = entityLink(entry);
                  const linkAllowed = link ? canAccessAdminPath(role, link.href.split('?')[0], account?.permissions) : false;
                  const tone = actionTone(entry.action);
                  const extraMeta = Object.entries(entry.metadata ?? {}).filter(([k]) => !['source', 'operation', 'model', 'role', 'accountType', 'tagsAdded', 'tagsRemoved'].includes(k));
                  return (
                    <React.Fragment key={entry.id}>
                      <tr className={`hover:bg-slate-50 transition-colors ${open ? 'bg-slate-50' : ''}`}>
                        <td className="p-4 align-top">
                          <button
                            onClick={() => toggle(entry.id)}
                            aria-expanded={open}
                            aria-controls={`audit-detail-${entry.id}`}
                            aria-label={open ? t('ย่อรายละเอียด', 'Collapse details') : t('ดูรายละเอียด', 'Show details')}
                            className="p-1 rounded-lg text-slate-500 hover:bg-white hover:text-sky-700 cursor-pointer"
                          >
                            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="p-4 align-top text-slate-600 whitespace-nowrap">{formatDateTime(entry.createdAt, lang)}</td>
                        <td className="p-4 align-top">
                          <p className="font-bold text-slate-900 flex items-center gap-1.5">
                            {entry.actor.type === 'system' && <Bot className="w-3.5 h-3.5 text-slate-400" />}
                            {entry.actor.type === 'anonymous' && <UserX className="w-3.5 h-3.5 text-slate-400" />}
                            {actorTitle(entry.actor, lang)}
                          </p>
                          {entry.actor.type === 'user' && (
                            <p className="text-[11px] text-slate-500">
                              <span className="font-mono">{entry.actor.email}</span>
                              {entry.actor.role && <span className="ml-1.5 font-semibold">· {roleLabel(entry.actor.role, lang)}</span>}
                            </p>
                          )}
                        </td>
                        <td className="p-4 align-top">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${TONE_CLASS[tone]}`}>{actionLabel(entry.action, lang)}</span>
                          <p className="font-mono text-[10px] text-slate-400 mt-1">{entry.action}</p>
                        </td>
                        <td className="p-4 align-top">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">{entityTypeLabel(entry.entityType)}</span>
                          <p className="font-semibold text-slate-900 mt-1 break-words">{entry.entityLabel ?? entry.entityId}</p>
                        </td>
                        <td className="p-4 align-top">
                          {entry.changeCount === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {entry.changes.slice(0, 3).map(c => (
                                <span key={c.path} className="font-mono text-[10px] bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-600">
                                  {c.path}
                                </span>
                              ))}
                              {entry.changeCount > 3 && <span className="text-[10px] text-slate-500 self-center">+{entry.changeCount - 3}</span>}
                            </span>
                          )}
                        </td>
                      </tr>

                      {open && (
                        <tr id={`audit-detail-${entry.id}`} className="bg-slate-50">
                          <td />
                          <td colSpan={5} className="px-4 pb-5 pt-1">
                            <div className="space-y-4">
                              <AuditChanges changes={shown.changes} lang={lang} />

                              {shown.changesCutShort && (
                                <div className="flex items-center gap-3">
                                  <p className="text-xs text-slate-500">
                                    {t(`แสดง ${shown.changes.length} จาก ${shown.changeCount} การเปลี่ยนแปลง`, `Showing ${shown.changes.length} of ${shown.changeCount} changes.`)}
                                  </p>
                                  <button
                                    onClick={() => void loadAllChanges(entry.id)}
                                    disabled={loadingFull.has(entry.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                                  >
                                    {loadingFull.has(entry.id) && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {t('แสดงทั้งหมด', 'Show all')}
                                  </button>
                                </div>
                              )}
                              {fullError && (
                                <p role="alert" className="text-xs text-rose-700 flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {fullError}
                                </p>
                              )}
                              {entry.truncated && (
                                <p className="text-[11px] text-amber-800">{t('บางค่าถูกตัดให้สั้นลงเพื่อจำกัดขนาดของบันทึก', 'Some values were shortened to keep the log entry small.')}</p>
                              )}

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {(entry.metadata && Object.keys(entry.metadata).length > 0) && (
                                  <div className="space-y-2">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('ข้อมูลเพิ่มเติม', 'Details')}</p>
                                    <AuditMetadata metadata={entry.metadata} lang={lang} />
                                    {extraMeta.length === 0 && !(entry.metadata?.tagsAdded || entry.metadata?.tagsRemoved) && entry.metadata?.role === undefined && (
                                      <p className="text-xs text-slate-500">{t('ไม่มีข้อมูลเพิ่มเติม', 'No extra details.')}</p>
                                    )}
                                  </div>
                                )}
                                <div className="space-y-1.5 text-xs text-slate-600">
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('คำขอ', 'Request')}</p>
                                  {entry.request?.path && (
                                    <p>
                                      <span className="font-mono font-bold">{entry.request.method}</span> <span className="font-mono break-all">{entry.request.path}</span>
                                    </p>
                                  )}
                                  {entry.ip && <p>IP: <span className="font-mono">{entry.ip}</span></p>}
                                  {entry.userAgent && <p className="break-words">{entry.userAgent}</p>}
                                  {entry.requestId && <p>{t('รหัสคำขอ', 'Request id')}: <span className="font-mono text-[11px] break-all">{entry.requestId}</span></p>}
                                  {!entry.request?.path && !entry.ip && !entry.requestId && <p className="text-slate-400">{t('เกิดจากงานเบื้องหลัง ไม่มีข้อมูลคำขอ', 'Background work: no request details.')}</p>}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                {link && linkAllowed &&
                                  (link.fullPage ? (
                                    <a href={link.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      {t('เปิดรายการนี้', 'Open this item')}
                                    </a>
                                  ) : (
                                    <Link href={link.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      {t('เปิดรายการนี้', 'Open this item')}
                                    </Link>
                                  ))}
                                {entityId !== entry.entityId && (
                                  <button
                                    onClick={() => changeFilter(() => { setEntityId(entry.entityId); setEntityName(entry.entityLabel ?? ''); })}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                                  >
                                    <Filter className="w-3.5 h-3.5" />
                                    {t('ดูประวัติทั้งหมดของรายการนี้', 'Show all activity for this item')}
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-10 text-center">
                      {filtersActive ? (
                        <div className="space-y-3">
                          <p className="text-sm text-slate-500">{t('ไม่พบรายการที่ตรงกับตัวกรอง', 'No entries match these filters.')}</p>
                          <button onClick={clearFilters} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                            {t('ล้างตัวกรอง', 'Clear filters')}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">
                          {t('ยังไม่มีบันทึก — การแก้ไขแท็ก บัญชี และการกำหนดแท็กให้โครงการจะปรากฏที่นี่', 'No entries yet. Tag, account and work-tag changes will appear here as they happen.')}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.total > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 px-4 py-3">
              <span>
                {t(`ทั้งหมด ${data.total.toLocaleString('th-TH')} รายการ`, `${data.total.toLocaleString('en-GB')} entries`)} · {t('หน้า', 'page')} {data.page}/{totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPage(p => Math.max(1, p - 1));
                    setLoading(true);
                    setExpanded(new Set());
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
                    setExpanded(new Set());
                  }}
                  disabled={page >= totalPages}
                  aria-label={t('หน้าถัดไป', 'Next page')}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
