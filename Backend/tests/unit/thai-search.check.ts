import assert from 'node:assert/strict';
import { buildThaiSearchRegex, normalizeThaiSearchText } from '../../src/utils/thaiSearch';

assert.equal(normalizeThaiSearchText('งบประมาณ ๑๒๓๔๕๖๗๘๙๐'), 'งบประมาณ 1234567890');
assert.equal(normalizeThaiSearchText('เเผนงาน'), 'แผนงาน');

const digitRegex = buildThaiSearchRegex('งบประมาณ ๑๒๓');
assert.match('โครงการ งบประมาณ 123 บาท', digitRegex);

const saraAeRegex = buildThaiSearchRegex('เเผนงาน');
assert.match('ประกาศแผนงานประจำปี', saraAeRegex);

const typoRegex = buildThaiSearchRegex('โครงการก่อส้างถนน');
assert.match('โครงการก่อสร้างถนน', typoRegex);

const exactRegex = buildThaiSearchRegex('งาน');
assert.match('ประกาศงานประจำปี', exactRegex);
assert.doesNotMatch('ประกาศโครงการประจำปี', exactRegex);

console.log('Thai search normalization and typo-tolerance checks passed.');
