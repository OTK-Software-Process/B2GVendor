'use client';

import React from 'react';
import { useApp, AppLang } from '@/context/AppContext';
import { BudgetBasis, BudgetMissingReason } from '@/lib/mock-data';

const thb = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });

// What to tell the user when a work has no price -- never a bare "0" or a
// blank. The reason (from the ingestion pipeline) decides the wording, so we
// never claim "the document has no price" when we simply couldn't read it.
const MISSING: Record<BudgetMissingReason | 'unknown', { th: [string, string]; en: [string, string] }> = {
  'not-stated': {
    th: ['ไม่ระบุราคากลางในเอกสาร', 'เอกสารที่ประกาศไม่ได้ระบุราคากลางหรือวงเงินงบประมาณ'],
    en: ['Price not stated in the document', 'The published document does not state a reference price or budget.']
  },
  unreadable: {
    th: ['อ่านราคาจากเอกสารไม่ได้', 'เอกสารเป็นไฟล์ภาพสแกนที่ระบบอ่านข้อความไม่ได้ โปรดดูราคาในไฟล์ TOR'],
    en: ["Couldn't read a price", "The document is a scanned image the system can't read. Please check the TOR file for the price."]
  },
  'no-document': {
    th: ['ยังอ่านราคาจากเอกสารไม่ได้', 'ระบบยังดึงเอกสารของประกาศนี้ไม่ได้ โปรดดูรายละเอียดที่เว็บไซต์ต้นทาง'],
    en: ["Couldn't read a price yet", "The system couldn't retrieve this announcement's document. See the source government site for details."]
  },
  // Works ingested before the reason was recorded, or with nothing known.
  unknown: {
    th: ['ไม่ระบุราคา', 'ยังไม่มีข้อมูลราคาของโครงการนี้'],
    en: ['Price not specified', 'No price is available for this project yet.']
  }
};

// A price that is not a budget: the winning bid from a winner announcement.
// Shown under its own name so it is never mistaken for the project's budget.
const BASIS: Record<BudgetBasis, { label: [string, string]; tag: [string, string]; explanation: [string, string] }> = {
  awarded: {
    label: ['ราคาที่ชนะการเสนอราคา', 'Winning bid'],
    tag: ['ราคาที่ชนะ', 'winning bid'],
    explanation: [
      'ราคาที่ผู้ชนะเสนอ ตามประกาศผู้ชนะการเสนอราคา (ไม่ใช่ราคากลางของโครงการ)',
      "The price the winner offered, from the winner announcement (not the project's reference price)."
    ]
  }
};

export function formatBaht(amount: number): string {
  return thb.format(amount);
}

const langIndex = (lang: AppLang): 0 | 1 => (lang === 'en' ? 1 : 0);

export function budgetMissingText(reason: BudgetMissingReason | undefined, lang: AppLang): { short: string; long: string } {
  const [short, long] = MISSING[reason ?? 'unknown'][lang];
  return { short, long };
}

// The caption above a price: "งบประมาณกลาง" / "Budget" for a budget, or the
// winning-bid wording for an awarded price.
export function budgetLabel(basis: BudgetBasis | undefined, lang: AppLang): string {
  if (basis) return BASIS[basis].label[langIndex(lang)];
  return lang === 'en' ? 'Budget' : 'งบประมาณกลาง';
}

interface BudgetTextProps {
  budget: number | null;
  reason?: BudgetMissingReason;
  basis?: BudgetBasis;
  // Styling of the amount itself (each call site sizes it differently).
  className?: string;
  // Also print the longer explanation under a missing price / a winning bid (detail page).
  showExplanation?: boolean;
  // Put a small "winning bid" tag beside the amount -- for places with no caption above it.
  showBasisTag?: boolean;
}

export function BudgetText({ budget, reason, basis, className = '', showExplanation = false, showBasisTag = false }: BudgetTextProps) {
  const { lang } = useApp();

  if (budget !== null && budget > 0) {
    const i = langIndex(lang);
    return (
      <span className={basis && showExplanation ? 'block' : undefined}>
        <span className={className}>{formatBaht(budget)}</span>
        {basis && showBasisTag && (
          <span className="ml-1.5 text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md align-middle" title={BASIS[basis].explanation[i]}>
            {BASIS[basis].tag[i]}
          </span>
        )}
        {basis && showExplanation && <span className="block text-xs text-slate-400 mt-1 leading-snug">{BASIS[basis].explanation[i]}</span>}
      </span>
    );
  }

  const { short, long } = budgetMissingText(reason, lang);
  return (
    <span className="block">
      <span className="text-xs sm:text-sm font-medium italic text-slate-400 leading-snug" title={long}>
        {short}
      </span>
      {showExplanation && <span className="block text-xs text-slate-400 mt-1 leading-snug not-italic">{long}</span>}
    </span>
  );
}
