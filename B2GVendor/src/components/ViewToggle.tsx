'use client';

import React from 'react';
import { Rows3, LayoutGrid } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface ViewToggleProps {
  view: 'row' | 'grid';
  onChange: (view: 'row' | 'grid') => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const { lang } = useApp();

  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-200 bg-white">
      <button
        onClick={() => onChange('row')}
        title={lang === 'en' ? 'Row view' : 'มุมมองแถว'}
        aria-pressed={view === 'row'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
          view === 'row' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-emerald-700'
        }`}
      >
        <Rows3 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{lang === 'en' ? 'Row' : 'แถว'}</span>
      </button>
      <button
        onClick={() => onChange('grid')}
        title={lang === 'en' ? 'Grid view' : 'มุมมองตาราง'}
        aria-pressed={view === 'grid'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
          view === 'grid' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-emerald-700'
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{lang === 'en' ? 'Grid' : 'ตาราง'}</span>
      </button>
    </div>
  );
}
