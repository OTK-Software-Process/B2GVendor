'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { useApp } from '@/context/AppContext';
import { api, ApiError } from '@/lib/api';
import { MailX, CheckCircle2, Loader2 } from 'lucide-react';

export default function UnsubscribePage() {
  const { lang } = useApp();
  const { token } = useParams<{ token: string }>();
  const [unsubscribed, setUnsubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnsubscribe = async () => {
    setError(null);
    setSubmitting(true);

    try {
      await api.postPublic('/account/unsubscribe', { token: decodeURIComponent(token) });
      setUnsubscribed(true);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : lang === 'en'
            ? 'Could not unsubscribe. Please try again.'
            : 'ไม่สามารถยกเลิกการรับอีเมลได้ กรุณาลองอีกครั้ง'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 text-center space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          {!unsubscribed ? (
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <MailX className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900">
                {lang === 'en' ? 'Email Unsubscribe' : 'ยกเลิกการรับแจ้งเตือนทางอีเมล'}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === 'en' ? 'One-click email opt-out. No login required.' : 'ยกเลิกการส่งข่าวสารอีเมลสำหรับบัญชีของคุณ ไม่จำเป็นต้องเข้าสู่ระบบ'}
              </p>

              {error && (
                <p role="alert" className="text-sm text-rose-700">
                  {error}
                </p>
              )}

              <button
                onClick={handleUnsubscribe}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold text-sm transition-colors shadow-xs"
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {lang === 'en' ? 'Unsubscribing...' : 'กำลังยกเลิก...'}
                  </span>
                ) : (
                  lang === 'en' ? 'Confirm Unsubscribe' : 'ยืนยันการยกเลิกการรับข่าวสาร'
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto" />
              <h2 className="text-xl font-extrabold text-slate-900">
                {lang === 'en' ? 'Unsubscribed Successfully' : 'ยกเลิกการส่งอีเมลเรียบร้อยแล้ว'}
              </h2>
              <p className="text-xs text-slate-500">
                {lang === 'en' ? 'You will no longer receive procurement email notifications.' : 'คุณจะไม่ได้รับอีเมลแจ้งเตือนโครงการใหม่จาก B2G Vendor อีกต่อไป'}
              </p>
              <div className="pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
                >
                  {lang === 'en' ? 'Return to Home Page' : 'กลับสู่หน้าแรก'}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
