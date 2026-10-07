/**
 * Deterministic readers for three facts a Thai procurement announcement states
 * in its own text -- the procurement METHOD (วิธีการจัดซื้อจัดจ้าง), the FISCAL
 * YEAR (ปีงบประมาณ) and the bid-submission DEADLINE (วัน/เวลายื่นข้อเสนอ).
 *
 * Why deterministic and not the AI: the e-GP RSS feed carries none of the three
 * as a field (only title/link/description/pubDate), the wording is highly
 * regular, and a wrong answer here silently files a work under the wrong
 * filter or shows a vendor the wrong closing date -- so every reader is a
 * strict pattern that returns nothing rather than guess. Built and checked
 * against 45 real TOR PDFs and 530 real titles (tests/integration/
 * procurement-facts.check.ts), including the awkward cases found there:
 *   - the METHOD is in every title ("... ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์
 *     (e-bidding)", "... โดยวิธีเฉพาะเจาะจง");
 *   - invitation PDFs are filled-in FORMS whose values land out of order in the
 *     extracted text ("ในวันที่ ๒๔ ... ตั้งแต่วันที่กันยายน ๒๕๖๙๐๙.๐๐๑๒.๐๐"),
 *     and draft TORs leave the fields blank -- blank means "no deadline", never
 *     a guess;
 *   - a document can mention two fiscal years (its own, and the next one in the
 *     budget-law clause), so the header wins.
 *
 * Pure functions only -- no I/O.
 */

import { normalizeText, spaced, anyOf } from './priceExtraction';

// --- procurement method -----------------------------------------------------

export type ProcurementMethodKey =
  | 'e-bidding'
  | 'e-market'
  | 'selection'
  | 'specific'
  | 'special'
  | 'design-contest'
  | 'open-invitation';

export interface ProcurementMethodDef {
  key: ProcurementMethodKey;
  // The name of the 'method' Tag this maps to (the controlled vocabulary the
  // website filters on) and the synonyms it is seeded with.
  tagName: string;
  aliases: string[];
  pattern: RegExp;
}

// The methods e-GP titles actually use (พ.ร.บ.จัดซื้อจัดจ้างฯ พ.ศ. ๒๕๖๐). The two
// e-bidding / e-market tag names are the ones already in the seed data, so an
// existing database keeps its tags (and their followers).
export const PROCUREMENT_METHODS: readonly ProcurementMethodDef[] = [
  {
    key: 'e-bidding',
    tagName: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    aliases: ['e-bidding', 'อีบิดดิ้ง', 'ประกวดราคาอิเล็กทรอนิกส์'],
    pattern: new RegExp(`${anyOf('ประกวดราคาอิเล็กทรอนิกส์')}|e\\s*-?\\s*bidding`, 'i')
  },
  {
    key: 'e-market',
    tagName: 'วิธีตลาดอิเล็กทรอนิกส์ (e-market)',
    aliases: ['e-market', 'อีมาร์เก็ต', 'ตลาดอิเล็กทรอนิกส์'],
    pattern: new RegExp(`${anyOf('ตลาดอิเล็กทรอนิกส์')}|e\\s*-?\\s*market`, 'i')
  },
  {
    key: 'selection',
    tagName: 'วิธีคัดเลือก',
    aliases: ['คัดเลือก'],
    pattern: new RegExp(anyOf('วิธีคัดเลือก'))
  },
  {
    key: 'specific',
    tagName: 'วิธีเฉพาะเจาะจง',
    aliases: ['เฉพาะเจาะจง'],
    pattern: new RegExp(anyOf('เฉพาะเจาะจง'))
  },
  {
    key: 'special',
    tagName: 'วิธีกรณีพิเศษ',
    aliases: ['กรณีพิเศษ'],
    pattern: new RegExp(anyOf('วิธีกรณีพิเศษ'))
  },
  {
    key: 'design-contest',
    tagName: 'วิธีประกวดแบบ',
    aliases: ['ประกวดแบบ'],
    pattern: new RegExp(anyOf('ประกวดแบบ'))
  },
  {
    // Seen on a real title (consultant hiring): "... โดยวิธีประกาศเชิญชวนทั่วไป".
    key: 'open-invitation',
    tagName: 'วิธีประกาศเชิญชวนทั่วไป',
    aliases: ['ประกาศเชิญชวนทั่วไป'],
    pattern: new RegExp(anyOf('วิธีประกาศเชิญชวนทั่วไป'))
  }
];

// A document's own method line ("เรื่อง ... ด้วยวิธี...") is in its opening
// lines; further down, the boilerplate mentions other methods in passing ("...
// ยกเว้นกรณีวิธีเฉพาะเจาะจง"), which must not relabel an e-bidding document.
const HEADER_CHARS = 1500;

/**
 * The method named in a title, or in the opening of a document. When several
 * are named, the first one wins.
 */
export function detectProcurementMethod(rawText: string): ProcurementMethodKey | undefined {
  const text = normalizeText(rawText).slice(0, HEADER_CHARS);

  let best: { key: ProcurementMethodKey; index: number } | undefined;
  for (const def of PROCUREMENT_METHODS) {
    const match = def.pattern.exec(text);
    if (match && (!best || match.index < best.index)) best = { key: def.key, index: match.index };
  }
  return best?.key;
}

export function methodByKey(key: ProcurementMethodKey): ProcurementMethodDef {
  return PROCUREMENT_METHODS.find(m => m.key === key) as ProcurementMethodDef;
}

// --- fiscal year ------------------------------------------------------------

// Thai fiscal year runs 1 Oct - 30 Sep and is written in the Buddhist Era.
const MIN_FISCAL_YEAR = 2550;

function currentBuddhistYear(now: Date): number {
  return now.getUTCFullYear() + 543;
}

function isPlausibleFiscalYear(year: number, now: Date): boolean {
  return year >= MIN_FISCAL_YEAR && year <= currentBuddhistYear(now) + 3;
}

// "ปีงบประมาณ พ.ศ. ๒๕๖๙" | "ปีงบประมาณ ๒๕๖๙" | "ปีงบประมาณ พ.ศ.๒๕๖๙". The label must be
// "ปีงบประมาณ" itself: a bare "งบประมาณ 2568" or "ประจำปี 2568" is not
// necessarily a fiscal year (and "งบประมาณ 2568" is a known false lead for the
// price scan too).
const FISCAL_YEAR = new RegExp(
  `${spaced('ปีงบประมาณ')}\\s*(?:พ\\s*\\.\\s*ศ\\s*\\.?)?\\s*(\\d{4})(?!\\d)`,
  'g'
);

/**
 * The fiscal year (Buddhist Era, e.g. 2569) a document says it belongs to.
 * The opening of the document -- where the title states it -- wins over later
 * mentions (a draft TOR also says "...ปีงบประมาณ ๒๕๗๐ มีผลใช้บังคับ" in its
 * budget-law clause for the NEXT year); with none in the opening, the most
 * frequent mention, then the earliest.
 */
export function detectFiscalYear(rawText: string, now: Date = new Date()): number | undefined {
  const text = normalizeText(rawText);

  const mentions: { year: number; index: number }[] = [];
  for (const match of text.matchAll(FISCAL_YEAR)) {
    const year = Number(match[1]);
    if (isPlausibleFiscalYear(year, now)) mentions.push({ year, index: match.index ?? 0 });
  }
  if (mentions.length === 0) return undefined;

  const inHeader = mentions.find(m => m.index < HEADER_CHARS);
  if (inHeader) return inHeader.year;

  const counts = new Map<number, number>();
  for (const m of mentions) counts.set(m.year, (counts.get(m.year) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return mentions.find(m => counts.get(m.year) === top)?.year;
}

/**
 * A fallback ESTIMATE from the e-GP project number, which starts with the
 * Buddhist-Era year and month the project was registered ("69099397073" =
 * 2569, month 09). Registered Oct-Dec belongs to the NEXT fiscal year. Only an
 * estimate: a project registered in advance for the following year's budget
 * (confirmed on real drafts: project 6908... whose documents say ปีงบประมาณ
 * ๒๕๗๐) is off by one -- which is why callers mark it 'estimated' and let a
 * year stated in a document replace it.
 */
export function estimateFiscalYearFromProjectId(projectId: string, now: Date = new Date()): number | undefined {
  const match = /^(\d{2})(0[1-9]|1[0-2])\d{5,}$/.exec(projectId.trim());
  if (!match) return undefined;

  const year = 2500 + Number(match[1]) + (Number(match[2]) >= 10 ? 1 : 0);
  return isPlausibleFiscalYear(year, now) ? year : undefined;
}

// --- bid-submission deadline -------------------------------------------------

export interface SubmissionDeadline {
  // When the bid window opens -- set when the document gives a start (the first
  // of two times, or the first of two dates). Undefined = only a close is given.
  startAt?: Date;
  // When it closes. This is the instant the website counts down to and sorts by.
  endAt: Date;
  // Whether a clock time was stated. false = date only; endAt is then the end of
  // that day and the website shows no time.
  hasTime: boolean;
}

const MONTHS: { full: string; abbr: string; n: number }[] = [
  { full: 'มกราคม', abbr: 'ม.ค.', n: 1 },
  { full: 'กุมภาพันธ์', abbr: 'ก.พ.', n: 2 },
  { full: 'มีนาคม', abbr: 'มี.ค.', n: 3 },
  { full: 'เมษายน', abbr: 'เม.ย.', n: 4 },
  { full: 'พฤษภาคม', abbr: 'พ.ค.', n: 5 },
  { full: 'มิถุนายน', abbr: 'มิ.ย.', n: 6 },
  { full: 'กรกฎาคม', abbr: 'ก.ค.', n: 7 },
  { full: 'สิงหาคม', abbr: 'ส.ค.', n: 8 },
  { full: 'กันยายน', abbr: 'ก.ย.', n: 9 },
  { full: 'ตุลาคม', abbr: 'ต.ค.', n: 10 },
  { full: 'พฤศจิกายน', abbr: 'พ.ย.', n: 11 },
  { full: 'ธันวาคม', abbr: 'ธ.ค.', n: 12 }
];

const MONTH_BY_WORD = new Map<string, number>();
for (const m of MONTHS) {
  MONTH_BY_WORD.set(m.full, m.n);
  MONTH_BY_WORD.set(m.abbr.replace(/\./g, ''), m.n);
}

// An abbreviation may be written with or without its dots and with stray
// spaces: "ก.ย." / "กย" / "ก . ย .".
function abbrPattern(abbr: string): string {
  return [...abbr.replace(/\./g, '')].join('\\s*\\.?\\s*') + '\\s*\\.?';
}
const MONTH_ALT = [...MONTHS.map(m => spaced(m.full)), ...MONTHS.map(m => abbrPattern(m.abbr))].join('|');

function monthNumber(matched: string): number | undefined {
  return MONTH_BY_WORD.get(matched.replace(/[\s.]/g, ''));
}

// "กันยายน ๒๕๖๙" / "กันยายน พ.ศ. ๒๕๖๙". The year is exactly four digits starting
// 25 (B.E.) or 20 (C.E.) and is NOT required to end the token: a form-filled
// PDF glues the time straight onto it ("256909.0012.00").
const MONTH_YEAR = new RegExp(`(${MONTH_ALT})\\s*(?:พ\\s*\\.\\s*ศ\\s*\\.?\\s*)?(2[05]\\d{2})`, 'u');
const MONTH_ONLY = new RegExp(`(${MONTH_ALT})`, 'u');

// Where the sentence that names the bid-submission time starts, in the e-GP
// invitation template: "ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐ
// ด้วยอิเล็กทรอนิกส์ในวันที่ <date> ระหว่างเวลา <t1> น. ถึง <t2> น. ซึ่งสามารถ
// จัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา". Add another
// wording here only after seeing it in a real document.
const DEADLINE_CUES = [new RegExp(spaced('เสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐ'))];
// The sentence ends there. Cutting the window matters: the line after it in some
// templates ("ผู้ยื่นข้อเสนอต้องเข้านำเสนอข้อเสนอทางด้านเทคนิค ... วันที่ ๒๘
// กันยายน เวลา ๑๓.๓๐ น.") is a different event, not the bid deadline.
const DEADLINE_END = new RegExp(`${spaced('จนถึงวันเสนอ')}|${spaced('ผู้สนใจสามารถ')}`);
const MAX_WINDOW_CHARS = 420;

const TIME = /(\d{1,2})\s*[.:]\s*(\d{2})/g;
const DAY = /(?<![\d.:/])(\d{1,2})(?![\d.:/])/;

function toCommonEra(year: number): number {
  return year >= 2400 ? year - 543 : year;
}

// A calendar date + clock time in Thailand (UTC+7, no DST), or null when it is
// not a real date (31 Feb) or time.
function bangkok(year: number, month: number, day: number, hour = 0, minute = 0, endOfDay = false): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return endOfDay ? new Date(Date.UTC(year, month - 1, day, 23 - 7, 59)) : new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}

interface ClockTime {
  hour: number;
  minute: number;
}

function readTimes(text: string): ClockTime[] {
  const times: ClockTime[] = [];
  for (const m of text.matchAll(TIME)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour <= 23 && minute <= 59) times.push({ hour, minute });
  }
  return times;
}

// "ระหว่างวันที่ 17 ถึงวันที่ 25 กันยายน 2569" -- a span of DATES (rather than a
// time window within one day). Month/year may be stated on either or both ends.
const DATE_SPAN = new RegExp(
  `(\\d{1,2})\\s*(?:(${MONTH_ALT})\\s*(?:พ\\s*\\.\\s*ศ\\s*\\.?\\s*)?(2[05]\\d{2})?)?\\s*(?:${spaced('ถึง')}|-|–)\\s*(?:${spaced('วันที่')}\\s*)?(\\d{1,2})\\s*(${MONTH_ALT})\\s*(?:พ\\s*\\.\\s*ศ\\s*\\.?\\s*)?(2[05]\\d{2})`,
  'u'
);

function findDateSpan(window: string): { start: Date; end: Date } | null {
  const m = DATE_SPAN.exec(window);
  if (!m) return null;

  const endMonth = monthNumber(m[5]);
  const endYear = toCommonEra(Number(m[6]));
  if (!endMonth) return null;
  const startMonth = m[2] ? monthNumber(m[2]) : endMonth;
  const startYear = m[3] ? toCommonEra(Number(m[3])) : endYear;
  if (!startMonth) return null;

  const start = bangkok(startYear, startMonth, Number(m[1]), 0, 0);
  const end = bangkok(endYear, endMonth, Number(m[4]), 0, 0, true);
  return start && end && start <= end ? { start, end } : null;
}

/**
 * The bid-submission deadline an invitation announcement states, or undefined
 * when it has none (a draft TOR's fields are blank; most other documents never
 * state one). Reads only the one sentence of the e-GP template that names it.
 */
export function findSubmissionDeadline(rawText: string): SubmissionDeadline | undefined {
  const text = normalizeText(rawText);

  for (const cue of DEADLINE_CUES) {
    const cueMatch = cue.exec(text);
    if (!cueMatch) continue;

    const rest = text.slice(cueMatch.index);
    const end = DEADLINE_END.exec(rest);
    const window = rest.slice(0, Math.min(end ? end.index : MAX_WINDOW_CHARS, MAX_WINDOW_CHARS));

    const deadline = parseDeadlineWindow(window);
    if (deadline) return deadline;
  }
  return undefined;
}

function parseDeadlineWindow(window: string): SubmissionDeadline | undefined {
  const span = findDateSpan(window);
  if (span) {
    const [first, second] = readTimes(window);
    // Times, when given, are the opening time of the first date and the closing
    // time of the last.
    const startAt = first ? withClock(span.start, first) : span.start;
    const close = second ?? first;
    const endAt = close ? withClock(span.end, close) : span.end;
    return { startAt, endAt, hasTime: Boolean(first) };
  }

  const my = MONTH_YEAR.exec(window);
  if (!my) return undefined;
  const month = monthNumber(my[1]);
  if (!month) return undefined;
  const year = toCommonEra(Number(my[2]));

  // Take the date tokens out, so what is left is the day and the clock times.
  const rest = window.slice(0, my.index) + ' ' + window.slice(my.index + my[0].length);
  const times = readTimes(rest);
  const restWithoutTimes = rest.replace(TIME, ' ');
  const dayMatch = DAY.exec(restWithoutTimes);
  if (!dayMatch) return undefined;
  const day = Number(dayMatch[1]);

  if (times.length === 0) {
    const endAt = bangkok(year, month, day, 0, 0, true);
    return endAt ? { endAt, hasTime: false } : undefined;
  }

  // "ระหว่างเวลา 09.00 น. ถึง 12.00 น." = a window that opens at the first time
  // and closes at the second; a single time is the closing time.
  const open: ClockTime | undefined = times.length >= 2 ? times[0] : undefined;
  const close: ClockTime = times.length >= 2 ? times[1] : times[0];
  const endAt = bangkok(year, month, day, close.hour, close.minute);
  const startAt = open ? bangkok(year, month, day, open.hour, open.minute) : undefined;
  if (!endAt || (open && !startAt)) return undefined;
  if (startAt && startAt > endAt) return undefined;
  return { startAt: startAt ?? undefined, endAt, hasTime: true };
}

// Re-times an end-of-day / midnight Date (as produced by bangkok()) to a clock time.
function withClock(date: Date, time: ClockTime): Date {
  // The date is a Bangkok calendar day: shift to Bangkok wall-clock, set the
  // time, shift back.
  const wall = new Date(date.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), time.hour - 7, time.minute));
}

// --- everything at once -------------------------------------------------------

export interface ProcurementFacts {
  method?: ProcurementMethodKey;
  fiscalYear?: number;
  deadline?: SubmissionDeadline;
}

/** Reads all three facts from one document's FULL text. */
export function extractProcurementFacts(rawText: string, now: Date = new Date()): ProcurementFacts {
  if (!rawText) return {};
  const facts: ProcurementFacts = {};

  const method = detectProcurementMethod(rawText);
  if (method) facts.method = method;
  const fiscalYear = detectFiscalYear(rawText, now);
  if (fiscalYear) facts.fiscalYear = fiscalYear;
  const deadline = findSubmissionDeadline(rawText);
  if (deadline) facts.deadline = deadline;

  return facts;
}

/** Combines several documents' facts, the earlier one winning per field (primary document first). */
export function mergeProcurementFacts(...list: (ProcurementFacts | undefined)[]): ProcurementFacts {
  const merged: ProcurementFacts = {};
  for (const facts of list) {
    if (!facts) continue;
    merged.method ??= facts.method;
    merged.fiscalYear ??= facts.fiscalYear;
    merged.deadline ??= facts.deadline;
  }
  return merged;
}
