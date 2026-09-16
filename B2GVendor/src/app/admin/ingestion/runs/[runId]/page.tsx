'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { ArrowLeft, RefreshCw, FileText, Loader2 } from 'lucide-react';
import { fetchIngestionRunById, toIngestionRun } from '@/lib/backend';
import { IngestionRun } from '@/lib/mock-data';

export default function IngestionRunDetailPage() {
  const params = useParams();
  const runId = Array.isArray(params.runId) ? params.runId[0] : params.runId;
  const { lang, ingestionRuns } = useApp();

  // Prefer whatever's already in context (came from the list page, so it's
  // already fresh) -- only hit the API directly when this page was opened
  // on its own (a shared link, a bookmark, a refresh) and the run isn't
  // there yet.
  const fromContext = ingestionRuns.find(r => r.runId === runId);
  const [fetched, setFetched] = useState<IngestionRun | null>(null);
  const [notFound, setNotFound] = useState(false);
  const run = fromContext ?? fetched;

  useEffect(() => {
    if (fromContext || !runId) return;
    fetchIngestionRunById(runId)
      .then(backendRun => setFetched(toIngestionRun(backendRun)))
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, fromContext]);

  if (!run) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        {notFound ? (
          <span>{lang === 'en' ? 'Run not found.' : 'ไม่พบข้อมูลรอบการดึงข้อมูลนี้'}</span>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{lang === 'en' ? 'Loading run…' : 'กำลังโหลดข้อมูล…'}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link
        href="/admin/ingestion/runs"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-sky-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{lang === 'en' ? 'Back to Run History' : 'กลับสู่ประวัติ Run History'}</span>
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-mono font-bold text-slate-900">
                Run Detail #{run.runId}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                run.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                run.status === 'WARNING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                run.status === 'FAILED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                'bg-sky-50 text-sky-700 border-sky-200'
              }`}>
                {run.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Started at {run.startTime} • Duration: {run.duration}
            </p>
          </div>

          {run.failedCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 max-w-xs">
              <RefreshCw className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span>
                {lang === 'en'
                  ? 'Failed items are retried automatically on the next poll of this site -- no manual action needed.'
                  : 'รายการที่ล้มเหลวจะถูกลองใหม่อัตโนมัติในรอบดึงข้อมูลถัดไปของหน่วยงานนี้ -- ไม่ต้องสั่งด้วยมือ'}
              </span>
            </div>
          )}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center font-mono">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-400 block uppercase">Fetched</span>
            <span className="text-lg font-bold text-slate-900">{run.fetchedCount}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-400 block uppercase">New</span>
            <span className="text-lg font-bold text-emerald-600">+{run.newCount}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-400 block uppercase">Updated</span>
            <span className="text-lg font-bold text-amber-600">^{run.updatedCount}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-400 block uppercase">Skipped</span>
            <span className="text-lg font-bold text-slate-500">{run.skippedCount}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-400 block uppercase">Failed</span>
            <span className="text-lg font-bold text-rose-600">{run.failedCount}</span>
          </div>
        </div>
      </div>

      {/* Per-site breakdown */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 text-sm font-bold text-slate-900">
          {lang === 'en' ? 'Breakdown by Government Site' : 'สรุปผลแยกตามหน่วยงานภาครัฐ'}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Site' : 'หน่วยงาน'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Fetched' : 'ดึงได้'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'New' : 'ใหม่'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Updated' : 'อัปเดต'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Failed' : 'ล้มเหลว'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {run.siteBreakdown.map(s => (
                <tr key={s.siteId} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-bold text-slate-900">{s.siteName}</td>
                  <td className="p-4 text-center font-mono text-slate-900">{s.fetchedCount}</td>
                  <td className="p-4 text-center font-mono text-emerald-600">+{s.newCount}</td>
                  <td className="p-4 text-center font-mono text-amber-600">^{s.updatedCount}</td>
                  <td className="p-4 text-center font-mono text-rose-600">{s.failedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Realtime Execution Log Console */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 text-slate-700 font-bold">
          <FileText className="w-4 h-4 text-sky-600" />
          <span>Execution Log Console Trace</span>
        </div>

        <div className="bg-slate-900 p-4 rounded-2xl space-y-2 border border-slate-800 text-slate-200 max-h-96 overflow-y-auto">
          {run.logs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <span className="text-slate-500 shrink-0">{log.time}</span>
              <span className={`font-bold shrink-0 ${
                log.level === 'INFO' ? 'text-emerald-400' : log.level === 'WARN' ? 'text-amber-400' : 'text-rose-400'
              }`}>
                [{log.level}]
              </span>
              <span className="text-slate-200">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
