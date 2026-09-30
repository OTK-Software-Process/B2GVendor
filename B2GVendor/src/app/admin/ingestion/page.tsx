'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { IngestionTabs } from '@/components/IngestionTabs';
import { ScheduleForm } from '@/components/ScheduleForm';
import { RefreshCw, Lock } from 'lucide-react';

export default function IngestionControlPage() {
  const { lang, isPolling, triggerPollNow, govSites } = useApp();
  const [pollTarget, setPollTarget] = useState('ALL');

  const enabledSites = govSites.filter(s => s.enabled);
  // A department that was switched off (or removed) while selected falls back
  // to "all enabled" instead of polling something that's now disabled.
  const effectiveTarget = enabledSites.some(s => s.id === pollTarget) ? pollTarget : 'ALL';
  const nothingToPoll = enabledSites.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-sky-600" />
          <span>{lang === 'en' ? 'Data Ingestion' : 'การดึงข้อมูล'}</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {lang === 'en' ? 'Trigger polls, set a schedule, and review what each run found' : 'สั่งดึงข้อมูล ตั้งตารางเวลา และดูผลของแต่ละรอบ'}
        </p>
      </div>

      {/* Sub-navigation: makes clear Run History is part of this same section */}
      <div className="border-b border-slate-200">
        <IngestionTabs />
      </div>

      {/* Manual Trigger Hero Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'en' ? 'Manual Poll Trigger' : 'การสั่งดึงข้อมูลด้วยมือ (Poll Now)'}
              </h2>
              {isPolling && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                  <Lock className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Locked · running in background' : 'ล็อก · กำลังทำงานเบื้องหลัง'}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 max-w-xl">
              {lang === 'en'
                ? 'Starts a poll of the selected department(s) in the background — you can leave or refresh this page. Only one poll runs at a time: the button stays locked for every admin until it finishes.'
                : 'สั่งดึงข้อมูลของหน่วยงานที่เลือกโดยทำงานเบื้องหลัง ออกจากหน้านี้หรือรีเฟรชได้ ระบบให้ทำงานได้ทีละรอบ ปุ่มจะถูกล็อกสำหรับผู้ดูแลทุกคนจนกว่ารอบนี้จะเสร็จ'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={effectiveTarget}
              onChange={(e) => setPollTarget(e.target.value)}
              disabled={isPolling || nothingToPoll}
              aria-label={lang === 'en' ? 'Which departments to poll' : 'เลือกหน่วยงานที่จะดึงข้อมูล'}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-hidden focus:border-sky-400 font-semibold disabled:opacity-60"
            >
              <option value="ALL">{lang === 'en' ? 'All enabled departments' : 'ทุกหน่วยงานที่เปิดใช้งาน'}</option>
              {enabledSites.map(site => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>

            <button
              onClick={() => triggerPollNow(effectiveTarget === 'ALL' ? undefined : effectiveTarget)}
              disabled={isPolling || nothingToPoll}
              title={nothingToPoll ? (lang === 'en' ? 'Enable at least one department in Source Configuration first' : 'เปิดใช้งานอย่างน้อยหนึ่งหน่วยงานที่หน้าการตั้งค่าแหล่งข้อมูลก่อน') : undefined}
              className={`px-6 py-3 rounded-2xl font-extrabold text-sm flex items-center gap-2 transition-all duration-150 ${
                isPolling
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed'
                  : nothingToPoll
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                    : 'bg-sky-600 hover:bg-sky-700 text-white'
              }`}
            >
              <RefreshCw className={`w-5 h-5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>
                {isPolling
                  ? (lang === 'en' ? 'Polling in the background…' : 'กำลังดึงข้อมูลเบื้องหลัง…')
                  : (lang === 'en' ? 'Poll Now' : 'สั่ง Poll Now ทันที')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Automatic schedule: interval (default 24h, min 2h) + pause/resume */}
      <ScheduleForm />
    </div>
  );
}
