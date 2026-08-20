'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { StatusBadge } from '@/components/StatusBadge';
import { useApp } from '@/context/AppContext';
import { Bell, CheckCheck, ExternalLink, Filter, Tag, Calendar, Building2 } from 'lucide-react';

export default function AccountNotificationsPage() {
  const { lang, notifications, markNotificationAsRead, markAllNotificationsAsRead, unreadCount } = useApp();
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);

  const filteredNotifications = filterUnreadOnly
    ? notifications.filter(n => !n.read)
    : notifications;

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        {/* Header & Sub-Nav */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
                <Bell className="w-6 h-6 text-emerald-600" />
                <span>{lang === 'en' ? 'In-App Notification Center' : 'ศูนย์การแจ้งเตือนในแอป'}</span>
              </h1>
              {unreadCount > 0 && (
                <span className="bg-rose-600 text-white font-extrabold text-xs px-2.5 py-0.5 rounded-full">
                  {unreadCount} {lang === 'en' ? 'unread' : 'ยังไม่ได้อ่าน'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'en' ? 'Direct deep-links to matching procurement works derived from your followed tags' : 'การแจ้งเตือนงานใหม่และสถานะที่เปลี่ยนแปลงตามแท็กที่คุณเลือกติดตามพร้อม Deep-link'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Link href="/account" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Profile' : 'ข้อมูลส่วนตัว'}
            </Link>
            <Link href="/account/interests" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Interests' : 'แท็กที่ติดตาม'}
            </Link>
            <Link href="/account/notifications" className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white shadow-2xs">
              {lang === 'en' ? 'Notifications' : 'การแจ้งเตือน'}
            </Link>
            <Link href="/account/notifications/settings" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Settings' : 'ตั้งค่าช่องทาง'}
            </Link>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs font-semibold">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterUnreadOnly}
                onChange={(e) => setFilterUnreadOnly(e.target.checked)}
                className="w-4 h-4 accent-emerald-600 rounded-sm"
              />
              <span>{lang === 'en' ? 'Show unread only' : 'แสดงเฉพาะยังไม่ได้อ่าน'}</span>
            </label>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={markAllNotificationsAsRead}
              className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              <CheckCheck className="w-4 h-4" />
              <span>{lang === 'en' ? 'Mark all as read' : 'ทำเครื่องหมายอ่านแล้วทั้งหมด'}</span>
            </button>
          )}
        </div>

        {/* Notifications List */}
        {filteredNotifications.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
            <Bell className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'en' ? 'No notifications right now' : 'ไม่มีการแจ้งเตือนในขณะนี้'}
            </h3>
            <p className="text-xs text-slate-500">
              {lang === 'en' ? 'When new works match your followed tags, they will appear here.' : 'เมื่อมีประกาศโครงการใหม่ตรงกับแท็กที่คุณติดตาม ระบบจะส่งการแจ้งเตือนมายังหน้านี้'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredNotifications.map(item => (
              <div
                key={item.id}
                className={`p-5 rounded-2xl border transition-all space-y-3 ${
                  item.read
                    ? 'bg-white border-slate-200 opacity-80'
                    : 'bg-emerald-50/50 border-emerald-300 shadow-2xs'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {!item.read && (
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
                    )}
                    <StatusBadge status={item.status} size="sm" />
                    <span className="text-xs text-slate-400 font-mono">{item.ingestedDate}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-700">
                      {new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(item.budget)}
                    </span>
                  </div>
                </div>

                <div>
                  <Link
                    href={`/works/${item.workId}`}
                    onClick={() => markNotificationAsRead(item.id)}
                    className="text-base font-bold text-slate-900 hover:text-emerald-600 transition-colors flex items-center gap-2 group"
                  >
                    <span>{item.workTitle}</span>
                    <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 shrink-0" />
                  </Link>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{item.agencyName}</span>
                  </p>
                </div>

                {/* Matched Tags Chips */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-slate-400 text-[11px]">{lang === 'en' ? 'Matched Tags:' : 'ตรงกับแท็กที่ติดตาม:'}</span>
                    {item.matchedTags.map((tag, idx) => (
                      <span key={idx} className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                        #{tag}
                      </span>
                    ))}
                  </div>

                  {!item.read && (
                    <button
                      onClick={() => markNotificationAsRead(item.id)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-emerald-600 underline"
                    >
                      {lang === 'en' ? 'Mark as read' : 'ทำเครื่องหมายว่าอ่านแล้ว'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
