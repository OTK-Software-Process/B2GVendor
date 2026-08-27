'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp, AccountView } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { Building, ArrowRight } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { lang, signIn } = useApp();
  const [includeBusinessProfile, setIncludeBusinessProfile] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const account = await api.post<AccountView>('/auth/register', {
        name,
        email,
        password,
        confirmPassword,
        type: includeBusinessProfile ? 'business' : 'individual',
        ...(includeBusinessProfile ? { businessProfile: { companyName, taxId } } : {})
      });
      signIn(account);
      router.push('/account');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setFormError(lang === 'en' ? 'Something went wrong. Please try again.' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="max-w-xl mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Unified Account Registration' : 'ลงทะเบียนบัญชี B2G Vendor'}
            </h1>
            <p className="text-xs text-slate-500">
              {lang === 'en' ? 'Single registration for all users with optional business profile section' : 'แบบฟอร์มสมัครสมาชิกรวมศูนย์ (เพิ่มข้อมูลนิติบุคคล/SME ได้ในขั้นตอนเดียว)'}
            </p>
          </div>

          {formError && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: User Account Details */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 border-b border-slate-100 pb-2">
                1. {lang === 'en' ? 'Personal / Login Info' : 'ข้อมูลการเข้าสู่ระบบส่วนบุคคล'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Full Name' : 'ชื่อ-นามสกุล'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="สมชาย ใจดี"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  {fieldErrors.name && <p className="mt-1 text-xs text-rose-600">{fieldErrors.name}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Email Address' : 'อีเมลรับแจ้งเตือน'}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.co.th"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  {fieldErrors.email && <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Password' : 'กำหนดรหัสผ่าน'}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  {fieldErrors.password && <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Confirm Password' : 'ยืนยันรหัสผ่าน'}
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  {fieldErrors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirmPassword}</p>}
                </div>
              </div>
            </div>

            {/* Optional Step 2: Business Profile Toggle */}
            <div className="space-y-4 pt-2">
              <label className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeBusinessProfile}
                  onChange={(e) => setIncludeBusinessProfile(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded-sm"
                />
                <div>
                  <span className="text-sm font-bold text-slate-900 block">
                    {lang === 'en' ? 'Add Business / SME Profile (Optional)' : 'เพิ่มข้อมูลนิติบุคคล / ผู้ค้า SME (ตัวเลือกเสริม)'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {lang === 'en' ? 'Include Tax ID and company details for vendor tracking' : 'สำหรับผู้เสนอราคาที่ต้องการบันทึกเลขประจำตัวผู้เสียภาษีและชื่อบริษัท'}
                  </span>
                </div>
              </label>

              {includeBusinessProfile && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 animate-fadeIn">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-emerald-600" />
                    <span>2. {lang === 'en' ? 'Business Profile Section' : 'ข้อมูลสถานประกอบการ'}</span>
                  </h3>

                  {fieldErrors.businessProfile && (
                    <p className="text-xs text-rose-600">{fieldErrors.businessProfile}</p>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {lang === 'en' ? 'Tax ID (13 digits)' : 'เลขประจำตัวผู้เสียภาษี (13 หลัก)'}
                    </label>
                    <input
                      type="text"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      placeholder="0105558123456"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    {fieldErrors['businessProfile.taxId'] && (
                      <p className="mt-1 text-xs text-rose-600">{fieldErrors['businessProfile.taxId']}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {lang === 'en' ? 'Company / Business Name' : 'ชื่อบริษัท / ห้างหุ้นส่วนจำกัด'}
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="บริษัท บีเอ็มเอ ก่อสร้าง จำกัด"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    {fieldErrors['businessProfile.companyName'] && (
                      <p className="mt-1 text-xs text-rose-600">{fieldErrors['businessProfile.companyName']}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              <span>
                {submitting
                  ? (lang === 'en' ? 'Creating account…' : 'กำลังสร้างบัญชี…')
                  : (lang === 'en' ? 'Create Unified Account' : 'ยืนยันการลงทะเบียนบัญชี')}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="text-center pt-2 text-xs text-slate-500">
            <span>{lang === 'en' ? 'Already registered?' : 'มีบัญชีอยู่แล้ว?'} </span>
            <Link href="/login" className="font-bold text-emerald-600 hover:underline">
              {lang === 'en' ? 'Log In' : 'เข้าสู่ระบบที่นี่'}
            </Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
