'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { GovSiteItem, SiteLastRun } from '@/lib/mock-data';
import { formatDateTime, formatCountdown, describeInterval } from '@/lib/datetime';
import { Clock } from 'lucide-react';

const RUN_STATUS_STYLE: Record<SiteLastRun['status'], { box: string; th: string; en: string }> = {
  success: { box: 'bg-emerald-50 text-emerald-700 border-emerald-200', th: 'สำเร็จ', en: 'Success' },
  partial: { box: 'bg-amber-50 text-amber-700 border-amber-200', th: 'บางส่วน', en: 'Partial' },
  failed: { box: 'bg-rose-50 text-rose-700 border-rose-200', th: 'ล้มเหลว', en: 'Failed' },
  running: { box: 'bg-sky-50 text-sky-700 border-sky-200', th: 'กำลังทำงาน', en: 'Running' }
};

const SOURCE_LABEL: Record<SiteLastRun['source'], string> = { rss: 'e-GP RSS', data_go_th: 'data.go.th' };

// One department's real polling state, for the Source Config list: how its most
// recent poll went (counts come straight from the run record) and when the
// schedule will next poll it. Read-only -- enabling/disabling is the row's
// action button.
export function SitePollInfo({ site }: { site: GovSiteItem }) {
  const { lang } = useApp();
  const run = site.lastRun;
  const runStyle = run ? RUN_STATUS_STYLE[run.status] : null;

  return (
    <div className="space-y-1.5 min-w-[200px] font-normal">
      <div>
        {run && runStyle ? (
          <>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border font-bold text-[11px] ${runStyle.box}`}>
              {lang === 'en' ? runStyle.en : runStyle.th}
            </span>
            <span className="ml-2 font-mono text-[11px] text-slate-600">
              +{run.newCount} ^{run.updatedCount}
              {run.failedCount > 0 ? ` x${run.failedCount}` : ''}
            </span>
            <span className="block mt-0.5 text-[11px] text-slate-400">
              {SOURCE_LABEL[run.source]} · {formatDateTime(run.startedAt, lang)}
            </span>
          </>
        ) : (
          <span className="text-slate-400">{lang === 'en' ? 'Never polled yet' : 'ยังไม่เคยดึงข้อมูล'}</span>
        )}
      </div>

      <div className="flex items-start gap-1 text-[11px] text-slate-500">
        <Clock className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
        {site.enabled && site.nextRunAt ? (
          <span>
            {lang === 'en' ? 'Next: ' : 'รอบถัดไป: '}
            {formatCountdown(site.nextRunAt, lang)}
            <span className="block text-slate-400">{formatDateTime(site.nextRunAt, lang)}</span>
          </span>
        ) : (
          <span className="text-slate-400">
            {!site.enabled
              ? lang === 'en' ? 'Skipped while disabled' : 'ข้ามขณะปิดใช้งาน'
              : lang === 'en' ? 'Schedule paused' : 'ตารางเวลาหยุดอยู่'}
          </span>
        )}
      </div>

      {site.pollIntervalMinutes ? (
        <span className="inline-block text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md">
          {lang === 'en' ? 'own interval: ' : 'รอบเฉพาะ: '}
          {describeInterval(site.pollIntervalMinutes, lang)}
        </span>
      ) : null}
    </div>
  );
}
