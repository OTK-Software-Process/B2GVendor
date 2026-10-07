import {
  detectProcurementMethod,
  detectFiscalYear,
  estimateFiscalYearFromProjectId,
  findSubmissionDeadline,
  extractProcurementFacts,
  mergeProcurementFacts,
  PROCUREMENT_METHODS
} from '../../src/utils/procurementFacts';

// Pure-function check (no DB, no network): the deterministic readers for the
// procurement method, fiscal year and bid deadline. The strings below are REAL
// -- titles from the live feed and passages copied out of real invitation PDFs
// (including how their form-filled values come out scattered). Run:
// npm run check:facts

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function expectEqual<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  record(a === e, label, `expected ${e}, got ${a}`);
}

// Bangkok wall-clock time ("2026-09-24 09:00") of a Date, so expectations read like the document.
function bkk(date: Date | undefined): string | undefined {
  return date ? new Date(date.getTime() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) : undefined;
}

function deadlineOf(text: string): { start?: string; end?: string; hasTime?: boolean } | undefined {
  const d = findSubmissionDeadline(text);
  return d ? { start: bkk(d.startAt), end: bkk(d.endAt), hasTime: d.hasTime } : undefined;
}

// --- procurement method: real titles -----------------------------------------
expectEqual(
  'e-bidding (title)',
  detectProcurementMethod('ประกวดราคาซื้อครุภัณฑ์สำนักงาน (เครื่องปรับอากาศแบบแขวน ระบบ Inverter) จำนวน ๙ เครื่อง (กองการศึกษา) ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)'),
  'e-bidding'
);
expectEqual('เฉพาะเจาะจง (title)', detectProcurementMethod('ซื้อครุภัณฑ์คอมพิวเตอร์ จำนวน ๓ รายการ (กองคลัง) โดยวิธีเฉพาะเจาะจง'), 'specific');
expectEqual('คัดเลือก (title)', detectProcurementMethod('ซื้อชุดเสาไฟถนนโคมไฟแอลอีดี จำนวน ๗๓ ชุด  โดยวิธีคัดเลือก'), 'selection');
expectEqual(
  'e-market with a stray space and no space before the bracket (real title)',
  detectProcurementMethod('ซื้อกระดาษถ่ายเอกสาร A4 ขนาด 80 แกรม จำนวน 15,000 รีม ด้วยวิธี ตลาดอิเล็กทรอนิกส์(e-market)'),
  'e-market'
);
expectEqual(
  'ประกาศเชิญชวนทั่วไป (real consultant-hiring title)',
  detectProcurementMethod('จ้างที่ปรึกษาโครงการจ้างที่ปรึกษาจัดทำแผนยุทธศาสตร์ดิจิทัลและแผนปฏิบัติการดิจิทัลของกรมบัญชีกลาง โดยวิธีประกาศเชิญชวนทั่วไป'),
  'open-invitation'
);
expectEqual('"ประกวดราคา" in a title is not by itself e-bidding', detectProcurementMethod('ประกวดราคาซื้อครุภัณฑ์สำนักงาน'), undefined);
expectEqual('no method stated -> nothing', detectProcurementMethod('ซื้อวัสดุสำนักงาน จำนวน ๕ รายการ'), undefined);
expectEqual('whitespace scattered inside the words (pdf.js)', detectProcurementMethod('ซื้อเครื่องพิมพ์ โดยวิธี เฉ พาะ เจาะ จง'), 'specific');
expectEqual(
  'the first method named wins',
  detectProcurementMethod('ซื้อโต๊ะ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding) ยกเว้นวิธีเฉพาะเจาะจง'),
  'e-bidding'
);
expectEqual(
  "a method mentioned only deep in boilerplate does not relabel a document",
  detectProcurementMethod('เรื่อง ซื้อโต๊ะ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding) ' + 'ก'.repeat(2500) + ' กรณีวิธีเฉพาะเจาะจง'),
  'e-bidding'
);
record(
  PROCUREMENT_METHODS.every(m => m.aliases.length > 0 && m.tagName.length > 0) && new Set(PROCUREMENT_METHODS.map(m => m.tagName)).size === PROCUREMENT_METHODS.length,
  'every method has a unique tag name and at least one alias'
);

// --- fiscal year ---------------------------------------------------------------
expectEqual('FY in a title (real)', detectFiscalYear('จ้างจัดทำโล่รางวัล ประจำปีงบประมาณ พ.ศ. ๒๕๖๙ จำนวน ๒ รายการ โดยวิธีเฉพาะเจาะจง'), 2569);
expectEqual('FY written "พ.ศ.2570" with no space and Arabic digits (real)', detectFiscalYear('บำรุงรักษา ประจำปีงบประมาณ พ.ศ.2570 โดยวิธีเฉพาะเจาะจง'), 2570);
expectEqual('FY without "พ.ศ."', detectFiscalYear('โครงการ ปีงบประมาณ 2569'), 2569);
expectEqual('FY with stray whitespace inside "ปีงบประมาณ"', detectFiscalYear('ปีงบ ประมาณ พ.ศ. ๒๕๖๙'), 2569);
expectEqual(
  "the header's year beats the next year named in the budget-law clause (real draft TOR)",
  detectFiscalYear('จัดหา ปีงบประมาณ พ.ศ. ๒๕๖๙ ด้วยวิธีประกวดราคา ' + 'ก'.repeat(2500) + ' ประจำปีงบประมาณ พ.ศ. ๒๕๗๐ มีผลใช้บังคับ'),
  2569
);
expectEqual(
  'no year in the header -> the most frequent later one',
  detectFiscalYear('ก'.repeat(2000) + ' ปีงบประมาณ พ.ศ. ๒๕๗๐ ... ปีงบประมาณ พ.ศ. ๒๕๗๐ ... ปีงบประมาณ พ.ศ. ๒๕๖๙'),
  2570
);
expectEqual('"ปีงบประมาณ" with no year after it (contract template) -> nothing', detectFiscalYear('ให้ระบุเลขที่สัญญาในปีงบประมาณหนึ่ง ๆ ตามลำดับ'), undefined);
expectEqual('a bare "งบประมาณ 2568" is not a fiscal year', detectFiscalYear('งบประมาณ 2568 ตามแผน'), undefined);
expectEqual('an implausible year is rejected', detectFiscalYear('ปีงบประมาณ 1999'), undefined);
expectEqual('a garbled numeral (real pdf.js damage "๒๕:๗๐") is not guessed', detectFiscalYear('ประจำปีงบประมาณ พ.ศ. ๒๕:๗๐ เพื่อดำเนินการ'), undefined);

// --- fiscal year estimated from the project number ---------------------------------
expectEqual('project 69099397073 (Sep 2569) -> FY2569', estimateFiscalYearFromProjectId('69099397073'), 2569);
expectEqual('project 68109145267 (Oct 2568) -> the NEXT fiscal year, 2569', estimateFiscalYearFromProjectId('68109145267'), 2569);
expectEqual('project registered in September -> still that fiscal year', estimateFiscalYearFromProjectId('68099000001'), 2568);
expectEqual('project registered in January', estimateFiscalYearFromProjectId('69019000001'), 2569);
expectEqual('a project number of an unexpected shape -> nothing', estimateFiscalYearFromProjectId('X123'), undefined);
expectEqual('month 13 is not a month', estimateFiscalYearFromProjectId('69139000001'), undefined);

// --- bid deadline: passages copied from real invitation PDFs ---------------------------
// 534d5854 -- the day sits right after "ในวันที่", month+year and BOTH times are glued together later.
const REAL_534 = `๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๔
 ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่กันยายน ๒๕๖๙๐๙.๐๐๑๒.๐๐
ประกาศจนถึงวันเสนอราคา
๓. ผู้สนใจสามารถดูรายละเอียดและดาวน์โหลดเอกสารประกวดราคาอิเล็กทรอนิกส์เลขที่
 ลงวันที่  ผ่านทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ ได้ ๑๓๐/๒๕๖๙ ๑๖  กันยายน  พ.ศ. ๒๕๖๙`;
expectEqual('real form-filled PDF (534d5854): 24 Sep 2569, 09.00-12.00', deadlineOf(REAL_534), { start: '2026-09-24 09:00', end: '2026-09-24 12:00', hasTime: true });

// 64d0c81d -- here the day number lands after "ตั้งแต่วัน", not after "ในวันที่".
const REAL_64D = `๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่
 ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วัน๑๗ กันยายน ๒๕๖๙๐๙.๐๐๑๒.๐๐
ที่ประกาศจนถึงวันเสนอราคา
๓. ผู้สนใจสามารถดูรายละเอียด`;
expectEqual('real PDF (64d0c81d): the day lands after "ตั้งแต่วัน"', deadlineOf(REAL_64D), { start: '2026-09-17 09:00', end: '2026-09-17 12:00', hasTime: true });

// 983be06d -- an afternoon window.
const REAL_983 = `๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๓
 ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่กันยายน ๒๕๖๙๑๓.๐๐๑๖.๐๐
ประกาศจนถึงวันเสนอราคา`;
expectEqual('real PDF (983be06d): afternoon window 13.00-16.00', deadlineOf(REAL_983), { start: '2026-09-23 13:00', end: '2026-09-23 16:00', hasTime: true });

// d9782c20 -- the NEXT line is a different event (technical presentation on the 28th at 13.30).
const REAL_D97 = `๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๕
 ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่กันยายน ๒๕๖๙๐๙.๐๐๑๒.๐๐
ประกาศจนถึงวันเสนอราคา
๒๘                         ผู้ยื่นข้อเสนอต้องเข้านําเสนอข้อเสนอทางด้านเทคนิคให้สํานักงานพิจารณา ในวันที่
กันยายน ๒๕๖๙ เวลา ๑๓.๓๐ น. เป็นต้นไป ณ สํานักงานส่งเสริมเศรษฐกิจดิจิทัล`;
expectEqual('real PDF (d9782c20): the technical-presentation date (28th, 13.30) is NOT taken', deadlineOf(REAL_D97), {
  start: '2026-09-25 09:00',
  end: '2026-09-25 12:00',
  hasTime: true
});

// 003204b3 -- a draft ("ร่าง"): every field is blank.
const REAL_BLANK = `๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่
ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอ
ราคา
๓. ผู้สนใจสามารถดูรายละเอียดและดาวน์โหลดเอกสารประกวดราคาอิเล็กทรอนิกส์เลขที่
ลงวันที่  ผ่านทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ ได้ตั้งแต่วันที่         กันยายน  พ.ศ. ๒๕๖๙`;
expectEqual('real blank draft template -> no deadline (the "download from" date is not a deadline)', deadlineOf(REAL_BLANK), undefined);

// --- other shapes the same sentence can take ---------------------------------------------
const CUE = 'ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์';
const TAIL = 'ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา';
expectEqual(
  'cleanly written date and time window',
  deadlineOf(`${CUE}ในวันที่ 25 กันยายน พ.ศ. 2569 ระหว่างเวลา 09.00 น. ถึง 12.00 น. ${TAIL}`),
  { start: '2026-09-25 09:00', end: '2026-09-25 12:00', hasTime: true }
);
expectEqual(
  'Thai numerals, "09:00" colon times',
  deadlineOf(`${CUE}ในวันที่ ๒๕ กันยายน ๒๕๖๙ ระหว่างเวลา ๐๙:๐๐ น. ถึง ๑๒:๓๐ น. ${TAIL}`),
  { start: '2026-09-25 09:00', end: '2026-09-25 12:30', hasTime: true }
);
expectEqual(
  'a single time is the closing time (no start)',
  deadlineOf(`${CUE}ในวันที่ 25 กันยายน 2569 เวลา 16.30 น. ${TAIL}`),
  { start: undefined, end: '2026-09-25 16:30', hasTime: true }
);
expectEqual(
  'date only -> closes at the end of that day, no time shown',
  deadlineOf(`${CUE}ในวันที่ 25 กันยายน 2569 ${TAIL}`),
  { start: undefined, end: '2026-09-25 23:59', hasTime: false }
);
expectEqual(
  'a span of dates, with the window times on its ends',
  deadlineOf(`${CUE}ระหว่างวันที่ 17 ถึงวันที่ 25 กันยายน 2569 ระหว่างเวลา 09.00 น. ถึง 12.00 น. ${TAIL}`),
  { start: '2026-09-17 09:00', end: '2026-09-25 12:00', hasTime: true }
);
expectEqual(
  'a span of dates across two months',
  deadlineOf(`${CUE}ระหว่างวันที่ 28 กันยายน 2569 ถึงวันที่ 2 ตุลาคม 2569 ${TAIL}`),
  { start: '2026-09-28 00:00', end: '2026-10-02 23:59', hasTime: false }
);
expectEqual('abbreviated month "ก.ย." and a Christian-era year', deadlineOf(`${CUE}ในวันที่ 25 ก.ย. 2026 ${TAIL}`), {
  start: undefined,
  end: '2026-09-25 23:59',
  hasTime: false
});
expectEqual('a date that does not exist (31 Feb) is rejected', deadlineOf(`${CUE}ในวันที่ 31 กุมภาพันธ์ 2569 ${TAIL}`), undefined);
expectEqual('an hour that does not exist is rejected', deadlineOf(`${CUE}ในวันที่ 25 กันยายน 2569 ระหว่างเวลา 25.00 น. ถึง 27.00 น. ${TAIL}`), {
  start: undefined,
  end: '2026-09-25 23:59',
  hasTime: false
});
expectEqual(
  'a window whose close is before its open is rejected',
  deadlineOf(`${CUE}ในวันที่ 25 กันยายน 2569 ระหว่างเวลา 16.00 น. ถึง 09.00 น. ${TAIL}`),
  undefined
);
expectEqual('a date with no announcement cue is never guessed', deadlineOf('ภายในวันที่ 25 กันยายน 2569 เวลา 16.30 น.'), undefined);
expectEqual('empty text', deadlineOf(''), undefined);

// --- all three at once + merging ------------------------------------------------------------
{
  const facts = extractProcurementFacts(`ประกาศ เรื่อง ซื้อโต๊ะ ปีงบประมาณ พ.ศ. ๒๕๖๙ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)\n${REAL_534}`);
  expectEqual('extractProcurementFacts reads method + year + deadline from one document', [facts.method, facts.fiscalYear, bkk(facts.deadline?.endAt)], [
    'e-bidding',
    2569,
    '2026-09-24 12:00'
  ]);
  expectEqual('no text -> no facts', extractProcurementFacts(''), {});
}
{
  const merged = mergeProcurementFacts({ fiscalYear: 2569 }, undefined, { fiscalYear: 2570, method: 'specific' }, { method: 'selection' });
  expectEqual('merge: the earlier document wins per field, gaps are filled by later ones', [merged.fiscalYear, merged.method, merged.deadline], [
    2569,
    'specific',
    undefined
  ]);
}

const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
