'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';

interface FiscalYearTextProps {
  year: number;
  // Worked out from the e-GP project number rather than stated in the
  // announcement -- right for most projects, one year off for a project
  // registered in advance against the next year's budget. Marked so nobody
  // reads it as the announcement's own word.
  estimated?: boolean;
  // 'short' for cards ("ปีงบฯ 2569"), 'long' for the detail page ("ปีงบประมาณ 2569").
  variant?: 'short' | 'long';
  className?: string;
}

export function fiscalYearHint(estimated: boolean | undefined, lang: 'th' | 'en'): string | undefined {
  if (!estimated) return undefined;
  return lang === 'en'
    ? 'Estimated from the project number -- the announcement does not state a fiscal year.'
    : 'ประมาณจากเลขที่โครงการ — ประกาศไม่ได้ระบุปีงบประมาณ';
}

export function FiscalYearText({ year, estimated, variant = 'short', className }: FiscalYearTextProps) {
  const { lang } = useApp();
  const label = lang === 'en' ? 'FY' : variant === 'long' ? 'ปีงบประมาณ' : 'ปีงบฯ';

  return (
    <span className={className} title={fiscalYearHint(estimated, lang)}>
      {label} {year}
      {estimated && <span aria-label={lang === 'en' ? 'estimated' : 'โดยประมาณ'}> ≈</span>}
    </span>
  );
}
