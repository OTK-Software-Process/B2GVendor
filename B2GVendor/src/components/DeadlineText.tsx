'use client';

import React from 'react';
import { CalendarClock } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { WorkItem } from '@/lib/mock-data';
import { describeDeadline, DEADLINE_TONE_CLASS } from '@/lib/deadline';

interface DeadlineTextProps {
  work: Pick<WorkItem, 'deadlineAt' | 'deadlineStartAt' | 'deadlineHasTime' | 'status'>;
  // 'inline': one wrapping line (grid card). 'block': a captioned stack that
  // matches the "Published" / "Budget" blocks beside it (row card, detail page).
  variant?: 'inline' | 'block';
  // The size of the date itself on the 'block' variant -- each call site differs.
  dateClassName?: string;
  // 'responsive' right-aligns on wide screens (the row card's side column);
  // 'left' always left-aligns (a detail-page tile).
  align?: 'responsive' | 'left';
}

// The bid-submission deadline of a work -- nothing at all when it has none
// (most documents never state one; a draft leaves the field blank).
export function DeadlineText({
  work,
  variant = 'inline',
  dateClassName = 'text-xs sm:text-sm font-semibold text-slate-800',
  align = 'responsive'
}: DeadlineTextProps) {
  const { lang } = useApp();
  const view = describeDeadline(work, lang);
  if (!view) return null;

  const caption = lang === 'en' ? 'Bid deadline' : 'กำหนดยื่นข้อเสนอ';
  const pill = view.leftText ? (
    <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold ${DEADLINE_TONE_CLASS[view.tone]}`}>{view.leftText}</span>
  ) : null;

  if (variant === 'block') {
    return (
      <div className={align === 'left' ? 'text-left' : 'text-left lg:text-right'}>
        <span className="text-[11px] text-slate-400 block">{caption}</span>
        <span className={dateClassName}>{view.dateText}</span>
        {view.timeText && <span className="block text-xs text-slate-500">{view.timeText}</span>}
        {pill && <span className="block mt-1">{pill}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
      <CalendarClock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
      <span>{caption}</span>
      <span className="font-semibold text-slate-800">{view.dateText}</span>
      {view.timeText && <span>{view.timeText}</span>}
      {pill}
    </div>
  );
}
