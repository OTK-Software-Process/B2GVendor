'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { User, Mail, Lock, Building, FileText, CheckCircle2, ArrowRight } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { lang, setRole } = useApp();
  const [includeBusinessProfile, setIncludeBusinessProfile] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRole('user');
    alert(lang === 'en' ? 'Registration complete! Check your email to verify.' : 'ลงทะเบียนสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน');
    router.push('/account');
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
                    placeholder="สมชาย ใจดี"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Email Address' : 'อีเมลรับแจ้งเตือน'}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="user@example.co.th"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {lang === 'en' ? 'Confirm Password' : 'ยืนยันรหัสผ่าน'}
                  </label>
                  <input
                    type="password"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
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

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {lang === 'en' ? 'Tax ID (13 digits)' : 'เลขประจำตัวผู้เสียภาษี (13 หลัก)'}
                    </label>
                    <input
                      type="text"
                      placeholder="0105558123456"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {lang === 'en' ? 'Company / Business Name' : 'ชื่อบริษัท / ห้างหุ้นส่วนจำกัด'}
                    </label>
                    <input
                      type="text"
                      placeholder="บริษัท บีเอ็มเอ ก่อสร้าง จำกัด"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              <span>{lang === 'en' ? 'Create Unified Account' : 'ยืนยันการลงทะเบียนบัญชี'}</span>
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
