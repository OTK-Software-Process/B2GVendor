'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { IngestionTabs } from '@/components/IngestionTabs';
import { RefreshCw, Play, Pause, Lock, Clock, CheckCircle2, Info } from 'lucide-react';

const PRESET_CRON: Record<string, string> = {
  '5m': '*/5 * * * *',
  '15m': '*/15 * * * *',
  '30m': '*/30 * * * *',
  '1h': '0 * * * *'
};

function describeCron(cron: string, lang: 'th' | 'en'): string {
  const trimmed = cron.trim();
  const everyNMinutes = trimmed.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyNMinutes) {
    const n = everyNMinutes[1];
    return lang === 'en' ? `Runs every ${n} minutes` : `รันทุก ${n} นาที`;
  }
  if (trimmed === '0 * * * *') {
    return lang === 'en' ? 'Runs once every hour, on the hour' : 'รันทุกชั่วโมง ณ นาทีที่ 0';
  }
  const everyNHours = trimmed.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyNHours) {
    const n = everyNHours[1];
    return lang === 'en' ? `Runs every ${n} hours` : `รันทุก ${n} ชั่วโมง`;
  }
  return lang === 'en' ? "Custom schedule — double-check this before saving" : 'ตารางเวลากำหนดเอง — โปรดตรวจสอบก่อนบันทึก';
}

export default function IngestionControlPage() {
  const { lang, isPolling, triggerPollNow, govSites } = useApp();
  const [scheduleActive, setScheduleActive] = useState(true);
  const [preset, setPreset] = useState('15m');
  const [cron, setCron] = useState(PRESET_CRON['15m']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [pollTarget, setPollTarget] = useState('ALL');

  const handlePresetChange = (value: string) => {
    setPreset(value);
    setCron(PRESET_CRON[value]);
  };

  const handleSaveSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

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

      {savedNotice && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{lang === 'en' ? 'Scheduler settings updated successfully!' : 'บันทึกการตั้งค่าตารางเวลา Poller สำเร็จ!'}</span>
        </div>
      )}

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
                  <span>Locked</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'en'
                ? 'Immediately polls api.data.go.th for the selected government site(s). Blocked while a scheduled run for the same site is already in progress, so runs never overlap.'
                : 'สั่งดึงข้อมูลจาก api.data.go.th สำหรับหน่วยงานที่เลือกทันที ระบบจะไม่ให้กดซ้ำขณะมีรอบดึงข้อมูลของหน่วยงานเดียวกันทำงานอยู่ เพื่อไม่ให้ชนกัน'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pollTarget}
              onChange={(e) => setPollTarget(e.target.value)}
              disabled={isPolling}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-hidden focus:border-sky-400 font-semibold"
            >
              <option value="ALL">{lang === 'en' ? 'All enabled sites' : 'ทุกหน่วยงานที่เปิดใช้งาน'}</option>
              {govSites.filter(s => s.enabled).map(site => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>

            <button
              onClick={() => triggerPollNow(pollTarget === 'ALL' ? undefined : pollTarget)}
              disabled={isPolling}
              className={`px-6 py-3 rounded-2xl font-extrabold text-sm flex items-center gap-2 transition-all duration-150 ${
                isPolling
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed'
                  : 'bg-sky-600 hover:bg-sky-700 text-white'
              }`}
            >
              <RefreshCw className={`w-5 h-5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>
                {isPolling
                  ? (lang === 'en' ? 'Poller Running & Locked...' : 'กำลังดึงข้อมูล (ล็อกการทำงานซ้ำ)...')
                  : (lang === 'en' ? 'Poll Now' : 'สั่ง Poll Now ทันที')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Scheduler Configuration Form */}
      <form onSubmit={handleSaveSchedule} className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-sky-600" />
              <span>{lang === 'en' ? 'Automatic Schedule' : 'ตารางเวลาอัตโนมัติ'}</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {lang === 'en' ? 'Applies to every enabled government site — manage the site list itself in Source Configuration.' : 'มีผลกับทุกหน่วยงานที่เปิดใช้งาน จัดการรายชื่อหน่วยงานได้ที่หน้าการตั้งค่าแหล่งข้อมูล'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setScheduleActive(!scheduleActive)}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all duration-150 ${
              scheduleActive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
          >
            {scheduleActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{scheduleActive ? (lang === 'en' ? 'Running (pause)' : 'กำลังทำงาน (คลิกพัก)') : (lang === 'en' ? 'Paused (resume)' : 'หยุดอยู่ (คลิกเปิด)')}</span>
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-2">
            {lang === 'en' ? 'How often should it poll automatically?' : 'ต้องการให้ดึงข้อมูลอัตโนมัติบ่อยแค่ไหน?'}
          </label>
          <select
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="w-full max-w-sm bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
          >
            <option value="5m">{lang === 'en' ? 'Every 5 minutes' : 'ทุก 5 นาที'}</option>
            <option value="15m">{lang === 'en' ? 'Every 15 minutes (recommended)' : 'ทุก 15 นาที (แนะนำ)'}</option>
            <option value="30m">{lang === 'en' ? 'Every 30 minutes' : 'ทุก 30 นาที'}</option>
            <option value="1h">{lang === 'en' ? 'Every hour' : 'ทุก 1 ชั่วโมง'}</option>
          </select>
          <p className="text-xs text-slate-400 mt-2">
            {lang === 'en' ? describeCron(cron, 'en') : describeCron(cron, 'th')}
          </p>
        </div>

        {/* Advanced: cron override, hidden by default */}
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs font-semibold text-sky-700 hover:underline"
          >
            {showAdvanced
              ? (lang === 'en' ? 'Hide advanced schedule' : 'ซ่อนตารางเวลาขั้นสูง')
              : (lang === 'en' ? 'Need a custom interval? Set an advanced schedule' : 'ต้องการรอบเวลาที่ไม่มีในตัวเลือก? ตั้งค่าขั้นสูง')}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-2 animate-fade-in">
              <label className="block text-xs font-bold text-slate-600">
                {lang === 'en' ? 'Cron expression' : 'รูปแบบ Cron Expression'}
              </label>
              <input
                type="text"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="w-full max-w-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-900 outline-hidden focus:border-sky-400"
              />
              <div className="flex items-start gap-1.5 text-xs text-slate-500 max-w-md">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <p>
                  {lang === 'en'
                    ? 'A cron expression is 5 fields — minute, hour, day, month, weekday — separated by spaces, where * means "every". Most admins never need to touch this; the dropdown above covers the common cases.'
                    : 'Cron Expression คือรูปแบบ 5 ช่อง (นาที ชั่วโมง วัน เดือน วันในสัปดาห์) คั่นด้วยเว้นวรรค เครื่องหมาย * แปลว่า "ทุกค่า" ผู้ดูแลส่วนใหญ่ไม่จำเป็นต้องแก้ไขส่วนนี้ ใช้ตัวเลือกด้านบนก็เพียงพอ'}
                </p>
              </div>
              <p className="text-xs font-semibold text-sky-700">
                {describeCron(cron, lang)}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition-colors duration-150"
          >
            {lang === 'en' ? 'Save Schedule' : 'บันทึกตารางเวลา'}
          </button>
        </div>
      </form>
    </div>
  );
}
