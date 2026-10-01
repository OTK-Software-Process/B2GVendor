'use client';

import React from 'react';
import { useApp, AppLang } from '@/context/AppContext';
import { BackendActivePollJob } from '@/lib/backend';
import { canManagePolling } from '@/lib/adminAccess';
import { Loader2, AlertTriangle, X } from 'lucide-react';

function timeOf(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function describeJob(job: BackendActivePollJob, lang: AppLang): string {
  const target =
    job.scope === 'all'
      ? lang === 'en' ? 'all enabled departments' : 'ทุกหน่วยงานที่เปิดใช้งาน'
      : job.siteName ?? (lang === 'en' ? 'one department' : 'หน่วยงานเดียว');
  const trigger =
    job.trigger === 'scheduler'
      ? lang === 'en' ? 'scheduled' : 'ตามตารางเวลา'
      : lang === 'en' ? 'manual' : 'สั่งด้วยมือ';
  const state =
    job.status === 'queued'
      ? lang === 'en' ? 'waiting for the worker' : 'รอคิว'
      : lang === 'en' ? 'running' : 'กำลังทำงาน';
  const since = timeOf(job.claimedAt ?? job.createdAt);

  return `${target} · ${trigger} · ${state}${since ? ` · ${lang === 'en' ? 'since' : 'ตั้งแต่'} ${since}` : ''}`;
}

// Shown at the top of every admin page. The "in progress" state comes from the
// server, so this is what tells an admin -- on any account, right after a page
// refresh, from any tab -- that a poll is still working in the background.
export function PollStatusBanner() {
  const { lang, role, account, isPolling, pollStatus, pollError, clearPollError } = useApp();

  // Only the roles that can run polls get this box; a Tag Admin has nothing to do with it.
  if (!canManagePolling(role, account?.permissions)) return null;
  if (!isPolling && !pollError) return null;

  return (
    <div className="space-y-3">
      {pollError && (
        <div role="alert" className="flex items-start gap-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-2xl p-4 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="flex-1">{pollError}</p>
          <button onClick={clearPollError} aria-label={lang === 'en' ? 'Dismiss' : 'ปิด'} className="text-rose-400 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isPolling && (
        <div role="status" aria-live="polite" className="flex items-start gap-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl p-4 text-xs">
          <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
          <div className="space-y-1">
            <p className="font-bold">
              {lang === 'en'
                ? 'A poll is running in the background — Poll Now is locked for every admin until it finishes.'
                : 'กำลังดึงข้อมูลอยู่เบื้องหลัง — ปุ่ม Poll Now ถูกล็อกสำหรับผู้ดูแลทุกคนจนกว่าจะเสร็จ'}
            </p>
            {pollStatus.activeJobs.map(job => (
              <p key={job.id} className="text-amber-700/90">
                {describeJob(job, lang)}
              </p>
            ))}
            <p className="text-amber-700/70">
              {lang === 'en' ? 'You can leave or refresh this page — it keeps running.' : 'ออกจากหน้านี้หรือรีเฟรชได้ ระบบยังทำงานต่อ'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
