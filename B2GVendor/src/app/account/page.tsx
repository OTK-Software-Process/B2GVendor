'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import type { AccountView } from '@/context/AppContext';
import { User, Building, Lock, ShieldCheck, Save } from 'lucide-react';

export default function AccountProfilePage() {
  const { lang, account, signIn } = useApp();
  const [profile, setProfile] = useState<AccountView | null>(account);
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [taxId, setTaxId] = useState(account?.businessProfile?.taxId ?? '');
  const [companyName, setCompanyName] = useState(account?.businessProfile?.companyName ?? '');
  const [savedNotice, setSavedNotice] = useState(false);
  const [errorNotice, setErrorNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.get<AccountView>('/api/v1/accounts/profile')
      .then((loadedProfile) => {
        setProfile(loadedProfile);
        setName(loadedProfile.name);
        setEmail(loadedProfile.email);
        setPhone(loadedProfile.phone ?? '');
        setTaxId(loadedProfile.businessProfile?.taxId ?? '');
        setCompanyName(loadedProfile.businessProfile?.companyName ?? '');
        signIn(loadedProfile);
      })
      .catch((error: Error) => setErrorNotice(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice('');
    setIsSaving(true);
    try {
      const updatedProfile = await api.patch<AccountView>('/api/v1/accounts/profile', {
        name,
        phone: phone || undefined,
        ...(profile?.type === 'business' ? { businessProfile: { companyName, taxId } } : {}),
      });
      setProfile(updatedProfile);
      signIn(updatedProfile);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (error) {
      setErrorNotice(error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        {/* Account Sub-Nav Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Account Profile & Business Info' : 'ข้อมูลบัญชีผู้ใช้และนิติบุคคล'}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'en' ? 'Unified profile settings, business Tax ID, and active user sessions' : 'จัดการข้อมูลส่วนตัว บัญชีธุรกิจ และการตั้งค่าความปลอดภัย'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Link href="/account" className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white shadow-2xs">
              {lang === 'en' ? 'Profile' : 'ข้อมูลส่วนตัว'}
            </Link>
            <Link href="/account/interests" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Interests' : 'แท็กที่ติดตาม'}
            </Link>
            <Link href="/account/notifications" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Notifications' : 'การแจ้งเตือน'}
            </Link>
          </div>
        </div>

        {savedNotice && (
          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>{lang === 'en' ? 'Profile changes saved successfully!' : 'บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว!'}</span>
          </div>
        )}

        {errorNotice && (
          <div className="bg-red-50 text-red-800 border border-red-200 p-4 rounded-2xl text-xs font-bold">
            {errorNotice}
          </div>
        )}

        <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Profile Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Common User Profile Section */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
                <User className="w-5 h-5 text-emerald-600" />
                <span>{lang === 'en' ? 'Common Profile Fields' : 'ข้อมูลผู้ใช้งานหลัก (User Profile)'}</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Full Name' : 'ชื่อ-นามสกุล'}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Email Address' : 'อีเมลรับแจ้งเตือนหลัก'}
                  </label>
                  <input
                    type="email"
                    value={email}
                    readOnly
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {lang === 'en' ? 'Phone Number' : 'เบอร์โทรศัพท์ติดต่อ'}
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                />
              </div>
            </div>

            {/* Optional Business Profile Section */}
            {profile?.type === 'business' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building className="w-5 h-5 text-emerald-600" />
                  <span>{lang === 'en' ? 'Business Profile Section' : 'ข้อมูลธุรกิจ / นิติบุคคล (Business Profile)'}</span>
                </h3>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                  {lang === 'en' ? 'Active' : 'ใช้งานอยู่'}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Tax ID (13 digits)' : 'เลขประจำตัวผู้เสียภาษี (Tax ID)'}
                  </label>
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-900 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Company / Business Registered Name' : 'ชื่อบริษัท / ห้างหุ้นส่วนจำกัด'}
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden"
                  />
                </div>
              </div>
            </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors shadow-xs"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? (lang === 'en' ? 'Saving...' : 'กำลังบันทึก...') : (lang === 'en' ? 'Save Changes' : 'บันทึกข้อมูล')}</span>
              </button>
            </div>
          </div>

          {/* Security & Sessions Sidebar */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
                <Lock className="w-5 h-5 text-emerald-600" />
                <span>{lang === 'en' ? 'Security & Password' : 'ความปลอดภัยและรหัสผ่าน'}</span>
              </h3>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => alert(lang === 'en' ? 'Password change modal simulation' : 'จำลองหน้าเปลี่ยนรหัสผ่าน')}
                  className="w-full text-left px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 hover:border-emerald-500 transition-colors"
                >
                  {lang === 'en' ? 'Change Password' : 'เปลี่ยนรหัสผ่าน'}
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {lang === 'en' ? 'Active Sessions' : 'เซสชันที่เชื่อมต่ออยู่'}
                </h4>
                <div className="text-xs space-y-1 bg-slate-50 p-3 rounded-xl">
                  <p className="font-bold text-slate-900">Windows Chrome • Current Session</p>
                  <p className="text-slate-400">IP: 182.52.xx.xx • Bangkok, Thailand</p>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </PublicShell>
  );
}
