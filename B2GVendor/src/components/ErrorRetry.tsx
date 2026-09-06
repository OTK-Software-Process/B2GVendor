'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface ErrorRetryProps {
  message?: string;
  onRetry: () => void;
}

export function ErrorRetry({ message, onRetry }: ErrorRetryProps) {
  const { lang } = useApp();

  return (
    <div className="bg-white border border-rose-200 rounded-3xl p-8 text-center space-y-4 animate-fade-in">
      <div className="w-12 h-12 rounded-full border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <div>
        <h3 className="text-base font-bold text-rose-900">
          {lang === 'en' ? 'Connection Error' : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'}
        </h3>
        <p className="text-xs text-rose-600 mt-1 max-w-sm mx-auto">
          {message || (lang === 'en' ? 'Could not reach B2G Vendor server. Click below to retry.' : 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ B2G Vendor ได้ กรุณาลองใหม่อีกครั้ง')}
        </p>
      </div>

      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors duration-150 cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{lang === 'en' ? 'Retry' : 'ลองใหม่อีกครั้ง'}</span>
      </button>
    </div>
  );
}
