/**
 * Deterministic price finder for Thai procurement documents -- the safety net
 * behind the AI's "budget" field.
 *
 * Why this exists: the AI used to skip prices that ARE in the document, for
 * two mechanical reasons rather than because it can't read Thai:
 *   1. pdfText.service.ts caps the text sent to the AI at a few thousand
 *      characters, and the ราคากลาง / วงเงินงบประมาณ figure usually sits in a
 *      cost table far past that cut-off -- the model never even saw it.
 *   2. For an e-GP draft-TOR zip only the main "doc_*" PDF was read at all,
 *      while the ราคากลาง table is often a separate numbered attachment.
 *
 * This module scans the FULL text of every PDF for amounts written with "บาท"
 * (the anchor -- every Thai price carries it), works out what the words just
 * before the figure say it is, and returns them ranked. The result is used
 * twice (see integrations/ai): listed in the prompt so the model can't miss
 * one, and as a fallback when the model still returns nothing (or AI is off).
 *
 * Pure functions only -- no I/O -- so it is trivially unit-testable.
 */

// What the wording next to a figure says it is. 'reference-price' and 'budget'
// are auto-selected for any document. 'awarded-price' -- the winning bid in a
// winner announcement ("โดยเสนอราคาเป็นเงินทั้งสิ้น ...") -- is auto-selected
// ONLY when the caller says the document IS a winner announcement (see
// pickBestPrice): the same wording elsewhere (a bid form, an instruction to
// bidders) is not a price. 'total' ("รวมเป็นเงิน ...") is too generic (a BOQ
// subtotal, a quotation total) to trust without the model's judgement, so it
// is only ever offered as a hint.
export type PriceLabel = 'reference-price' | 'budget' | 'awarded-price' | 'total';

export interface PriceCandidate {
  amount: number; // in THB
  raw: string; // as written in the document, e.g. "1,250,000.00 บาท"
  label: PriceLabel | null;
  labelText: string | null; // the Thai wording matched, e.g. "ราคากลาง"
  // A fine, bid deposit, document fee or per-unit/period rate -- appears next
  // to "บาท" constantly in invitation documents but is never the project
  // price. Kept (flagged) so the model can be told to ignore it, never picked.
  excluded: boolean;
  context: string; // up to ~90 chars immediately BEFORE the figure, one line
  source?: string; // which file it came from, when the caller sets it
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

// Thai government documents often use Thai numerals (๑,๒๐๐,๐๐๐) and PDF text
// extraction leaves zero-width characters and ragged whitespace everywhere.
export function normalizeText(text: string): string {
  return text
    .replace(/[๐-๙]/g, digit => String(THAI_DIGITS.indexOf(digit)))
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ');
}

// PDF text extraction (pdf.js) scatters whitespace and line breaks INSIDE Thai
// words, always around the combining vowel/tone marks -- confirmed on real
// PDFs: "เชิญ" comes out as "เช<newline>ิ<newline>ญ" and "ได้รับ" as "ได ้รับ".
// "ราคากลาง" and "บาท" have no such marks, but "วงเงิน..." (ิ), "ค่าปรับ" (่)
// and most other keywords here do, so every keyword is matched with optional
// whitespace allowed between its characters.
export function spaced(word: string): string {
  return [...word].join('\\s*');
}
export function anyOf(...words: string[]): string {
  return words.map(spaced).join('|');
}

interface LabelRule {
  kind: PriceLabel;
  pattern: RegExp;
}

// Longer wordings first inside each alternation so "วงเงินงบประมาณ" matches as
// one label rather than as the shorter "วงเงิน".
const LABEL_RULES: LabelRule[] = [
  { kind: 'reference-price', pattern: new RegExp(anyOf('ราคากลาง'), 'g') },
  {
    kind: 'budget',
    pattern: new RegExp(
      anyOf(
        'วงเงินงบประมาณ',
        'วงเงินในการจัดหา',
        'วงเงินที่จะซื้อหรือจ้าง',
        'วงเงินที่จะจัดซื้อจัดจ้าง',
        'วงเงินโครงการ',
        'วงเงินค่าจ้าง',
        'กรอบวงเงิน',
        'วงเงิน',
        'งบประมาณ'
      ),
      'g'
    )
  },
  {
    // The one figure a winner announcement carries -- e-GP's template reads
    // "...ผู้ได้รับการคัดเลือก ได้แก่ <winner> โดยเสนอราคา เป็นเงินทั้งสิ้น ๑๕๖,๐๐๐.๐๐ บาท
    // (…บาทถ้วน)" (confirmed on 20 live pages, all the same wording).
    kind: 'awarded-price',
    pattern: new RegExp(anyOf('เสนอราคาเป็นเงินทั้งสิ้น', 'เสนอราคาเป็นเงิน', 'ราคาที่เสนอ'), 'g')
  },
  {
    kind: 'total',
    pattern: new RegExp(
      anyOf('รวมเป็นเงินทั้งสิ้น', 'รวมเงินทั้งสิ้น', 'เป็นเงินทั้งสิ้น', 'รวมเป็นเงิน', 'รวมทั้งสิ้น', 'ราคารวม', 'รวมราคา'),
      'g'
    )
  }
];

const LABEL_PRIORITY: Record<PriceLabel, number> = { 'reference-price': 0, budget: 1, 'awarded-price': 2, total: 3 };

// Words BEFORE a figure that mark it as something other than the project
// price: per-unit/period rates, fines, deposits, fees.
// (The guarantee wordings matter because "วงเงินประกันสัญญา" contains the
// budget wording "วงเงิน" -- only the part AFTER the label is checked.)
const PREFIX_EXCLUSION = new RegExp(
  anyOf(
    'ต่อหน่วย',
    'หน่วยละ',
    'ต่อเดือน',
    'เดือนละ',
    'ต่อปี',
    'ปีละ',
    'ต่อวัน',
    'วันละ',
    'ต่อครั้ง',
    'ครั้งละ',
    'คนละ',
    'ค่าปรับ',
    'เบี้ยปรับ',
    'หลักประกัน',
    'เงินประกัน',
    'ประกันซอง',
    'ประกันสัญญา',
    'ค่าประกัน',
    'ค่าธรรมเนียม',
    'ค่าซื้อเอกสาร',
    'ค่าเอกสาร',
    'ค่าจำหน่ายเอกสาร',
    'ค่าสำเนา',
    'ค่าแบบ'
  )
);
// A rate written straight after the unit: "500 บาท/หน่วย", "500 บาทต่อเดือน".
const SUFFIX_EXCLUSION = new RegExp(String.raw`^\s*(?:/|${spaced('ต่อ')})`);

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)`;
// "บาท" tolerates stray whitespace between its letters (PDF text extraction
// does that), and "ล้าน/แสน/หมื่น/พัน" covers "1.5 ล้านบาท".
const BAHT = String.raw`(?:บ\s*า\s*ท|฿|baht)`;

// 1,250,000.00 บาท | 1,250,000.-บาท | 1.5 ล้านบาท
const AMOUNT_WITH_UNIT = new RegExp(
  String.raw`(?<![\d,.])${NUMBER}\s*(?:\.\s*-\s*)?(?:(ล้าน|แสน|หมื่น|พัน)\s*)?${BAHT}`,
  'giu'
);
// ฿1,250,000
const AMOUNT_AFTER_SYMBOL = new RegExp(String.raw`฿\s*${NUMBER}`, 'gu');
// Table layouts where the unit lives in a column header: "ราคากลาง 1,250,000.00".
// Only for the strongest labels, and the number must look like money (thousands
// separators or 5+ digits) so "งบประมาณ 2568" (a fiscal year) is never a price.
const STRONG_LABELS = anyOf(
  'ราคากลาง',
  'วงเงินงบประมาณ',
  'วงเงินในการจัดหา',
  'วงเงินที่จะซื้อหรือจ้าง',
  'วงเงินที่จะจัดซื้อจัดจ้าง',
  'วงเงินโครงการ',
  'ราคาที่เสนอ'
);
const LABELED_AMOUNT = new RegExp(
  String.raw`(${STRONG_LABELS})[^\d]{0,40}?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{5,}(?:\.\d{1,2})?)(?![\d,])`,
  'gu'
);

const MULTIPLIERS: Record<string, number> = { ล้าน: 1e6, แสน: 1e5, หมื่น: 1e4, พัน: 1e3 };

const CONTEXT_CHARS = 120; // how far back to look for a label / exclusion wording
const MAX_CANDIDATES = 20;

function isSaneAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount < 1e12;
}

function parseAmount(integerPart: string, decimalPart: string | undefined, multiplierWord?: string): number {
  const base = parseFloat(integerPart.replace(/,/g, '') + (decimalPart ? `.${decimalPart}` : ''));
  return multiplierWord ? base * (MULTIPLIERS[multiplierWord] ?? 1) : base;
}

interface FoundLabel {
  kind: PriceLabel;
  text: string;
  end: number; // where the label ends inside the searched string
}

function nearestLabelOfKinds(haystack: string, kinds: PriceLabel[]): FoundLabel | null {
  let best: FoundLabel | null = null;
  for (const rule of LABEL_RULES) {
    if (!kinds.includes(rule.kind)) continue;
    for (const match of haystack.matchAll(rule.pattern)) {
      const end = (match.index ?? 0) + match[0].length;
      if (!best || end > best.end) best = { kind: rule.kind, text: match[0], end };
    }
  }
  return best;
}

// Among ราคากลาง / budget / winning-bid wordings, the one closest to the figure
// wins ("ราคากลาง ... วงเงินงบประมาณ 500,000 บาท" is a budget figure). A generic
// total wording only labels the figure when NO such wording is around --
// otherwise the very common "ราคากลางของงาน... เป็นเงินทั้งสิ้น X บาท" would be
// demoted to a mere "total" by the "เป็นเงินทั้งสิ้น" that follows the label.
function nearestLabel(haystack: string): FoundLabel | null {
  return nearestLabelOfKinds(haystack, ['reference-price', 'budget', 'awarded-price']) ?? nearestLabelOfKinds(haystack, ['total']);
}

interface RawHit {
  index: number; // where the figure starts in the normalized text
  end: number; // where the matched span (figure + unit) ends
  amount: number;
}

function collectHits(text: string): RawHit[] {
  const hits: RawHit[] = [];
  const seenStarts = new Set<number>();

  const push = (index: number, end: number, amount: number): void => {
    if (!isSaneAmount(amount) || seenStarts.has(index)) return;
    seenStarts.add(index);
    hits.push({ index, end, amount });
  };

  for (const m of text.matchAll(AMOUNT_WITH_UNIT)) {
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, parseAmount(m[1], m[2], m[3]));
  }

  for (const m of text.matchAll(AMOUNT_AFTER_SYMBOL)) {
    const numberText = m[1] + (m[2] ? `.${m[2]}` : '');
    const end = (m.index ?? 0) + m[0].length;
    push(end - numberText.length, end, parseAmount(m[1], m[2]));
  }

  for (const m of text.matchAll(LABELED_AMOUNT)) {
    const numberText = m[2];
    const end = (m.index ?? 0) + m[0].length;
    const [integerPart, decimalPart] = numberText.split('.');
    push(end - numberText.length, end, parseAmount(integerPart, decimalPart));
  }

  return hits.sort((a, b) => a.index - b.index);
}

// Lower is better -- used both to de-duplicate and to order the output.
function rank(candidate: PriceCandidate): number {
  if (candidate.excluded) return 9;
  return candidate.label ? LABEL_PRIORITY[candidate.label] : 4;
}

function byRank(a: PriceCandidate, b: PriceCandidate): number {
  return rank(a) - rank(b);
}

// One entry per distinct amount (the best-ranked reading of it), best first.
// Array#sort is stable, so equal ranks keep document order.
function dedupeByAmount(candidates: PriceCandidate[]): PriceCandidate[] {
  const best = new Map<number, PriceCandidate>();
  for (const candidate of candidates) {
    const existing = best.get(candidate.amount);
    if (!existing || rank(candidate) < rank(existing)) best.set(candidate.amount, candidate);
  }
  return [...best.values()].sort(byRank);
}

/**
 * Finds every price-looking amount in `rawText` (the FULL document text, not
 * the capped copy sent to the AI), best candidates first.
 */
export function findPriceCandidates(rawText: string, source?: string): PriceCandidate[] {
  if (!rawText) return [];
  const text = normalizeText(rawText);

  const candidates: PriceCandidate[] = collectHits(text).map(hit => {
    const before = text.slice(Math.max(0, hit.index - CONTEXT_CHARS), hit.index);
    const after = text.slice(hit.end, hit.end + 40);

    let label = nearestLabel(before);
    if (!label) {
      // "... 1,250,000 บาท (ราคากลาง)" -- a label can also trail the figure,
      // but ONLY when parenthesised straight after it; an unbracketed label
      // further on usually belongs to the NEXT statement, not this figure.
      const bracketed = after.match(/^\s*[(（[]\s*(.{0,30})/);
      const trailing = bracketed ? nearestLabel(bracketed[1]) : null;
      if (trailing) label = { ...trailing, end: 0 };
    }

    // Only the words between the label and the figure can disqualify it
    // (or, with no label, the few words right before it) -- an unrelated fine
    // mentioned earlier in the sentence must not knock out a real price.
    const segment = label && label.end > 0 ? before.slice(label.end) : before.slice(-60);
    const excluded = PREFIX_EXCLUSION.test(segment) || SUFFIX_EXCLUSION.test(after);

    return {
      amount: hit.amount,
      raw: text.slice(hit.index, hit.end).trim(),
      label: label?.kind ?? null,
      labelText: label ? label.text.replace(/\s+/g, '') : null,
      excluded,
      context: before.trim().slice(-90),
      ...(source ? { source } : {})
    };
  });

  return dedupeByAmount(candidates).slice(0, MAX_CANDIDATES);
}

/** Combines the candidates of several files (main PDF + attachments) into one ranked list. */
export function mergePriceCandidates(...lists: PriceCandidate[][]): PriceCandidate[] {
  return dedupeByAmount(lists.flat()).slice(0, MAX_CANDIDATES);
}

export interface PickPriceOptions {
  // The document is a winner announcement, so a figure worded as the winning
  // bid ("เสนอราคาเป็นเงินทั้งสิ้น") is the price. Off for everything else.
  acceptAwarded?: boolean;
}

/**
 * The one figure safe to use WITHOUT the AI's judgement: a non-excluded amount
 * explicitly labelled ราคากลาง or a budget wording (or, for a winner
 * announcement, the winning bid). ราคากลาง beats a budget wording, which beats
 * a winning bid; among equals the largest wins, because a table also repeats
 * component/unit figures and the project total is the biggest of them.
 */
export function pickBestPrice(candidates: PriceCandidate[], options: PickPriceOptions = {}): PriceCandidate | null {
  const accepted: PriceLabel[] = options.acceptAwarded
    ? ['reference-price', 'budget', 'awarded-price']
    : ['reference-price', 'budget'];
  const eligible = candidates.filter(c => !c.excluded && c.label !== null && accepted.includes(c.label));
  if (eligible.length === 0) return null;

  return eligible.reduce((best, c) => {
    const diff = LABEL_PRIORITY[c.label as PriceLabel] - LABEL_PRIORITY[best.label as PriceLabel];
    if (diff < 0) return c;
    if (diff === 0 && c.amount > best.amount) return c;
    return best;
  });
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Renders candidates as prompt lines for the AI (see integrations/ai/prompt.ts).
 * Capped so a document full of "บาท" can't blow up the prompt; the ranking
 * means the cap only ever drops the least relevant ones.
 */
export function formatPriceHints(candidates: PriceCandidate[], maxLines = 12): string {
  return candidates
    .slice(0, maxLines)
    .map((c, i) => {
      const parts = [
        `${i + 1}. ${formatAmount(c.amount)} บาท`,
        `label: ${c.labelText ?? 'none'}`,
        `context: "…${c.context}"`
      ];
      if (c.source) parts.push(`file: ${c.source}`);
      if (c.excluded) parts.push('EXCLUDED (fine / deposit / fee / unit or period rate -- not the project price)');
      return parts.join(' | ');
    })
    .join('\n');
}
