'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp, AppLang } from '@/context/AppContext';
import { ErrorRetry } from '@/components/ErrorRetry';
import {
  fetchAdminDashboard,
  BackendAdminDashboard,
  BackendDashboardRun,
  BackendIngestionRunStatus
} from '@/lib/backend';
import {
  RefreshCw,
  Activity,
  Users,
  Tags,
  ArrowRight,
  CheckCircle2,
  Clock,
  Landmark,
  AlertTriangle,
  XCircle,
  Loader2,
  ShieldCheck,
  FileText
} from 'lucide-react';

const RUN_STATUS: Record<
  BackendIngestionRunStatus,
  { th: string; en: string; className: string; Icon: React.ElementType }
> = {
  success: { th: 'สำเร็จ', en: 'Success', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  partial: { th: 'สำเร็จบางส่วน', en: 'Partial', className: 'bg-amber-50 text-amber-700 border-amber-200', Icon: AlertTriangle },
  failed: { th: 'ล้มเหลว', en: 'Failed', className: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle },
  running: { th: 'กำลังทำงาน', en: 'Running', className: 'bg-sky-50 text-sky-700 border-sky-200', Icon: Loader2 }
};

function formatDateTime(iso: string | undefined | null, lang: AppLang): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// Status is conveyed by icon + text label, never colour alone (WCAG 2.1 AA).
function RunStatusBadge({ status, lang }: { status: BackendIngestionRunStatus; lang: AppLang }) {
  const { Icon, className, th, en } = RUN_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full border ${className}`}>
      <Icon className={`w-3.5 h-3.5 ${status === 'running' ? 'animate-spin' : ''}`} />
      <span>{lang === 'en' ? en : th}</span>
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse">
            <div className="h-3 w-24 bg-slate-100 rounded" />
            <div className="h-7 w-16 bg-slate-100 rounded" />
            <div className="h-3 w-32 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 animate-pulse">
        <div className="h-4 w-48 bg-slate-100 rounded" />
        <div className="h-10 w-full bg-slate-100 rounded" />
        <div className="h-10 w-full bg-slate-100 rounded" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  icon,
  children
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 transition-colors hover:border-sky-300">
      <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
        <span>{label}</span>
        {icon}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { lang, isPolling, triggerPollNow } = useApp();
  const [data, setData] = useState<BackendAdminDashboard | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const t = (th: string, en: string) => (lang === 'en' ? en : th);

  const [reloadKey, setReloadKey] = useState<number>(0);

  // Manual refresh / retry: show the loading state again and refetch.
  const load = () => {
    setLoading(true);
    setError(null);
    setReloadKey(k => k + 1);
  };

  // (Re)fetch on mount, on manual reload, and whenever a poll starts or
  // finishes (a finished poll changes the run numbers). `loading` starts true
  // for the first load; later refetches keep the current data on screen.
  useEffect(() => {
    let stale = false;
    fetchAdminDashboard()
      .then(snapshot => {
        if (stale) return;
        setData(snapshot);
        setError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setData(null);
        setError(err instanceof Error ? err.message : '');
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [reloadKey, isPolling]);

  const ing = data?.ingestion;
  const lastRun = ing?.lastRun ?? null;

  const runCounts = (run: BackendDashboardRun) => (
    <span className="tabular-nums">
      {run.fetchedCount} / {run.newCount} / {run.updatedCount} / {run.failedCount}
    </span>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {t('แดชบอร์ดระบบผู้ดูแลระบบ (Admin Console)', 'Admin Dashboard')}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t(
              'ภาพรวมสถานะระบบ B2G Vendor การดึงข้อมูลอัตโนมัติจากทุกหน่วยงานภาครัฐ และสถิติหลัก',
              'System health snapshot, polling status across all government sites, and key statistics'
            )}
          </p>
          {data && (
            <p className="text-[11px] text-slate-400 mt-1">
              {t('อัปเดตเมื่อ', 'Updated')} {formatDateTime(data.generatedAt, lang)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('รีเฟรช', 'Refresh')}</span>
          </button>
          <button
            onClick={() => triggerPollNow()}
            disabled={isPolling}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all duration-150 cursor-pointer ${
              isPolling
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-sky-600 hover:bg-sky-700 text-white'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin' : ''}`} />
            <span>{isPolling ? t('กำลังดึงข้อมูล...', 'Polling In Progress...') : t('สั่ง Poll Now ทันที', 'Poll Now')}</span>
          </button>
        </div>
      </div>

      {loading && !data && <DashboardSkeleton />}

      {!loading && error !== null && !data && <ErrorRetry message={error || undefined} onRetry={load} />}

      {data && ing && (
        <>
          {/* System Health Snapshot Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label={t('สถานะการดึงข้อมูลล่าสุด', 'Last Poll Status')} icon={<Activity className="w-4 h-4 text-emerald-600" />}>
              {lastRun ? (
                <>
                  <RunStatusBadge status={lastRun.status} lang={lang} />
                  <p className="text-xs font-bold text-slate-900 mt-2">
                    {lastRun.site.name} <span className="font-mono text-slate-400">({lastRun.site.shortCode})</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(lastRun.startedAt, lang)}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-900">{t('ยังไม่มีการดึงข้อมูล', 'No polls yet')}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('กด Poll Now เพื่อเริ่มดึงข้อมูล', 'Press Poll Now to start')}</p>
                </>
              )}
            </StatCard>

            <StatCard label={t('รอบดึงข้อมูลถัดไป', 'Next Scheduled Run')} icon={<Clock className="w-4 h-4 text-sky-600" />}>
              {ing.nextScheduledAt ? (
                <p className="text-sm font-bold text-slate-900">{formatDateTime(ing.nextScheduledAt, lang)}</p>
              ) : (
                <p className="text-sm font-bold text-slate-900">{t('ยังไม่ได้กำหนดรอบ', 'Not scheduled yet')}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {ing.runningNow > 0 || ing.queuedJobs > 0
                  ? t(`กำลังทำงาน ${ing.runningNow} · รอคิว ${ing.queuedJobs}`, `${ing.runningNow} running · ${ing.queuedJobs} queued`)
                  : ing.nextScheduledAt
                    ? t('ทำงานอัตโนมัติในเบื้องหลัง', 'Runs automatically in the background')
                    : t('ตัวกำหนดเวลาจะตั้งรอบเมื่อ worker ทำงาน', 'The worker sets this once it starts')}
              </p>
            </StatCard>

            <StatCard label={t('หน่วยงานภาครัฐที่เชื่อมต่อ', 'Connected Government Sites')} icon={<Landmark className="w-4 h-4 text-sky-600" />}>
              <p className="text-2xl font-extrabold text-slate-900">
                {data.sites.enabled} <span className="text-xs text-slate-400">/ {data.sites.total}</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">{t('เปิดใช้งาน / ทั้งหมด', 'Enabled / total')}</p>
            </StatCard>

            <StatCard label={t('คลังคำศัพท์แท็ก', 'Active Tags Taxonomy')} icon={<Tags className="w-4 h-4 text-emerald-600" />}>
              <p className="text-2xl font-extrabold text-slate-900">
                {data.tags.active} <span className="text-xs text-slate-400">tags</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {t(`ปลดระวางแล้ว ${data.tags.retired} แท็ก`, `${data.tags.retired} retired`)}
              </p>
            </StatCard>

            <StatCard label={t('บัญชีผู้ค้าที่ใช้งานอยู่', 'Active Vendor Accounts')} icon={<Users className="w-4 h-4 text-sky-600" />}>
              <p className="text-2xl font-extrabold text-slate-900">
                {data.accounts.vendors.active} <span className="text-xs text-slate-400">/ {data.accounts.vendors.total}</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {t(`ระงับการใช้งาน ${data.accounts.vendors.suspended} บัญชี`, `${data.accounts.vendors.suspended} suspended`)}
              </p>
            </StatCard>
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label={t('เจ้าหน้าที่ผู้ดูแลระบบ', 'Admin Staff')} icon={<ShieldCheck className="w-4 h-4 text-sky-600" />}>
              <p className="text-2xl font-extrabold text-slate-900">{data.accounts.admins.total}</p>
              <p className="text-xs text-slate-400 mt-1">
                {t(
                  `Admin ${data.accounts.admins.admin} · Super Admin ${data.accounts.admins.superadmin}`,
                  `${data.accounts.admins.admin} Admin · ${data.accounts.admins.superadmin} Super Admin`
                )}
              </p>
            </StatCard>

            <StatCard label={t('โครงการที่รวบรวมได้', 'Ingested Works')} icon={<FileText className="w-4 h-4 text-emerald-600" />}>
              <p className="text-2xl font-extrabold text-slate-900">{data.works.total}</p>
              <p className="text-xs text-slate-400 mt-1">{t('โครงการทั้งหมดในระบบ', 'Total works in the system')}</p>
            </StatCard>

            <StatCard label={t('รอบที่ล้มเหลว (24 ชม.)', 'Failed Runs (24h)')} icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}>
              <p className={`text-2xl font-extrabold ${ing.failedRuns24h > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {ing.failedRuns24h}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {ing.failedRuns24h > 0
                  ? t('ตรวจสอบประวัติการดึงข้อมูล', 'Check the run history')
                  : t('ไม่พบความผิดปกติ', 'No failures')}
              </p>
            </StatCard>
          </div>

          {/* Latest poll result per government site */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base flex items-center justify-between border-b border-slate-100 pb-3">
              <span>{t('ผลการดึงข้อมูลล่าสุดแยกตามหน่วยงาน', 'Latest Poll Result by Government Site')}</span>
              <Link href="/admin/ingestion/runs" className="text-xs text-sky-700 hover:underline flex items-center gap-1">
                <span>{t('ดูประวัติทั้งหมด', 'Full run history')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </h3>

            {ing.sites.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                {t('ยังไม่มีหน่วยงานที่ตั้งค่าไว้', 'No government sites configured yet.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-4 font-semibold">{t('หน่วยงาน', 'Site')}</th>
                      <th className="py-2 pr-4 font-semibold">{t('การเปิดใช้งาน', 'State')}</th>
                      <th className="py-2 pr-4 font-semibold">{t('สถานะล่าสุด', 'Last run')}</th>
                      <th className="py-2 pr-4 font-semibold">{t('เวลาเริ่ม', 'Started')}</th>
                      <th className="py-2 font-semibold">{t('ดึง / ใหม่ / อัปเดต / ล้มเหลว', 'Fetched / New / Updated / Failed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ing.sites.map(site => (
                      <tr key={site.siteId} className="border-b border-slate-50 last:border-0">
                        <td className="py-2.5 pr-4 font-semibold text-slate-900">
                          {site.name} <span className="font-mono font-normal text-slate-400">({site.shortCode})</span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full border font-semibold ${
                              site.enabled
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {site.enabled ? t('เปิด', 'Enabled') : t('ปิด', 'Disabled')}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {site.lastRun ? (
                            <RunStatusBadge status={site.lastRun.status} lang={lang} />
                          ) : (
                            <span className="text-slate-400">{t('ยังไม่เคยดึงข้อมูล', 'Never polled')}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-500">
                          {site.lastRun ? formatDateTime(site.lastRun.startedAt, lang) : '-'}
                        </td>
                        <td className="py-2.5 text-slate-700">{site.lastRun ? runCounts(site.lastRun) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Admin Actions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-slate-900 text-base flex items-center justify-between border-b border-slate-100 pb-3">
                <span>{t('ระบบจัดการการดึงข้อมูล', 'Ingestion Controls')}</span>
                <Link href="/admin/ingestion" className="text-xs text-sky-700 hover:underline flex items-center gap-1">
                  <span>{t('เข้าจัดการ', 'Manage')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </h3>
              <p className="text-xs text-slate-500">
                {t(
                  'ตั้งค่าช่วงเวลา สโคปหน่วยงาน และการทริกเกอร์ Poll Now พร้อมระบบ Concurrency Guard',
                  'Configure intervals, site scope and Poll Now, with a concurrency guard.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/ingestion" className="px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold transition-colors">
                  {t('ตั้งค่ากำหนดเวลา (Schedule)', 'Schedule')}
                </Link>
                <Link href="/admin/ingestion/runs" className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">
                  {t('ดูประวัติ Run Log', 'Run history')}
                </Link>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-slate-900 text-base flex items-center justify-between border-b border-slate-100 pb-3">
                <span>{t('จัดการคำศัพท์แท็ก', 'Tag Vocabulary')}</span>
                <Link href="/admin/tags" className="text-xs text-sky-700 hover:underline flex items-center gap-1">
                  <span>{t('จัดการคลังแท็ก', 'Manage Tags')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </h3>
              <p className="text-xs text-slate-500">
                {t(
                  'นิยามคำพ้องความหมาย (Synonyms) และปลดระวางแท็กที่ไม่ใช้งาน พร้อมบันทึก Audit Log',
                  'Define synonyms and retire unused tags, with an audit trail.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/tags" className="px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold transition-colors">
                  {t('คลังแท็กหลัก', 'Tag vocabulary')}
                </Link>
                <Link href="/admin/audit-log" className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">
                  {t('ดู Audit Trail', 'Audit trail')}
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
