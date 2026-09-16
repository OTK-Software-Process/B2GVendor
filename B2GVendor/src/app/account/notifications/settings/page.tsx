'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { fetchNotificationSettings, updateNotificationSettings, setTagPaused, BackendNotificationFrequency } from '@/lib/backend';
import { SlidersHorizontal, Bell, Mail, ShieldCheck, PauseCircle, Save, Loader2, AlertTriangle } from 'lucide-react';

export default function NotificationSettingsPage() {
  const { lang, tags, followedTagIds } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [frequency, setFrequency] = useState<BackendNotificationFrequency>('instant');
  const [pausedTagIds, setPausedTagIds] = useState<string[]>([]);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pausingTagId, setPausingTagId] = useState<string | null>(null);

  const followedTags = tags.filter(t => followedTagIds.includes(t.id));

  useEffect(() => {
    let cancelled = false;
    fetchNotificationSettings()
      .then(settings => {
        if (cancelled) return;
        setEmailEnabled(settings.emailNotificationsEnabled);
        setFrequency(settings.notificationFrequency);
        setPausedTagIds(settings.pausedTagIds);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setIsSaving(true);
    try {
      const updated = await updateNotificationSettings({ emailNotificationsEnabled: emailEnabled, notificationFrequency: frequency });
      setEmailEnabled(updated.emailNotificationsEnabled);
      setFrequency(updated.notificationFrequency);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save notification settings.');
    } finally {
      setIsSaving(false);
    }
  };

  // Per-tag pause applies immediately (like FollowTagButton elsewhere) --
  // not batched into the form's Save button, since it's its own endpoint
  // and leaving a toggled pause un-saved on navigation would be a worse
  // surprise than an unfollow/follow button that didn't need a Save step.
  const togglePauseTag = async (id: string) => {
    const nextPaused = !pausedTagIds.includes(id);
    setPausingTagId(id);
    try {
      await setTagPaused(id, nextPaused);
      setPausedTagIds(prev => (nextPaused ? [...prev, id] : prev.filter(item => item !== id)));
    } catch {
      // Best-effort -- leave state as it was, the button will just show
      // its previous (unchanged) state since we never optimistically set it.
    } finally {
      setPausingTagId(null);
    }
  };

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        {/* Header & Sub-Nav */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <SlidersHorizontal className="w-6 h-6 text-emerald-600" />
              <span>{lang === 'en' ? 'Notification Channel & Frequency Settings' : 'ตั้งค่าช่องทางและความถี่การรับข่าวสาร'}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'en' ? 'Choose in-app / email delivery modes, instant or daily digests, and per-tag pauses' : 'กำหนดรูปแบบการรับแจ้งเตือนทางอีเมล และพักการแจ้งเตือนชั่วคราวเป็นรายแท็ก'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Link href="/account" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Profile' : 'ข้อมูลส่วนตัว'}
            </Link>
            <Link href="/account/interests" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Interests' : 'แท็กที่ติดตาม'}
            </Link>
            <Link href="/account/notifications" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Notifications' : 'การแจ้งเตือน'}
            </Link>
            <Link href="/account/notifications/settings" className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white shadow-2xs">
              {lang === 'en' ? 'Settings' : 'ตั้งค่าช่องทาง'}
            </Link>
          </div>
        </div>

        {loading && (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 flex items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{lang === 'en' ? 'Loading your settings…' : 'กำลังโหลดการตั้งค่า…'}</span>
          </div>
        )}

        {!loading && loadError && (
          <div className="bg-rose-50 text-rose-800 border border-rose-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>{lang === 'en' ? 'Could not load your notification settings. Please refresh the page.' : 'ไม่สามารถโหลดการตั้งค่าการแจ้งเตือนได้ กรุณารีเฟรชหน้านี้'}</span>
          </div>
        )}

        {!loading && !loadError && (
          <>
            {savedNotice && (
              <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{lang === 'en' ? 'Notification preferences saved!' : 'บันทึกการตั้งค่าเรียบร้อยแล้ว!'}</span>
              </div>
            )}

            {saveError && (
              <div className="bg-rose-50 text-rose-800 border border-rose-200 p-4 rounded-2xl text-xs font-bold">
                {saveError}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              {/* Channel Toggles */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  1. {lang === 'en' ? 'Delivery Channels' : 'เลือกช่องทางการรับแจ้งเตือน'}
                </h3>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-3">
                      <Bell className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <span className="text-sm font-bold text-slate-900 block">
                          {lang === 'en' ? 'In-App Notification Center' : 'ศูนย์การแจ้งเตือนในระบบ (In-App)'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {lang === 'en' ? 'Always enabled by default' : 'เปิดใช้งานตลอดเวลาโดยอัตโนมัติ'}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full">
                      Always On
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-3">
                      <Mail className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <span className="text-sm font-bold text-slate-900 block">
                          {lang === 'en' ? 'Email Notifications' : 'การแจ้งเตือนทางอีเมล (Email Alerts)'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {lang === 'en' ? 'Receive alerts at your registered email' : 'ส่งรายงานโครงการใหม่ไปยังอีเมลที่ลงทะเบียน'}
                        </span>
                      </div>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={emailEnabled}
                        onChange={(e) => setEmailEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Frequency Selector */}
              <div className={`bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4 transition-opacity ${emailEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  2. {lang === 'en' ? 'Notification Frequency' : 'ความถี่ในการส่งข้อมูล'}
                  {!emailEnabled && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {lang === 'en' ? '(email notifications are off)' : '(ปิดการแจ้งเตือนทางอีเมลอยู่)'}
                    </span>
                  )}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label
                    onClick={() => setFrequency('instant')}
                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all space-y-2 ${
                      frequency === 'instant'
                        ? 'border-emerald-600 bg-emerald-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900">
                        {lang === 'en' ? 'Instant Alerts' : 'แจ้งเตือนทันที (Instant)'}
                      </span>
                      <input type="radio" name="freq" checked={frequency === 'instant'} readOnly className="accent-emerald-600" />
                    </div>
                    <p className="text-xs text-slate-500">
                      {lang === 'en' ? 'Receive email immediately when a matching work is ingested from a government site poll' : 'ส่งอีเมลทันทีเมื่อตรวจพบประกาศใหม่ที่ตรงกับแท็กที่คุณติดตาม'}
                    </p>
                  </label>

                  <label
                    onClick={() => setFrequency('daily')}
                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all space-y-2 ${
                      frequency === 'daily'
                        ? 'border-emerald-600 bg-emerald-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900">
                        {lang === 'en' ? 'Daily Digest' : 'สรุปรายวัน (Daily Digest)'}
                      </span>
                      <input type="radio" name="freq" checked={frequency === 'daily'} readOnly className="accent-emerald-600" />
                    </div>
                    <p className="text-xs text-slate-500">
                      {lang === 'en' ? 'Receive one summary email every morning at 08:00' : 'รวบรวมทุกโครงการใหม่และส่งสรุปในอีเมลฉบับเดียวเวลา 08:00 น. ทุกวัน'}
                    </p>
                  </label>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors shadow-xs disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSaving ? (lang === 'en' ? 'Saving...' : 'กำลังบันทึก...') : (lang === 'en' ? 'Save Preference Settings' : 'บันทึกการตั้งค่าทั้งหมด')}</span>
                </button>
              </div>
            </form>

            {/* Per-Tag Pause Option -- applies immediately, outside the form above */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center justify-between">
                <span>3. {lang === 'en' ? 'Per-Tag Pause Options' : 'พักการแจ้งเตือนชั่วคราวเป็นรายแท็ก (Pause Option)'}</span>
                <PauseCircle className="w-5 h-5 text-amber-500" />
              </h3>

              {followedTags.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  {lang === 'en' ? "You aren't following any tags yet." : 'คุณยังไม่ได้ติดตามแท็กใดๆ'}
                </p>
              ) : (
                <div className="space-y-2">
                  {followedTags.map(tag => {
                    const isPaused = pausedTagIds.includes(tag.id);
                    const isBusy = pausingTagId === tag.id;
                    return (
                      <div key={tag.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                        <span className="font-bold text-slate-900">#{tag.name}</span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => togglePauseTag(tag.id)}
                          className={`px-3 py-1 rounded-lg font-bold transition-all disabled:opacity-60 ${
                            isPaused
                              ? 'bg-amber-500 text-white shadow-2xs'
                              : 'bg-slate-200 text-slate-700 hover:bg-amber-100 hover:text-amber-800'
                          }`}
                        >
                          {isBusy ? (lang === 'en' ? 'Saving…' : 'กำลังบันทึก…') : isPaused ? (lang === 'en' ? 'Paused' : 'พักการแจ้งเตือนอยู่') : (lang === 'en' ? 'Active' : 'ทำงานปกติ')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
