'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { ApiError } from '@/lib/api';
import { SitePollInfo } from '@/components/SitePollInfo';
import { Sliders, ShieldCheck, Lock, Plus, X, Power, Info, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

export default function SourceConfigPage() {
  const {
    lang,
    role,
    govSites,
    govSitesStatus,
    refreshGovSites,
    togglingSiteIds,
    addGovSite,
    toggleGovSiteEnabled
  } = useApp();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newShortCode, setNewShortCode] = useState('');
  const [newDeptId, setNewDeptId] = useState('');
  const [newRpm, setNewRpm] = useState(60);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>({});

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
    setNewDeptId('');
    setNewRpm(60);
    setAddError(null);
    setAddFieldErrors({});
  };

  const handleAddSite = async () => {
    if (!newName.trim() || !newDeptId.trim() || !newShortCode.trim() || adding) return;

    setAdding(true);
    setAddError(null);
    setAddFieldErrors({});
    try {
      await addGovSite({
        name: newName.trim(),
        nameEn: newNameEn.trim() || undefined,
        shortCode: newShortCode.trim(),
        deptId: newDeptId.trim(),
        requestsPerMinute: newRpm
      });
      closeAddModal();
      setNotice({
        kind: 'ok',
        text: lang === 'en' ? 'New government site added — it is included from the next poll.' : 'เพิ่มหน่วยงานใหม่แล้ว ระบบจะดึงข้อมูลตั้งแต่รอบถัดไป'
      });
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
        setAddFieldErrors(err.fields ?? {});
      } else {
        setAddError(lang === 'en' ? 'Could not add the site. Please try again.' : 'เพิ่มหน่วยงานไม่สำเร็จ กรุณาลองใหม่');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (siteId: string, siteName: string, wasEnabled: boolean) => {
    setNotice(null);
    try {
      await toggleGovSiteEnabled(siteId);
      setNotice({
        kind: 'ok',
        text: lang === 'en' ? `${siteName} ${wasEnabled ? 'disabled' : 'enabled'}.` : `${wasEnabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${siteName} แล้ว`
      });
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? err.message : lang === 'en' ? 'Could not update the site. Please try again.' : 'อัปเดตหน่วยงานไม่สำเร็จ กรุณาลองใหม่'
      });
    }
  };

  const inputClass = (field: string) =>
    `mt-1 w-full bg-white border rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden ${
      addFieldErrors[field] ? 'border-rose-400' : 'border-slate-200 focus:border-sky-400'
    }`;

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

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in border ${
            notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          {notice.kind === 'ok' ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Government Sites List */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        {govSitesStatus === 'loading' && (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-slate-400" aria-busy="true">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{lang === 'en' ? 'Loading government sites…' : 'กำลังโหลดรายชื่อหน่วยงาน…'}</span>
          </div>
        )}

        {govSitesStatus === 'error' && (
          <div className="p-6 flex flex-wrap items-center gap-3 text-xs text-rose-700 bg-rose-50">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-bold">{lang === 'en' ? "Couldn't load the government sites from the server." : 'โหลดรายชื่อหน่วยงานจากเซิร์ฟเวอร์ไม่สำเร็จ'}</span>
            <button onClick={() => refreshGovSites()} className="inline-flex items-center gap-1 font-bold hover:underline">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'Try again' : 'ลองใหม่'}</span>
            </button>
          </div>
        )}

        {govSitesStatus === 'ready' && govSites.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-400">
            {lang === 'en' ? 'No government sites configured yet. Add the first one.' : 'ยังไม่มีหน่วยงานที่ตั้งค่าไว้ เพิ่มหน่วยงานแรกได้เลย'}
          </p>
        )}

        {govSitesStatus !== 'loading' && govSites.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="p-4">{lang === 'en' ? 'Government Site' : 'หน่วยงานภาครัฐ'}</th>
                  <th className="p-4">{lang === 'en' ? 'e-GP Dept ID' : 'รหัสหน่วยงาน e-GP'}</th>
                  <th className="p-4">{lang === 'en' ? 'Announcement types' : 'ประเภทประกาศ'}</th>
                  <th className="p-4 text-center">{lang === 'en' ? 'Rate Limit' : 'อัตราการดึง (RPM)'}</th>
                  <th className="p-4 text-center">{lang === 'en' ? 'Works' : 'โครงการ'}</th>
                  <th className="p-4">{lang === 'en' ? 'Last poll / next poll' : 'ดึงข้อมูลล่าสุด / รอบถัดไป'}</th>
                  <th className="p-4 text-center">{lang === 'en' ? 'Status' : 'สถานะ'}</th>
                  <th className="p-4 text-right">{lang === 'en' ? 'Action' : 'จัดการ'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {govSites.map(site => {
                  const pending = togglingSiteIds.includes(site.id);
                  return (
                    <tr key={site.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 min-w-[180px]">
                        <p className="font-bold text-slate-900">{site.name}</p>
                        <p className="text-[11px] text-slate-400">{site.nameEn} · {site.shortCode}</p>
                      </td>
                      <td className="p-4 font-mono text-slate-600">
                        {site.deptId ?? '—'}
                        {site.dataGoThOrgSlug && <span className="block text-[10px] text-slate-400">data.go.th: {site.dataGoThOrgSlug}</span>}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {(site.announceTypes ?? []).map(type => (
                            <span key={type} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold font-mono">{type}</span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4 text-center font-mono text-slate-600">{site.requestsPerMin}</td>
                      <td className="p-4 text-center font-mono text-slate-600">{site.worksCount}</td>
                      <td className="p-4">
                        <SitePollInfo site={site} />
                      </td>
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
                          disabled={pending}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[11px] transition-colors disabled:opacity-50 ${
                            site.enabled
                              ? 'text-rose-600 hover:bg-rose-50'
                              : 'text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                          <span>{site.enabled ? (lang === 'en' ? 'Disable' : 'ปิดใช้งาน') : (lang === 'en' ? 'Enable' : 'เปิดใช้งาน')}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-1.5 text-xs text-slate-400 max-w-2xl">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          {lang === 'en'
            ? 'A disabled site is skipped by every scheduled poll and by Poll Now → all sites, from the next poll onward. The polling interval and Poll Now are on the Data Ingestion page.'
            : 'หน่วยงานที่ปิดใช้งานจะถูกข้ามในทุกรอบอัตโนมัติและ Poll Now (ทุกหน่วยงาน) ตั้งแต่รอบถัดไป ส่วนช่วงเวลาดึงข้อมูลและ Poll Now อยู่ที่หน้าการดึงข้อมูล'}
        </p>
      </div>

      <div className="flex items-start gap-1.5 text-xs text-slate-400 max-w-2xl">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          {lang === 'en'
            ? 'Concurrency between a manual poll and a scheduled poll is guarded internally as a fixed safety limit — it is not an editable setting.'
            : 'ระบบมีการป้องกันไม่ให้ Poll ด้วยมือกับ Poll ตามตารางเวลาทำงานพร้อมกัน โดยเป็นค่าความปลอดภัยภายในที่กำหนดตายตัว ไม่สามารถแก้ไขได้'}
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
              <button onClick={closeAddModal} aria-label={lang === 'en' ? 'Close' : 'ปิด'} className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{addError}</span>
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Site Name (Thai)' : 'ชื่อหน่วยงาน (ไทย)'}</label>
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น การทางพิเศษแห่งประเทศไทย"
                  className={inputClass('name')}
                />
                {addFieldErrors.name && <p className="text-[11px] text-rose-600 mt-1">{addFieldErrors.name}</p>}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Site Name (English)' : 'ชื่อหน่วยงาน (อังกฤษ)'}</label>
                <input
                  type="text"
                  value={newNameEn}
                  onChange={(e) => setNewNameEn(e.target.value)}
                  placeholder="e.g. Expressway Authority of Thailand"
                  className={inputClass('nameEn')}
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
                    className={inputClass('shortCode')}
                  />
                  {addFieldErrors.shortCode && <p className="text-[11px] text-rose-600 mt-1">{addFieldErrors.shortCode}</p>}
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Rate Limit (RPM)' : 'อัตราการดึง (RPM)'}</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={newRpm}
                    onChange={(e) => setNewRpm(parseInt(e.target.value, 10) || 0)}
                    className={inputClass('requestsPerMinute')}
                  />
                  {addFieldErrors.requestsPerMinute && <p className="text-[11px] text-rose-600 mt-1">{addFieldErrors.requestsPerMinute}</p>}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'e-GP Department ID (deptId)' : 'รหัสหน่วยงานใน e-GP (deptId)'}</label>
                <input
                  type="text"
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value)}
                  placeholder="2102"
                  className={`${inputClass('deptId')} font-mono`}
                />
                {addFieldErrors.deptId && <p className="text-[11px] text-rose-600 mt-1">{addFieldErrors.deptId}</p>}
                <p className="text-[11px] text-slate-400 mt-1">
                  {lang === 'en'
                    ? 'The department code used by the e-GP announcement feed (e.g. 2102 for MOPH).'
                    : 'รหัสหน่วยงานที่ใช้กับ RSS ประกาศของ e-GP (เช่น 2102 สำหรับ สป.สธ.)'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={closeAddModal} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                onClick={handleAddSite}
                disabled={!newName.trim() || !newDeptId.trim() || !newShortCode.trim() || adding}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors inline-flex items-center gap-1.5"
              >
                {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{lang === 'en' ? 'Add Site' : 'เพิ่มหน่วยงาน'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
