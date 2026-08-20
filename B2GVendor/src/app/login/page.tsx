'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { lang, setRole } = useApp();
  const [email, setEmail] = useState('user@company.co.th');
  const [password, setPassword] = useState('••••••••');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRole('user');
    router.push('/account');
  };

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto font-bold text-xl">
              BMA
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {lang === 'en' ? 'Unified Portal Login' : 'เข้าสู่ระบบ B2G Vendor'}
            </h1>
            <p className="text-xs text-slate-500">
              {lang === 'en' ? 'Single login for personal & registered vendors (Legacy routes 302 redirected)' : 'ระบบเข้าสู่ระบบแบบรวมศูนย์แห่งเดียว (ยกเลิกระบบแยกประเภทเดิม)'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {lang === 'en' ? 'Email Address' : 'อีเมลผู้ใช้งาน'}
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  {lang === 'en' ? 'Password' : 'รหัสผ่าน'}
                </label>
                <Link href="/forgot-password" className="text-xs text-emerald-600 hover:underline">
                  {lang === 'en' ? 'Forgot Password?' : 'ลืมรหัสผ่าน?'}
                </Link>
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              <span>{lang === 'en' ? 'Sign In' : 'เข้าสู่ระบบ'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="text-center pt-4 border-t border-slate-100 text-xs text-slate-500">
            <span>{lang === 'en' ? "Don't have an account?" : 'ยังไม่มีบัญชีผู้ใช้งาน?'} </span>
            <Link href="/register" className="font-bold text-emerald-600 hover:underline">
              {lang === 'en' ? 'Register Now' : 'ลงทะเบียนบัญชีใหม่'}
            </Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
