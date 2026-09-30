'use client';

import React, { useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { AppLang } from '@/context/AppContext';
import { pageWindow } from '@/lib/pagination';

// How many page numbers fit: 10 on a normal screen, fewer on a phone (the four
// arrow buttons take room too). Read from the viewport width, so the window
// itself is recomputed -- hiding buttons with CSS could hide the current page.
const WINDOW_SIZES = [
  { query: '(min-width: 640px)', size: 10 },
  { query: '(min-width: 360px)', size: 5 }
];
const SMALLEST_WINDOW = 3;

function subscribeToViewport(onChange: () => void): () => void {
  const lists = WINDOW_SIZES.map(({ query }) => window.matchMedia(query));
  lists.forEach(list => list.addEventListener('change', onChange));
  return () => lists.forEach(list => list.removeEventListener('change', onChange));
}

function currentWindowSize(): number {
  return WINDOW_SIZES.find(({ query }) => window.matchMedia(query).matches)?.size ?? SMALLEST_WINDOW;
}

const buttonBase =
  'inline-flex items-center justify-center h-8 min-w-8 px-1 sm:h-9 sm:min-w-9 text-xs font-bold rounded-xl transition-all duration-150 focus-visible:outline-2 focus-visible:outline-emerald-500';
const buttonIdle = 'border border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700';
const buttonDisabled = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-600';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  lang: AppLang;
}

export function Pagination({ page, totalPages, onPageChange, lang }: PaginationProps) {
  const windowSize = useSyncExternalStore(subscribeToViewport, currentWindowSize, () => WINDOW_SIZES[0].size);
  const pages = pageWindow(page, totalPages, windowSize);
  const en = lang === 'en';

  const arrow = (label: string, target: number, disabled: boolean, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onPageChange(target)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${buttonBase} ${buttonIdle} ${buttonDisabled}`}
    >
      {icon}
    </button>
  );

  return (
    <nav
      aria-label={en ? 'Pagination' : 'เปลี่ยนหน้า'}
      className="flex flex-wrap items-center justify-center sm:justify-between gap-x-4 gap-y-3 pt-2"
    >
      <span className="text-xs text-slate-500 font-medium">{en ? `Page ${page} of ${totalPages}` : `หน้า ${page} จาก ${totalPages}`}</span>

      <div className="flex items-center justify-center gap-1 sm:gap-1.5">
        {arrow(en ? 'First page' : 'หน้าแรก', 1, page <= 1, <ChevronsLeft className="w-4 h-4" />)}
        {arrow(en ? 'Previous page' : 'หน้าก่อนหน้า', page - 1, page <= 1, <ChevronLeft className="w-4 h-4" />)}

        {pages.map(pageNum => (
          <button
            type="button"
            key={pageNum}
            onClick={() => onPageChange(pageNum)}
            aria-label={en ? `Page ${pageNum}` : `หน้า ${pageNum}`}
            aria-current={pageNum === page ? 'page' : undefined}
            className={`${buttonBase} ${pageNum === page ? 'bg-emerald-600 text-white' : buttonIdle}`}
          >
            {pageNum}
          </button>
        ))}

        {arrow(en ? 'Next page' : 'หน้าถัดไป', page + 1, page >= totalPages, <ChevronRight className="w-4 h-4" />)}
        {arrow(en ? 'Last page' : 'หน้าสุดท้าย', totalPages, page >= totalPages, <ChevronsRight className="w-4 h-4" />)}
      </div>
    </nav>
  );
}
