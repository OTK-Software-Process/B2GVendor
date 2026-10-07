// How a work's bid-submission deadline is shown: the date, the time window when
// the announcement gives one, and how many days are left. Everything is worked
// out in Thailand time (Asia/Bangkok), whatever time zone the viewer's browser
// is in -- the deadline is a Thai clock time, and "days left" must not shift
// by a day for someone abroad.

import type { ProcurementStatus } from './mock-data';

type Lang = 'th' | 'en';

const TZ = 'Asia/Bangkok';
const DAY_MS = 24 * 3600_000;
const BANGKOK_OFFSET_MS = 7 * 3600_000;

export type DeadlineTone = 'urgent' | 'soon' | 'open' | 'closed';

export interface DeadlineInput {
  deadlineAt?: string;
  deadlineStartAt?: string;
  deadlineHasTime?: boolean;
  status: ProcurementStatus;
}

export interface DeadlineView {
  // "24 ก.ย. 2569" -- or "17 ก.ย. 2569 – 25 ก.ย. 2569" for a span of dates.
  dateText: string;
  // "09:00 – 12:00 น." / "ภายใน 16:30 น." -- undefined when only a date is known.
  timeText?: string;
  // Whole calendar days (Thailand) from today to the closing date; negative once passed.
  daysLeft: number;
  // "เหลือ 3 วัน" / "ปิดรับวันนี้" / "ปิดรับแล้ว" -- empty when counting down means nothing
  // (a cancelled or awarded work).
  leftText: string;
  tone: DeadlineTone;
}

// The calendar day (days since epoch) a UTC instant falls on in Thailand.
function bangkokDay(ms: number): number {
  return Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS);
}

function formatDate(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ
  }).format(date);
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(date);
}

export function describeDeadline(input: DeadlineInput, lang: Lang, now: number = Date.now()): DeadlineView | null {
  if (!input.deadlineAt) return null;
  const end = new Date(input.deadlineAt);
  if (Number.isNaN(end.getTime())) return null;

  const start = input.deadlineStartAt ? new Date(input.deadlineStartAt) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const spansDays = validStart !== null && bangkokDay(validStart.getTime()) !== bangkokDay(end.getTime());

  const dateText = spansDays ? `${formatDate(validStart, lang)} – ${formatDate(end, lang)}` : formatDate(end, lang);

  let timeText: string | undefined;
  if (input.deadlineHasTime) {
    const closes = formatClock(end);
    if (validStart && !spansDays) {
      timeText = lang === 'en' ? `${formatClock(validStart)} – ${closes}` : `${formatClock(validStart)} – ${closes} น.`;
    } else {
      timeText = lang === 'en' ? `by ${closes}` : `ภายใน ${closes} น.`;
    }
  }

  const daysLeft = bangkokDay(end.getTime()) - bangkokDay(now);
  const passed = end.getTime() < now;
  // A cancelled or awarded work is no longer taking bids: show when it WAS, never count down.
  const notBidding = input.status === 'CANCELLED' || input.status === 'AWARDED';

  if (notBidding) {
    return { dateText, timeText, daysLeft, leftText: passed ? text(lang, 'ปิดรับแล้ว', 'Closed') : '', tone: 'closed' };
  }
  if (passed) {
    return { dateText, timeText, daysLeft, leftText: text(lang, 'ปิดรับแล้ว', 'Closed'), tone: 'closed' };
  }
  if (daysLeft <= 0) {
    return { dateText, timeText, daysLeft: 0, leftText: text(lang, 'ปิดรับวันนี้', 'Closes today'), tone: 'urgent' };
  }
  const leftText = lang === 'en' ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : `เหลือ ${daysLeft} วัน`;
  return { dateText, timeText, daysLeft, leftText, tone: daysLeft <= 3 ? 'urgent' : daysLeft <= 7 ? 'soon' : 'open' };
}

function text(lang: Lang, th: string, en: string): string {
  return lang === 'en' ? en : th;
}

// Tailwind classes for the "days left" pill, one per tone.
export const DEADLINE_TONE_CLASS: Record<DeadlineTone, string> = {
  urgent: 'bg-rose-50 text-rose-700',
  soon: 'bg-amber-50 text-amber-700',
  open: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-500'
};
