'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { History, ArrowRight, RefreshCw, Bot, UserX } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { ErrorRetry } from '@/components/ErrorRetry';
import { TONE_CLASS, actionLabel, actionTone, actorTitle, entityTypeLabel, formatDateTime, timeAgo } from '@/lib/auditUi';
import { BackendAuditList, fetchAuditLog } from '@/lib/backend';

const LATEST = 8;

/**
 * The newest audit-log entries, for the admin dashboard. It reads the SAME
 * endpoint as the Audit Log page (so the same rules apply: an Admin never sees
 * staff-account entries), and it is self-contained: if it fails, the rest of the
 * dashboard is unaffected.
 */
export function RecentActivity() {
  const { lang } = useApp();
  const t = (th: string, en: string) => (lang === 'en' ? en : th);

  const [data, setData] = useState<BackendAuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let stale = false;
    fetchAuditLog({ pageSize: LATEST, sort: 'newest' })
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
  }, [reloadKey]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4" aria-labelledby="recent-activity-title">
      <h3 id="recent-activity-title" className="font-bold text-slate-900 text-base flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <span className="flex items-center gap-2">
          <History className="w-4 h-4 text-sky-600" />
          {t('กิจกรรมล่าสุด', 'Recent Activity')}
        </span>
        <span className="flex items-center gap-3">
          <button
            onClick={reload}
            disabled={loading}
            aria-label={t('รีเฟรชกิจกรรมล่าสุด', 'Refresh recent activity')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link href="/admin/audit-log" className="text-xs font-normal text-sky-700 hover:underline flex items-center gap-1">
            <span>{t('ดูทั้งหมด', 'View all')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </span>
      </h3>

      {loading && !data && (
        <div className="space-y-3 animate-pulse" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-full bg-slate-100 rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error !== null && !data && <ErrorRetry message={error || undefined} onRetry={reload} />}

      {data && data.items.length === 0 && (
        <p className="text-sm text-slate-500 py-4 text-center">
          {t('ยังไม่มีกิจกรรม — การแก้ไขแท็ก บัญชี และการกำหนดแท็กให้โครงการจะแสดงที่นี่', 'No activity yet. Tag, account and work-tag changes will appear here.')}
        </p>
      )}

      {data && data.items.length > 0 && (
        <>
          {!loading && error !== null && (
            <p role="alert" className="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {t('โหลดข้อมูลล่าสุดไม่สำเร็จ — ผลที่แสดงอาจไม่ใช่ข้อมูลปัจจุบัน', 'Could not load the latest entries. What is shown may be out of date.')}
            </p>
          )}
          <ul className={`divide-y divide-slate-100 ${loading ? 'opacity-60' : ''}`}>
            {data.items.map(entry => (
              <li key={entry.id}>
                {/* A full page load on purpose: the Audit Log page reads these filters from the URL on load. */}
                <a
                  href={`/admin/audit-log?entityId=${encodeURIComponent(entry.entityId)}&entityName=${encodeURIComponent(entry.entityLabel ?? '')}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 px-2 -mx-2 rounded-xl hover:bg-slate-50 transition-colors"
                  title={t('ดูประวัติทั้งหมดของรายการนี้', 'See all activity for this item')}
                >
                  <span className="min-w-0 flex items-center gap-2.5">
                    <span className={`shrink-0 px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${TONE_CLASS[actionTone(entry.action)]}`}>{actionLabel(entry.action, lang)}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 truncate">{entry.entityLabel ?? entry.entityId}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        <span className="uppercase tracking-wide font-bold text-slate-400">{entityTypeLabel(entry.entityType)}</span>
                        {' · '}
                        <span className="inline-flex items-center gap-1 align-middle">
                          {entry.actor.type === 'system' && <Bot className="w-3 h-3" />}
                          {entry.actor.type === 'anonymous' && <UserX className="w-3 h-3" />}
                          {actorTitle(entry.actor, lang)}
                        </span>
                      </span>
                    </span>
                  </span>
                  <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt, lang)} className="text-[11px] text-slate-400 whitespace-nowrap">
                    {timeAgo(entry.createdAt, lang)}
                  </time>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
