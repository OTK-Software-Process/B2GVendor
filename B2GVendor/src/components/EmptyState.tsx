'use client';

import React from 'react';
import { SearchX, RefreshCw } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface EmptyStateProps {
  title?: string;
  description?: string;
  onReset?: () => void;
}

export function EmptyState({ title, description, onReset }: EmptyStateProps) {
  const { lang } = useApp();

  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center space-y-4 animate-fade-in">
      <div className="w-16 h-16 rounded-full border border-slate-200 text-slate-400 flex items-center justify-center mx-auto">
        <SearchX className="w-8 h-8" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-slate-900">
          {title || (lang === 'en' ? 'No Results Found' : 'ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา')}
        </h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
          {description || (lang === 'en' ? 'Try adjusting your search query, clearing filter facets, or searching for other keywords.' : 'ลองปรับเปลี่ยนคำค้นหา ล้างตัวกรอง หรือค้นหาแท็กหมวดหมู่อื่นๆ')}
        </p>
      </div>

      {onReset && (
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-emerald-700 hover:bg-emerald-50 border border-emerald-200 transition-colors duration-150 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>{lang === 'en' ? 'Reset Filters' : 'รีเซ็ตการค้นหา'}</span>
        </button>
      )}
    </div>
  );
}
