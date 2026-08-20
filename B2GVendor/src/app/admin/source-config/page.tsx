'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { MOCK_SITE_POLL_CONFIGS } from '@/lib/mock-data';
import { Sliders, ShieldCheck, Globe, Lock, Plus, X, Power, Info } from 'lucide-react';

export default function SourceConfigPage() {
  const { lang, role, govSites, addGovSite, toggleGovSiteEnabled } = useApp();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newShortCode, setNewShortCode] = useState('');
  const [newDatasetId, setNewDatasetId] = useState('');
  const [newRpm, setNewRpm] = useState(60);

  if (role !== 'superadmin') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Sliders className="w-6 h-6 text-sky-600" />
            <span>{lang === 'en' ? 'Source Configuration' : 'การตั้งค่าแหล่งข้อมูล'}</span>
          </h1>
        </div>

        <div className="flex flex-col items-center gap-3 text-center bg-white border border-slate-200 rounded-3xl p-12">
          <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
            <Lock className="w-5 h-5 text-amber-600" />
          </div>
          <h2 className="font-bold text-slate-900">
            {lang === 'en' ? 'Super admin access required' : 'ต้องใช้สิทธิ์ผู้ดูแลระบบสูงสุด'}
          </h2>
          <p className="text-sm text-slate-500 max-w-sm">
            {lang === 'en'
              ? 'Source configuration controls which government sites this platform polls and can affect data integrity for everyone, so only super admins can view or change it.'
              : 'การตั้งค่าแหล่งข้อมูลกำหนดว่าระบบจะดึงข้อมูลจากหน่วยงานภาครัฐใดบ้าง และมีผลต่อความถูกต้องของข้อมูลของทุกคน จึงจำกัดให้เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่ดูหรือแก้ไขได้'}
          </p>
        </div>
      </div>
    );
  }

  const closeAddModal = () => {
    setShowAddModal(false);
    setNewName('');
    setNewNameEn('');
    setNewShortCode('');
    setNewDatasetId('');
    setNewRpm(60);
  };

  const handleAddSite = () => {
    if (!newName.trim() || !newDatasetId.trim()) return;
    addGovSite({
      name: newName.trim(),
      nameEn: newNameEn.trim() || newName.trim(),
      shortCode: newShortCode.trim() || newName.trim().slice(0, 4).toUpperCase(),
      datasetId: newDatasetId.trim(),
      requestsPerMin: newRpm
    });
    closeAddModal();
    setSavedNotice(lang === 'en' ? 'New government site added — polling starts on the next scheduled run.' : 'เพิ่มหน่วยงานใหม่แล้ว ระบบจะเริ่ม Poll ในรอบถัดไป');
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const handleToggle = (siteId: string, siteName: string, nowEnabled: boolean) => {
    toggleGovSiteEnabled(siteId);
    setSavedNotice(
      lang === 'en'
        ? `${siteName} ${nowEnabled ? 'disabled' : 'enabled'}.`
        : `${nowEnabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${siteName} แล้ว`
    );
    setTimeout(() => setSavedNotice(null), 3000);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Sliders className="w-6 h-6 text-sky-600" />
            <span>{lang === 'en' ? 'Source Configuration' : 'การตั้งค่าแหล่งข้อมูล'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en'
              ? 'The list of government sites this platform polls. Changes take effect on the next run — no redeploy needed.'
              : 'รายชื่อหน่วยงานภาครัฐที่ระบบดึงข้อมูล การเปลี่ยนแปลงมีผลในรอบถัดไปโดยไม่ต้อง Deploy ใหม่'}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'en' ? 'Add Government Site' : 'เพิ่มหน่วยงานภาครัฐ'}</span>
        </button>
      </div>

      {savedNotice && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* How ingestion works */}
      <div className="flex items-start gap-2.5 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-2xl p-4">
        <Globe className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {lang === 'en' ? (
            <>Every site below is ingested by <strong>polling the official `api.data.go.th` open-data API</strong> — no scraping. Each site has its own dataset ID, request-rate limit, and enabled toggle, so one site&apos;s outage or schema change can&apos;t block the others. Regular admins can see this list; only a <strong>super admin</strong> can add, disable, or repoint a site.</>
          ) : (
            <>ทุกหน่วยงานด้านล่างดึงข้อมูลด้วยการ<strong>โพลผ่าน API สาธารณะ `api.data.go.th`</strong> เท่านั้น — ไม่มีการดึงข้อมูลจากหน้าเว็บ (Scraping) แต่ละหน่วยงานมี Dataset ID อัตราการดึงข้อมูล และสถานะเปิด/ปิดใช้งานแยกกัน หากหน่วยงานใดมีปัญหาจะไม่กระทบหน่วยงานอื่น ผู้ดูแลทั่วไปดูรายการนี้ได้ แต่มีเพียง<strong>ผู้ดูแลระบบสูงสุด</strong>เท่านั้นที่เพิ่ม ปิดใช้งาน หรือแก้ไขปลายทางได้</>
          )}
        </p>
      </div>

      {/* Government Sites List */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Government Site' : 'หน่วยงานภาครัฐ'}</th>
                <th className="p-4">{lang === 'en' ? 'api.data.go.th Dataset ID' : 'Dataset ID (api.data.go.th)'}</th>
                <th className="p-4">{lang === 'en' ? 'Scope' : 'ขอบเขตหมวดหมู่'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Rate Limit' : 'อัตราการดึง (RPM)'}</th>
                <th className="p-4 text-center">{lang === 'en' ? 'Status' : 'สถานะ'}</th>
                <th className="p-4 text-right">{lang === 'en' ? 'Action' : 'จัดการ'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {govSites.map(site => {
                const scopeConfig = MOCK_SITE_POLL_CONFIGS.find(c => c.siteId === site.id);
                return (
                  <tr key={site.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{site.name}</p>
                      <p className="text-[11px] text-slate-400">{site.nameEn} · {site.shortCode}</p>
                    </td>
                    <td className="p-4 font-mono text-slate-600">{site.datasetId}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {(scopeConfig?.scopeCategories ?? []).map(cat => (
                          <span key={cat} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">{cat}</span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-center font-mono text-slate-600">{site.requestsPerMin}</td>
                    <td className="p-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                        site.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {site.enabled ? (lang === 'en' ? 'Enabled' : 'เปิดใช้งาน') : (lang === 'en' ? 'Disabled' : 'ปิดใช้งาน')}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleToggle(site.id, site.name, site.enabled)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[11px] transition-colors ${
                          site.enabled
                            ? 'text-rose-600 hover:bg-rose-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{site.enabled ? (lang === 'en' ? 'Disable' : 'ปิดใช้งาน') : (lang === 'en' ? 'Enable' : 'เปิดใช้งาน')}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-1.5 text-xs text-slate-400 max-w-2xl">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          {lang === 'en'
            ? 'Concurrency between a manual poll and a scheduled poll for the same site is guarded internally as a fixed safety limit — it is not an editable setting.'
            : 'ระบบมีการป้องกันไม่ให้ Poll ด้วยมือกับ Poll ตามตารางเวลาของหน่วยงานเดียวกันทำงานพร้อมกัน โดยเป็นค่าความปลอดภัยภายในที่กำหนดตายตัว ไม่สามารถแก้ไขได้'}
        </p>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md space-y-5 animate-scale-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-sky-600" />
                <span>{lang === 'en' ? 'Add Government Site' : 'เพิ่มหน่วยงานภาครัฐ'}</span>
              </h2>
              <button onClick={closeAddModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Site Name (Thai)' : 'ชื่อหน่วยงาน (ไทย)'}</label>
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น การทางพิเศษแห่งประเทศไทย"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Site Name (English)' : 'ชื่อหน่วยงาน (อังกฤษ)'}</label>
                <input
                  type="text"
                  value={newNameEn}
                  onChange={(e) => setNewNameEn(e.target.value)}
                  placeholder="e.g. Expressway Authority of Thailand"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Short Code' : 'ตัวย่อ'}</label>
                  <input
                    type="text"
                    value={newShortCode}
                    onChange={(e) => setNewShortCode(e.target.value)}
                    placeholder="EXAT"
                    className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Rate Limit (RPM)' : 'อัตราการดึง (RPM)'}</label>
                  <input
                    type="number"
                    value={newRpm}
                    onChange={(e) => setNewRpm(parseInt(e.target.value, 10) || 0)}
                    className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'api.data.go.th Dataset ID' : 'Dataset ID บน api.data.go.th'}</label>
                <input
                  type="text"
                  value={newDatasetId}
                  onChange={(e) => setNewDatasetId(e.target.value)}
                  placeholder="exat-procurement-disclosure"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={closeAddModal} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                onClick={handleAddSite}
                disabled={!newName.trim() || !newDatasetId.trim()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors"
              >
                {lang === 'en' ? 'Add Site' : 'เพิ่มหน่วยงาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
