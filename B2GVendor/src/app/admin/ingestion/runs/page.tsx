'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { History, ChevronRight, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { IngestionTabs } from '@/components/IngestionTabs';
import { BackendIngestionRunStatus } from '@/lib/backend';

// UI status labels (SUCCESS/WARNING/FAILED) -> the backend's own vocabulary
// (success/partial/failed), since filtering now happens server-side.
const STATUS_TO_BACKEND: Record<string, BackendIngestionRunStatus | undefined> = {
  ALL: undefined,
  SUCCESS: 'success',
  WARNING: 'partial',
  FAILED: 'failed'
};

export default function IngestionRunHistoryPage() {
  const { lang, ingestionRuns, refreshIngestionRuns, govSites } = useApp();
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterSite, setFilterSite] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show the loading state for the refetch this effect triggers on every filter change.
    setLoading(true);
    refreshIngestionRuns({
      siteId: filterSite === 'ALL' ? undefined : filterSite,
      status: STATUS_TO_BACKEND[filterStatus],
      startDate: startDate || undefined,
      endDate: endDate || undefined
    })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSite, filterStatus, startDate, endDate]);

  const filteredRuns = ingestionRuns;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <History className="w-6 h-6 text-sky-600" />
          <span>{lang === 'en' ? 'Data Ingestion' : 'การดึงข้อมูล'}</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {lang === 'en' ? 'Trigger polls, set a schedule, and review what each run found' : 'สั่งดึงข้อมูล ตั้งตารางเวลา และดูผลของแต่ละรอบ'}
        </p>
      </div>

      {/* Sub-navigation */}
      <div className="border-b border-slate-200">
        <IngestionTabs />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500">
          {lang === 'en' ? 'Fetched, new, updated, skipped, and failed counts for each poll.' : 'จำนวนรายการที่ดึงได้ ใหม่ อัปเดต ข้าม และล้มเหลวของแต่ละรอบ'}
        </p>

        <div className="flex items-center gap-2">
          {/* Site Filter */}
          <select
            value={filterSite}
            onChange={(e) => setFilterSite(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-hidden focus:border-sky-400"
          >
            <option value="ALL">-- {lang === 'en' ? 'All Government Sites' : 'ทุกหน่วยงาน'} --</option>
            {govSites.map(site => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-hidden focus:border-sky-400"
          >
            <option value="ALL">-- {lang === 'en' ? 'All Statuses' : 'ทุกสถานะ'} --</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="WARNING">WARNING</option>
            <option value="FAILED">FAILED</option>
          </select>

          {/* Date range filter -- inclusive, over startedAt */}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            max={endDate || undefined}
            aria-label={lang === 'en' ? 'From date' : 'ตั้งแต่วันที่'}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-hidden focus:border-sky-400"
          />
          <span className="text-xs text-slate-400">{lang === 'en' ? 'to' : 'ถึง'}</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate || undefined}
            aria-label={lang === 'en' ? 'To date' : 'ถึงวันที่'}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-hidden focus:border-sky-400"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="text-xs font-bold text-slate-400 hover:text-sky-700 transition-colors"
            >
              {lang === 'en' ? 'Clear dates' : 'ล้างวันที่'}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Run ID' : 'รหัสรอบ (Run ID)'}</th>
                <th className="p-4">{lang === 'en' ? 'Sites Polled' : 'หน่วยงานที่ดึงข้อมูล'}</th>
                <th className="p-4">{lang === 'en' ? 'Start / End Time' : 'เวลาเริ่มต้น-สิ้นสุด'}</th>
                <th className="p-4">{lang === 'en' ? 'Duration' : 'ระยะเวลา'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Fetched / New / Upd / Fail' : 'ดึงได้ / ใหม่ / อัปเดต / ล้มเหลว'}</th>
                <th className="p-4">{lang === 'en' ? 'Status' : 'สถานะ'}</th>
                <th className="p-4 text-right">{lang === 'en' ? 'Action' : 'จัดการ'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {loading && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{lang === 'en' ? 'Loading run history…' : 'กำลังโหลดประวัติการดึงข้อมูล…'}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && filteredRuns.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    {lang === 'en' ? 'No runs yet -- trigger a poll from the Ingestion tab.' : 'ยังไม่มีประวัติการดึงข้อมูล -- ลองสั่ง Poll Now จากแท็บการดึงข้อมูล'}
                  </td>
                </tr>
              )}
              {filteredRuns.map(run => (
                <tr key={run.runId} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-mono font-bold text-slate-900">
                    {run.runId}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {run.siteBreakdown.map(s => (
                        <span key={s.siteId} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                          {govSites.find(g => g.id === s.siteId)?.shortCode ?? s.siteName}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-slate-600">
                    <div>{run.startTime}</div>
                    <div className="text-[10px] text-slate-400">{run.endTime}</div>
                  </td>
                  <td className="p-4 text-slate-500 font-mono">
                    {run.duration}
                  </td>
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center gap-2 font-mono">
                      <span className="text-slate-900 font-bold">{run.fetchedCount}</span>
                      <span className="text-emerald-600">+{run.newCount}</span>
                      <span className="text-amber-600">^{run.updatedCount}</span>
                      <span className="text-rose-600">x{run.failedCount}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                      run.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      run.status === 'WARNING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {run.status === 'SUCCESS' && <CheckCircle2 className="w-3 h-3" />}
                      {run.status === 'WARNING' && <AlertTriangle className="w-3 h-3" />}
                      {run.status === 'FAILED' && <XCircle className="w-3 h-3" />}
                      <span>{run.status}</span>
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <Link
                      href={`/admin/ingestion/runs/${run.runId}`}
                      className="inline-flex items-center gap-1 font-bold text-sky-700 hover:underline"
                    >
                      <span>{lang === 'en' ? 'Log Details' : 'ดูรายละเอียด Log'}</span>
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
