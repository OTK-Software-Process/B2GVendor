'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { MOCK_AUDIT_LOGS } from '@/lib/mock-data';
import { ShieldCheck, Search } from 'lucide-react';

export default function AdminAuditLogPage() {
  const { lang } = useApp();
  const [query, setQuery] = useState('');

  const filteredLogs = MOCK_AUDIT_LOGS.filter(log => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      log.actor.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.target.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-sky-600" />
          <span>{lang === 'en' ? 'Audit Log & Trail' : 'บันทึกประวัติการทำรายการ (Audit Trail Log)'}</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {lang === 'en' ? 'Immutable chronological record of tag changes, source config updates, and ingestion activity' : 'บันทึกประวัติย้อนหลังถาวรสำหรับการแก้ไขแท็ก คอนฟิกระบบ และการดึงข้อมูล'}
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 max-w-md focus-within:border-sky-400 transition-colors">
        <Search className="w-4 h-4 text-slate-400 mr-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'en' ? 'Search by actor, action, target, or details...' : 'ค้นหาจากผู้ดำเนินการ การกระทำ เป้าหมาย หรือรายละเอียด...'}
          className="w-full bg-transparent outline-hidden text-sm text-slate-900"
        />
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Timestamp' : 'วัน-เวลา'}</th>
                <th className="p-4">{lang === 'en' ? 'Actor' : 'ผู้ดำเนินการ (Actor)'}</th>
                <th className="p-4">{lang === 'en' ? 'Action' : 'การกระทำ (Action)'}</th>
                <th className="p-4">{lang === 'en' ? 'Target' : 'เป้าหมาย'}</th>
                <th className="p-4">{lang === 'en' ? 'Details' : 'รายละเอียดเพิ่มเติม'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-mono text-slate-500">{log.timestamp}</td>
                  <td className="p-4 font-mono font-bold text-slate-900">{log.actor}</td>
                  <td className="p-4">
                    <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-100">
                      {log.action}
                    </span>
                  </td>
                  <td className="p-4 text-emerald-700 font-semibold">{log.target}</td>
                  <td className="p-4 text-slate-600">{log.details}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    {lang === 'en' ? 'No log entries match your search.' : 'ไม่พบรายการที่ตรงกับการค้นหา'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
