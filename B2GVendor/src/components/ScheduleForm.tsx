'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatCountdown, describeInterval, minutesToHours } from '@/lib/datetime';
import { Clock, Pause, Play, CheckCircle2, AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react';

const PRESET_HOURS = [2, 6, 12, 24, 48];

// Admin > Data Ingestion > Automatic Schedule. The interval and the
// pause/resume switch are saved to the server (PATCH /admin/ingestion/settings)
// and used by the worker's scheduler -- nothing here is decorative. The floor
// (2 hours) is validated here for instant feedback AND enforced by the API, so
// it can't be bypassed.
export function ScheduleForm() {
  const { lang, role, schedule, refreshSchedule, saveSchedule } = useApp();

  // What the admin has typed but not saved yet (null = show the saved value).
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  if (!schedule) {
    return (
      <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{lang === 'en' ? 'Loading the schedule…' : 'กำลังโหลดตารางเวลา…'}</span>
          <button onClick={() => refreshSchedule()} className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Retry' : 'ลองใหม่'}</span>
          </button>
        </div>
      </section>
    );
  }

  const minHours = minutesToHours(schedule.minIntervalMinutes);
  const maxHours = minutesToHours(schedule.maxIntervalMinutes);
  const savedHours = minutesToHours(schedule.pollIntervalMinutes);
  const text = draft ?? String(savedHours);

  // Client-side validation, mirroring the API's rules.
  let validationError: string | null = null;
  const parsed = Number(text);
  if (text.trim() === '' || !Number.isFinite(parsed)) {
    validationError = lang === 'en' ? 'Enter the interval as a number of hours.' : 'กรอกช่วงเวลาเป็นจำนวนชั่วโมง';
  } else if (parsed < minHours) {
    validationError =
      lang === 'en'
        ? `The interval can't be lower than ${minHours} hours.`
        : `ช่วงเวลาต้องไม่ต่ำกว่า ${minHours} ชั่วโมง`;
  } else if (parsed > maxHours) {
    validationError =
      lang === 'en'
        ? `The interval can't be longer than ${maxHours} hours (30 days).`
        : `ช่วงเวลาต้องไม่เกิน ${maxHours} ชั่วโมง (30 วัน)`;
  }

  const minutes = Math.round(parsed * 60);
  const unchanged = validationError === null && minutes === schedule.pollIntervalMinutes;
  const canSave = validationError === null && !unchanged && !saving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setServerError(null);
    setSavedNotice(null);
    try {
      await saveSchedule({ pollIntervalMinutes: minutes });
      setDraft(null);
      setSavedNotice(lang === 'en' ? `Saved — polling ${describeInterval(minutes, 'en').toLowerCase()}.` : `บันทึกแล้ว — ${describeInterval(minutes, 'th')}`);
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? err.fields?.pollIntervalMinutes ?? err.message
          : lang === 'en' ? 'Could not save the schedule. Please try again.' : 'บันทึกตารางเวลาไม่สำเร็จ กรุณาลองใหม่'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    setServerError(null);
    setSavedNotice(null);
    try {
      await saveSchedule({ scheduleEnabled: !schedule.scheduleEnabled });
      setSavedNotice(
        schedule.scheduleEnabled
          ? lang === 'en' ? 'Automatic polling paused. Poll Now still works.' : 'หยุดการดึงข้อมูลอัตโนมัติแล้ว (Poll Now ยังใช้ได้)'
          : lang === 'en' ? 'Automatic polling resumed.' : 'เปิดการดึงข้อมูลอัตโนมัติต่อแล้ว'
      );
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : lang === 'en' ? 'Could not change the schedule.' : 'เปลี่ยนสถานะตารางเวลาไม่สำเร็จ');
    } finally {
      setToggling(false);
    }
  };

  return (
    <form onSubmit={handleSave} noValidate className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-sky-600" />
            <span>{lang === 'en' ? 'Automatic Schedule' : 'ตารางเวลาอัตโนมัติ'}</span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {lang === 'en'
              ? 'Applies to every enabled department — choose which ones in '
              : 'มีผลกับทุกหน่วยงานที่เปิดใช้งาน — เลือกหน่วยงานได้ที่หน้า'}
            {/* Source Configuration is Super Admin only: link it only for them. */}
            {role === 'superadmin' ? (
              <Link href="/admin/source-config" className="font-semibold text-sky-700 hover:underline">
                {lang === 'en' ? 'Source Configuration' : 'การตั้งค่าแหล่งข้อมูล'}
              </Link>
            ) : (
              <span>{lang === 'en' ? 'Source Configuration' : 'การตั้งค่าแหล่งข้อมูล'}</span>
            )}
            {lang === 'en' ? '.' : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleEnabled}
          disabled={toggling}
          className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all duration-150 disabled:opacity-60 ${
            schedule.scheduleEnabled
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}
        >
          {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : schedule.scheduleEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>
            {schedule.scheduleEnabled
              ? lang === 'en' ? 'Running (click to pause)' : 'กำลังทำงาน (คลิกพัก)'
              : lang === 'en' ? 'Paused (click to resume)' : 'หยุดอยู่ (คลิกเปิด)'}
          </span>
        </button>
      </div>

      {savedNotice && (
        <div role="status" className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 p-3 rounded-2xl text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div>
        <label htmlFor="poll-interval-hours" className="block text-xs font-bold text-slate-600 mb-2">
          {lang === 'en' ? 'How often should it poll automatically? (hours)' : 'ต้องการให้ดึงข้อมูลอัตโนมัติทุกกี่ชั่วโมง?'}
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <input
            id="poll-interval-hours"
            type="number"
            inputMode="decimal"
            step="any"
            min={minHours}
            max={maxHours}
            value={text}
            onChange={e => {
              setDraft(e.target.value);
              setSavedNotice(null);
              setServerError(null);
            }}
            aria-invalid={validationError !== null}
            aria-describedby="poll-interval-help"
            className={`w-32 bg-white border rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden ${
              validationError ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-sky-400'
            }`}
          />
          <span className="text-sm text-slate-500">{lang === 'en' ? 'hours' : 'ชั่วโมง'}</span>

          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_HOURS.map(hours => (
              <button
                key={hours}
                type="button"
                onClick={() => {
                  setDraft(String(hours));
                  setSavedNotice(null);
                  setServerError(null);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                  parsed === hours ? 'bg-sky-50 text-sky-700 border-sky-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {hours} {lang === 'en' ? 'h' : 'ชม.'}
                {hours * 60 === schedule.defaultIntervalMinutes ? (lang === 'en' ? ' (default)' : ' (ค่าเริ่มต้น)') : ''}
              </button>
            ))}
          </div>
        </div>

        <p id="poll-interval-help" className={`text-xs mt-2 ${validationError ? 'text-rose-600 font-semibold' : 'text-slate-400'}`} role={validationError ? 'alert' : undefined}>
          {validationError ??
            (lang === 'en'
              ? `Minimum ${minHours} hours · default ${minutesToHours(schedule.defaultIntervalMinutes)} hours.`
              : `ต่ำสุด ${minHours} ชั่วโมง · ค่าเริ่มต้น ${minutesToHours(schedule.defaultIntervalMinutes)} ชั่วโมง`)}
        </p>
        {serverError && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600 font-semibold mt-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{serverError}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 pt-2 border-t border-slate-100">
        <div className="flex items-start gap-1.5 text-xs text-slate-500 max-w-md">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>
            {schedule.scheduleEnabled
              ? lang === 'en'
                ? schedule.nextRunAt
                  ? `Currently ${describeInterval(schedule.pollIntervalMinutes, 'en').toLowerCase()}. Next automatic poll ${formatCountdown(schedule.nextRunAt, 'en')} (${formatDateTime(schedule.nextRunAt, 'en')}).`
                  : `Currently ${describeInterval(schedule.pollIntervalMinutes, 'en').toLowerCase()}. No department is enabled, so nothing will be polled.`
                : schedule.nextRunAt
                  ? `ตอนนี้${describeInterval(schedule.pollIntervalMinutes, 'th')} รอบอัตโนมัติถัดไป ${formatCountdown(schedule.nextRunAt, 'th')} (${formatDateTime(schedule.nextRunAt, 'th')})`
                  : `ตอนนี้${describeInterval(schedule.pollIntervalMinutes, 'th')} แต่ยังไม่มีหน่วยงานที่เปิดใช้งาน จึงไม่มีการดึงข้อมูล`
              : lang === 'en'
                ? 'The schedule is paused — no automatic polls will start until you resume it. Poll Now still works.'
                : 'ตารางเวลาหยุดอยู่ — จะไม่มีการดึงข้อมูลอัตโนมัติจนกว่าจะเปิดใหม่ (Poll Now ยังใช้ได้)'}
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSave}
          className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{lang === 'en' ? 'Save Schedule' : 'บันทึกตารางเวลา'}</span>
        </button>
      </div>
    </form>
  );
}
