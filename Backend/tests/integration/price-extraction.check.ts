import {
  findPriceCandidates,
  mergePriceCandidates,
  pickBestPrice,
  formatPriceHints
} from '../../src/utils/priceExtraction';

// Pure-function check (no DB, no network): the deterministic "บาท"-anchored
// price finder that backs the AI's budget field. Run: npm run check:price

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function best(text: string): number | null {
  return pickBestPrice(findPriceCandidates(text))?.amount ?? null;
}

function expectBest(label: string, text: string, expected: number | null): void {
  const actual = best(text);
  record(actual === expected, label, `expected ${expected}, got ${actual}`);
}

// --- basics ---------------------------------------------------------------
expectBest('ราคากลาง with a normal amount + "บาท"', 'ราคากลางของโครงการ 1,250,000.00 บาท (หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน)', 1250000);
expectBest('วงเงินงบประมาณ label', 'วงเงินงบประมาณ 4,800,000 บาท', 4800000);
expectBest('วงเงินในการจัดหา label', 'วงเงินในการจัดหาครั้งนี้ 985,000.50 บาท', 985000.5);
expectBest('Thai numerals are normalised', 'วงเงินงบประมาณ ๑,๒๐๐,๐๐๐.๐๐ บาท', 1200000);
expectBest('stray spaces inside "บาท" (bad PDF extraction)', 'ราคากลาง 750,000 บ า ท', 750000);
expectBest('zero-width characters are ignored', 'ราคากลาง​ 320,000​ บาท', 320000);
expectBest('"ล้านบาท" multiplier', 'วงเงินงบประมาณ 1.5 ล้านบาท', 1500000);
expectBest('amount on the next line after the label', 'ราคากลาง\n\n2,100,000.00\nบาท', 2100000);
expectBest('"1,250,000.-บาท" style', 'ราคากลาง 1,250,000.-บาท', 1250000);
expectBest('฿ symbol', 'ราคากลาง ฿ 640,000', 640000);
expectBest('label trailing in brackets', 'รวม 3,450,000 บาท (ราคากลาง)', 3450000);

// --- pdf.js scatters whitespace/newlines inside Thai words (around vowel/tone marks) ---
expectBest('label split by pdf.js: "วงเง<nl>ิ<nl>น"', 'วงเง\nิ\nนงบประมาณ 4,800,000 บาท', 4800000);
expectBest('label split by spaces: "ได ้รับ" style', 'วงเง ิ นท ี่ จะซ ื้ อหร ื อจ ้ าง 610,000 บาท', 610000);
expectBest('total wording split too, label still wins', 'ราคากลางของงาน เป ็ นเง ิ นท ั ้ งส ิ ้ น 12,345,000 บาท', 12345000);
expectBest('exclusion wording split by pdf.js is still excluded', 'ค ่ าปร ั บว ั นละ 5,000 บาท', null);
expectBest('guarantee wording split by pdf.js is still excluded', 'วงเง ิ นประก ั นส ั ญญา ร้อยละ 5 เป็นเงิน 50,000 บาท', null);
{
  const candidates = findPriceCandidates('วงเง\nิ\nนงบประมาณ 4,800,000 บาท');
  record(candidates[0]?.labelText === 'วงเงินงบประมาณ', 'labelText is normalised (no stray whitespace)', `got ${JSON.stringify(candidates[0]?.labelText)}`);
}

// --- table layout: unit lives in the column header, not next to the figure -
expectBest('label + bare figure (unit in header)', 'ตารางราคากลาง ราคากลาง 2,345,678.00', 2345678);
expectBest('a fiscal year is NOT a price', 'งบประมาณ 2568 ตามแผนปฏิบัติการ', null);
expectBest('a bare small number after a label is NOT a price', 'ราคากลาง ตามข้อ 4 ของเอกสาร', null);

// --- priority + selection --------------------------------------------------
expectBest(
  'ราคากลาง beats วงเงินงบประมาณ',
  'วงเงินงบประมาณ 5,000,000 บาท และราคากลาง 4,900,000 บาท',
  4900000
);
expectBest(
  'largest wins among equally-labelled figures',
  'ราคากลางค่าออกแบบ 300,000 บาท ราคากลางรวมโครงการ 4,900,000 บาท',
  4900000
);

// --- things that sit next to "บาท" but are not the price -------------------
expectBest('fine per day is excluded', 'ค่าปรับวันละ 5,000 บาท', null);
expectBest('bid deposit is excluded', 'หลักประกันซอง 25,000 บาท', null);
expectBest('document fee is excluded', 'ค่าซื้อเอกสารประกวดราคา 500 บาท', null);
expectBest('per-unit rate is excluded (prefix)', 'ราคากลาง หน่วยละ 300 บาท', null);
expectBest('per-month rate is excluded (suffix)', 'ราคากลาง 15,000 บาท/เดือน', null);
expectBest(
  'a real price still wins next to excluded ones',
  'ค่าปรับวันละ 5,000 บาท หลักประกันซอง 25,000 บาท ราคากลางของโครงการ 2,000,000 บาท',
  2000000
);
expectBest('contract guarantee ("วงเงินประกันสัญญา") is excluded', 'วงเงินประกันสัญญา ร้อยละ 5 เป็นเงิน 50,000 บาท', null);
expectBest('unlabelled amount is never auto-picked', 'ระยะเวลาดำเนินการ 90 วัน มูลค่า 1,000,000 บาท', null);

// --- realistic sentence / table shapes ---------------------------------------
expectBest(
  'ราคากลาง followed by a generic "เป็นเงินทั้งสิ้น" is still the reference price',
  'ราคากลางของงานจ้างก่อสร้างในการประกวดราคาครั้งนี้ เป็นเงินทั้งสิ้น 12,345,000.00 บาท',
  12345000
);
expectBest('a total-only figure is a hint, never auto-picked', 'รวมเป็นเงินทั้งสิ้น 500,000 บาท', null);
expectBest(
  'numbered table: ราคากลาง preferred over the allocated budget',
  '3. วงเงินงบประมาณที่ได้รับจัดสรร 2,000,000.00 บาท\n4. ลักษณะงานโดยสังเขป จัดซื้อระบบ\n5. ราคากลางคำนวณ ณ วันที่ 1 มีนาคม 2568 เป็นเงิน 1,987,500.00 บาท',
  1987500
);
expectBest('an unrelated fine earlier in the sentence does not veto a labelled price', 'ค่าปรับ 0.10 ต่อวัน ราคากลาง 1,000,000 บาท', 1000000);

// --- root cause: the price is far past the AI's truncation point ----------
{
  const filler = 'ขอบเขตของงานและรายละเอียดคุณลักษณะเฉพาะ '.repeat(600); // ~24k chars
  const doc = `${filler}\nตารางแสดงวงเงินงบประมาณและราคากลาง\nราคากลาง 7,654,321.00 บาท`;
  record(doc.length > 8000 && doc.indexOf('7,654,321') > 8000, 'fixture really has the price beyond 8,000 chars');
  expectBest('price found beyond the 8,000-char AI cut-off', doc, 7654321);
}

// --- candidates + hints -----------------------------------------------------
{
  const text = 'ค่าปรับวันละ 5,000 บาท ราคากลาง 900,000 บาท รวมเป็นเงิน 910,000 บาท';
  const candidates = findPriceCandidates(text);
  record(candidates.length === 3, 'three distinct amounts found', `got ${candidates.map(c => c.amount).join(',')}`);
  record(candidates[0].amount === 900000 && candidates[0].label === 'reference-price', 'best-ranked candidate first');
  record(candidates[candidates.length - 1].excluded, 'excluded candidates rank last');
  const hints = formatPriceHints(candidates);
  record(hints.includes('900,000 บาท') && hints.includes('EXCLUDED'), 'hints render amounts and flag exclusions');
}

{
  const main = findPriceCandidates('รายละเอียดคุณลักษณะ ไม่มีราคา', 'doc_main.pdf');
  const attachment = findPriceCandidates('ราคากลาง 1,111,000 บาท', 'Attach_TOR_1.pdf');
  const merged = mergePriceCandidates(main, attachment);
  record(pickBestPrice(merged)?.amount === 1111000, 'attachment price is found via merged candidates');
  record(merged[0].source === 'Attach_TOR_1.pdf', 'merged candidate remembers its source file');
}

// --- winner announcements: the price is the WINNING BID ---------------------
// Wording copied from the real e-GP winner template (20 live pages, identical).
const WINNER_TEXT =
  'ผู้ได้รับการคัดเลือก ได้แก่ ห้างหุ้นส่วนจำกัด ทดสอบ (ขายส่ง,ขายปลีก,ให้บริการ) โดยเสนอราคา เป็นเงินทั้งสิ้น ๑๕๖,๐๐๐.๐๐ บาท ' +
  '( หนึ่งแสนห้าหมื่นหกพันบาทถ้วน ) รวมภาษีมูลค่าเพิ่มและภาษีอื่น ค่าขนส่ง ค่าจดทะเบียน และค่าใช้จ่ายอื่นๆ ทั้งปวง';
{
  const asWinner = pickBestPrice(findPriceCandidates(WINNER_TEXT), { acceptAwarded: true });
  record(asWinner?.amount === 156000 && asWinner.label === 'awarded-price', 'winner announcement: the winning bid is the price', `got ${asWinner?.amount} [${asWinner?.label}]`);
  record(asWinner?.labelText === 'เสนอราคาเป็นเงินทั้งสิ้น', 'and it is labelled with its own wording, not a generic "total"', `got ${asWinner?.labelText}`);
  record(pickBestPrice(findPriceCandidates(WINNER_TEXT)) === null, 'the same wording in any OTHER document is never auto-picked (gated)');
}
expectBest('a winning bid is not a price for a non-winner document', 'โดยเสนอราคา เป็นเงินทั้งสิ้น 156,000.00 บาท', null);
{
  const pick = (text: string) => pickBestPrice(findPriceCandidates(text), { acceptAwarded: true })?.amount ?? null;
  record(pick('โดยเสนอราคาเป็นเงิน ทั้งสิ้น 20,734.00 บาท') === 20734, 'winner wording with the "เป็นเงิน ทั้งสิ้น" whitespace variant');
  record(pick('โดยเสนอราคา\nเป็นเงินทั้งสิ้น  ๔๑๗,๐๒๒.๑๒  บาท') === 417022.12, 'across a line break, with Thai numerals and satang');
  record(pick('โดยเสน อ ราคา เป็นเงินทั้ง สิ้ น 17,500.00 บาท') === 17500, 'and with pdf.js-style stray spaces inside the words');
  record(pick('ราคาที่เสนอ (บาท) 48,150.00') === 48150, 'table layout: "ราคาที่เสนอ" with the unit in the header');
  record(pick('เสนอราคาเป็นเงินทั้งสิ้น 100,000 บาท และเสนอราคาเป็นเงินทั้งสิ้น 250,000 บาท') === 250000, 'several winners/lots: the largest figure wins (never over-counts)');
  record(pick('วงเงินงบประมาณ 200,000 บาท โดยเสนอราคาเป็นเงินทั้งสิ้น 180,000 บาท') === 200000, 'a real budget in the same page outranks the winning bid');
  record(pick('ค่าปรับวันละ 5,000 บาท โดยเสนอราคาเป็นเงินทั้งสิ้น 90,000 บาท') === 90000, 'a fine mentioned earlier does not veto the winning bid');
  record(pick('ประกาศรายชื่อผู้ชนะการเสนอราคา ประกาศ ณ วันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙ ปีงบประมาณ ๒๕๗๐') === null, 'a winner page with no amount at all yields nothing (dates/fiscal years are not prices)');
}

// --- nothing / junk -----------------------------------------------------------
expectBest('empty text', '', null);
expectBest('text with no price at all', 'ขอบเขตของงานจ้างพัฒนาระบบสารสนเทศ ระยะเวลา 180 วัน', null);
expectBest('absurdly large number is rejected', 'ราคากลาง 99,999,999,999,999,999 บาท', null);

console.log(results.join('\n'));
const failures = results.filter(line => line.startsWith('FAIL')).length;
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
