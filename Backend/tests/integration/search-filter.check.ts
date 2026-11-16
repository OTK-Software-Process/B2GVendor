// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import mongoose, { Types } from 'mongoose';
import { env } from '../../src/config/env';
import { GovSite } from '../../src/models/govSite.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';

// Search & Filter Work (Use Case 6.2.2): GET /works and GET /works/fiscal-years
// through the real HTTP API, on a fixture of 130 visible works plus one hidden
// by the topic filter. Uses its own throwaway database (dropped at the start and
// end) -- never touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-search-filter-check';

// Backend/.env may hold REAL SMTP credentials: this check must never send mail.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (text: string) => new Date(text);

// ------------------------------------------------------------------ the fixture
type TagKey = 'doh' | 'moph' | 'depa' | 'ebid' | 'specific' | 'construction' | 'equipment' | 'smartcity' | 'survey' | 'oldagency';
interface Fixture {
  id: string;
  site: 'doh' | 'moph' | 'depa' | 'bulk';
  title: string;
  description?: string;
  status: 'PLANNED' | 'DRAFT_TOR' | 'BIDDING' | 'CANCELLED' | 'AMENDED' | 'AWARDED';
  budget?: number;
  pubDate?: Date;
  fiscalYear?: number;
  deadlineAt?: Date;
  tags: TagKey[];
  hidden?: boolean;
}

const LONG_TITLE = 'ก่อสร้างถนนสายหลักเชื่อมต่อระหว่างอำเภอเมืองกับอำเภอบางละมุงจังหวัดชลบุรีพร้อมสะพานข้ามแม่น้ำและระบบระบายน้ำตลอดสาย';
const now = Date.now();

const named: Fixture[] = [
  { id: 'P1', site: 'doh', title: 'ก่อสร้างถนนสายบางปะอินจังหวัดพระนครศรีอยุธยา', description: 'จ้างก่อสร้างผิวทางลาดยางแอสฟัลต์พร้อมไหล่ทางและระบบระบายน้ำ', status: 'BIDDING', budget: 5_000_000, pubDate: iso('2026-03-10T02:00:00Z'), fiscalYear: 2569, deadlineAt: new Date(now + 10 * DAY), tags: ['doh', 'ebid', 'construction'] },
  { id: 'P2', site: 'doh', title: 'ปรับปรุงสะพานข้ามแม่น้ำเจ้าพระยา', status: 'AWARDED', budget: 12_000_000, pubDate: iso('2026-02-01T03:00:00Z'), fiscalYear: 2569, deadlineAt: new Date(now + 5 * DAY), tags: ['doh', 'specific', 'construction', 'survey'] },
  // 2026-03-10 17:30 UTC is 00:30 on 11 March in Bangkok: a day boundary
  { id: 'P3', site: 'moph', title: 'จัดซื้อเวชภัณฑ์ยาสำหรับโรงพยาบาล', status: 'DRAFT_TOR', budget: 800_000, pubDate: iso('2026-03-10T17:30:00Z'), fiscalYear: 2569, tags: ['moph', 'ebid'] },
  // 2025-12-31 16:59:59 UTC is 23:59:59 on 31 December in Bangkok: the last second of a day
  { id: 'P4', site: 'moph', title: 'แผนจัดซื้อครุภัณฑ์การแพทย์ประจำปี', status: 'PLANNED', pubDate: iso('2025-12-31T16:59:59Z'), fiscalYear: 2568, tags: ['moph', 'equipment'] },
  { id: 'P5', site: 'depa', title: 'ระบบเมืองอัจฉริยะ Smart City Platform', status: 'CANCELLED', budget: 300_000, pubDate: iso('2026-04-01T03:00:00Z'), fiscalYear: 2569, tags: ['depa', 'smartcity'] },
  // same budget and same publish time as P1: ties
  { id: 'P6', site: 'doh', title: 'ก่อสร้างถนนสายลำปางงานซ่อมบำรุง', status: 'AMENDED', budget: 5_000_000, pubDate: iso('2026-03-10T02:00:00Z'), fiscalYear: 2569, deadlineAt: new Date(now + 3 * DAY), tags: ['doh', 'construction', 'oldagency'] },
  { id: 'P7', site: 'doh', title: 'ก่อสร้างถนนสายลับซ่อน', description: 'โครงการที่ถูกซ่อนไว้จากหน้าสาธารณะ', status: 'BIDDING', budget: 5_000_000, pubDate: iso('2026-03-10T02:00:00Z'), fiscalYear: 2569, tags: ['doh', 'construction'], hidden: true },
  { id: 'P8', site: 'moph', title: 'จัดจ้างเหมาบริการ', description: 'รวมถึงงานติดตั้งระบบปรับอากาศและเครื่องกำเนิดไฟฟ้า', status: 'PLANNED', budget: 50_000, pubDate: iso('2026-03-15T03:00:00Z'), fiscalYear: 2569, tags: ['moph'] },
  // no price, no publish date, no fiscal year, no deadline
  { id: 'P9', site: 'doh', title: 'ถนนโครงการทดสอบไม่มีวันที่', status: 'BIDDING', tags: ['doh'] },
  { id: 'P10', site: 'doh', title: LONG_TITLE, status: 'BIDDING', budget: 7_500_000, pubDate: iso('2026-03-20T03:00:00Z'), fiscalYear: 2569, tags: ['doh'] },
  { id: 'P11', site: 'depa', title: 'ติดตั้งระบบ (CCTV) [เฟส 1] ราคา $5.00 + 100% ครบวงจร', status: 'BIDDING', budget: 1_250.5, pubDate: iso('2026-03-25T03:00:00Z'), fiscalYear: 2569, tags: ['depa'] }
];
// 120 works that tie on everything that is sorted: 60 priced, 60 unpriced
const bulk: Fixture[] = Array.from({ length: 120 }, (_, i) => ({
  id: `B${String(i).padStart(3, '0')}`, site: 'bulk', title: `ชุดทดสอบแบ่งหน้า ${i}`, status: 'BIDDING', budget: i < 60 ? 1000 : undefined, pubDate: iso('2026-05-01T03:00:00Z'), fiscalYear: 2570, tags: []
}));
const fixtures: Fixture[] = [...named, ...bulk];
const visible = fixtures.filter(f => !f.hidden);

interface Res { status: number; json: any; text: string; ms: number; headers: Headers }

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Work.init(), Tag.init(), GovSite.init()]);

  // ---------------------------------------------------------------- database
  const sites = {
    doh: await GovSite.create({ name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOH-HWY', deptId: '0806' }),
    moph: await GovSite.create({ name: 'สำนักงานปลัดกระทรวงสาธารณสุข', shortCode: 'MOPH', deptId: '2102' }),
    depa: await GovSite.create({ name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', shortCode: 'DEPA', deptId: '1106' }),
    bulk: await GovSite.create({ name: 'ไซต์ชุดทดสอบ', shortCode: 'BULK', deptId: '9999' })
  };
  const tags: Record<TagKey, Types.ObjectId> = {
    doh: (await Tag.create({ name: 'กรมทางหลวง', facet: 'site', siteId: sites.doh._id }))._id,
    moph: (await Tag.create({ name: 'สำนักงานปลัดกระทรวงสาธารณสุข', facet: 'site', siteId: sites.moph._id }))._id,
    depa: (await Tag.create({ name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', facet: 'site', siteId: sites.depa._id }))._id,
    ebid: (await Tag.create({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method' }))._id,
    specific: (await Tag.create({ name: 'วิธีเฉพาะเจาะจง', facet: 'method' }))._id,
    construction: (await Tag.create({ name: 'งานก่อสร้าง', facet: 'category' }))._id,
    equipment: (await Tag.create({ name: 'ครุภัณฑ์', facet: 'category' }))._id,
    smartcity: (await Tag.create({ name: 'เมืองอัจฉริยะ', facet: 'keyword' }))._id,
    survey: (await Tag.create({ name: 'กองสำรวจและออกแบบพิเศษ', facet: 'agency' }))._id,
    oldagency: (await Tag.create({ name: 'กรมเก่าที่เลิกแล้ว', facet: 'agency', retired: true }))._id
  };
  const facetOf: Record<TagKey, string> = { doh: 'site', moph: 'site', depa: 'site', ebid: 'method', specific: 'method', construction: 'category', equipment: 'category', smartcity: 'keyword', survey: 'agency', oldagency: 'agency' };
  await Work.insertMany(
    fixtures.map(f => ({
      siteId: sites[f.site]._id, projectId: f.id, title: f.title, description: f.description, status: f.status, announceType: 'D0',
      budget: f.budget, pubDate: f.pubDate, fiscalYear: f.fiscalYear, deadlineAt: f.deadlineAt, tags: f.tags.map(t => tags[t]),
      ...(f.hidden ? { ingestionRelevance: 'not-related' } : {})
    }))
  );

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function get(pathAndQuery: string, init: RequestInit = {}): Promise<Res> {
    const start = Date.now();
    const res = await fetch(`${origin}/api/v1${pathAndQuery}`, init);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, ms: Date.now() - start, headers: res.headers };
  }
  const q = (text: string) => encodeURIComponent(text);
  const ids = (r: Res): string[] => (r.json?.data?.items ?? []).map((w: any) => w.projectId);
  const total = (r: Res): number => r.json?.data?.total;
  const code = (r: Res) => r.json?.error?.code;
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  // every page of a search, collected
  async function everything(qs: string): Promise<{ ids: string[]; total: number; pages: number }> {
    const collected: string[] = [];
    let reportedTotal = 0;
    let pages = 0;
    for (let page = 1; page <= 20; page += 1) {
      const r = await get(`/works?${qs}${qs ? '&' : ''}pageSize=50&page=${page}`);
      if (r.status !== 200) throw new Error(`/works?${qs} page ${page} -> ${r.status} ${r.text.slice(0, 120)}`);
      reportedTotal = r.json.data.total;
      collected.push(...ids(r));
      pages += 1;
      if (r.json.data.items.length < 50) break;
    }
    return { ids: collected, total: reportedTotal, pages };
  }

  // ===================================================== 1. what a listing looks like
  const base = await get('/works');
  record(base.status === 200 && base.json.success === true, 'listing: GET /works answers 200 in the success envelope, with no sign-in', `${base.status}`);
  record(base.json.data.total === visible.length && base.json.data.page === 1 && base.json.data.pageSize === 20 && base.json.data.items.length === 20, `listing: total ${visible.length} (the hidden work is not counted), page 1, default page size 20`, JSON.stringify({ total: base.json.data.total, page: base.json.data.page, pageSize: base.json.data.pageSize }));
  const sample = (await get(`/works?q=${q('บางปะอิน')}`)).json.data.items[0];
  record(sample.projectId === 'P1' && sample.siteId?.name === 'กรมทางหลวง' && sample.siteId?.shortCode === 'DOH-HWY' && Array.isArray(sample.tags) && sample.tags.every((t: any) => t.name && t.facet), 'listing: each item carries its site (name, short code) and its tags (name, facet)');
  record(!('searchText' in sample) && !('excludedTags' in sample) && !/searchText|excludedTags/.test(base.text), 'listing: internal fields (searchText, excludedTags) are never sent');
  record(sample.title && sample.status && sample.budget === 5_000_000 && sample.fiscalYear === 2569 && sample.pubDate && sample.deadlineAt, 'listing: title, status, budget, fiscal year and dates are all present');
  const allVisible = await everything('');
  record(allVisible.ids.length === visible.length && !allVisible.ids.includes('P7'), 'listing: paging through everything yields every visible work and never the hidden one', `${allVisible.ids.length}`);
  record(!(await everything(`q=${q('สายลับซ่อน')}`)).ids.includes('P7') && total(await get(`/works?q=${q('ถูกซ่อนไว้จากหน้าสาธารณะ')}`)) === 0, 'listing: a work hidden by the topic filter cannot be found even by searching its own title or description');
  const fy = await get('/works/fiscal-years');
  record(fy.status === 200 && JSON.stringify(fy.json.data) === JSON.stringify([{ year: 2570, count: 120 }, { year: 2569, count: 8 }, { year: 2568, count: 1 }]), 'fiscal years: lists only years that have works, newest first, with counts (hidden work and unset years excluded)', JSON.stringify(fy.json?.data));

  // ============================================================== 2. keyword search
  const search = async (text: string) => ids(await get(`/works?q=${q(text)}&pageSize=50`));
  record(same(await search('ถนน'), ['P1', 'P6', 'P9', 'P10']), 'keyword: a Thai word in the title finds the works (and not the hidden one)', (await search('ถนน')).join());
  record(same(await search('ลาดยาง'), ['P1']), 'keyword: a word that is only in the description (the TOR summary) finds the work', (await search('ลาดยาง')).join());
  record(same(await search('เครื่องกำเนิดไฟฟ้า'), ['P8']), 'keyword: ...another work found only through its TOR summary', (await search('เครื่องกำเนิดไฟฟ้า')).join());
  record(same(await search('กรมทางหลวง'), ['P1', 'P2', 'P6', 'P9', 'P10']), 'agency: the agency\'s name finds all of its works, even where the title never says it', (await search('กรมทางหลวง')).join());
  record(same(await search('ปลัดกระทรวงสาธารณสุข'), ['P3', 'P4', 'P8']), 'agency: part of an agency name works the same', (await search('ปลัดกระทรวงสาธารณสุข')).join());
  record(same(await search('highways'), ['P1', 'P2', 'P6', 'P9', 'P10']) && same(await search('DOH-HWY'), ['P1', 'P2', 'P6', 'P9', 'P10']), 'agency: its English name and short code find it too (case-insensitive)');
  record(same(await search('สำรวจและออกแบบ'), ['P2']), 'agency: an agency tag\'s name finds the works carrying it (P2: no such word in its title)', (await search('สำรวจและออกแบบ')).join());
  record((await search('กรมเก่าที่เลิกแล้ว')).length === 0, 'agency: a RETIRED agency tag no longer finds anything');
  record(same(await search('ก่อสร้างถนน'), ['P1', 'P6', 'P10']), 'Thai: a multi-syllable phrase without spaces matches inside the title', (await search('ก่อสร้างถนน')).join());
  record(same(await search('ก่อส้างถนน'), ['P1', 'P6', 'P10']), 'typo: a missing letter ("ก่อส้างถนน") still finds them', (await search('ก่อส้างถนน')).join());
  record(same(await search('สพานข้ามแม่น้ำ'), ['P2', 'P10']) && same(await search('เวชภัณฑ์ยา'), ['P3']), 'typo: a missing vowel mark still finds the works about the bridge (P2, and P10 which builds one); exact text finds the medicine work', (await search('สพานข้ามแม่น้ำ')).join());
  record(same(await search('เเผนจัดซื้อ'), ['P4']), 'Thai: a doubled "เ" (typed เเ for แ) is read as แ');
  record(same(await search('ระบบ เมืองอัจฉริยะ'), ['P5']), 'words: two words separated by a space must both match', (await search('ระบบ เมืองอัจฉริยะ')).join());
  record(same(await search('ถนน บางปะอิน'), ['P1']) && same(await search('บางปะอิน ถนน'), ['P1']), 'words: "ถนน บางปะอิน" finds the work about both, in either order (not the exact phrase)', (await search('ถนน บางปะอิน')).join());
  record(same(await search('ก่อสร้าง   ถนน'), ['P1', 'P6', 'P10']) && same(await search('  ถนน  '), await search('ถนน')), 'words: extra or surrounding spaces make no difference');
  record((await search('ถนน เวชภัณฑ์')).length === 0, 'words: every word must match; a word that matches nothing together with another empties the result');
  record(same(await search('ถนน ถนน'), await search('ถนน')), 'words: a repeated word counts once');
  record(same(await search('ถนน กรมทางหลวง'), ['P1', 'P6', 'P9', 'P10']), 'words: a title word and an agency name combine (works about roads by that agency)', (await search('ถนน กรมทางหลวง')).join());
  record(same(await search('smart city'), ['P5']) && same(await search('SMART CITY'), ['P5']) && same(await search('Smart')  , ['P5']), 'Latin: case-insensitive, and two Latin words combine');
  record(same(await search('เมืองอัจฉริยะ platform'), ['P5']), 'mixed: a Thai and a Latin word in one search');
  record(total(await get('/works?q=')) === visible.length && total(await get(`/works?q=${q('   ')}`)) === visible.length, 'empty: a blank search box is no filter at all');
  const none = await get(`/works?q=${q('ไม่มีงานนี้อยู่จริง')}`);
  record(none.status === 200 && none.json.data.total === 0 && Array.isArray(none.json.data.items) && none.json.data.items.length === 0, 'empty: no match -> 200 with total 0 and an empty list (the "no results" state), not an error');
  // special characters are text, not syntax
  record(same(await search('(CCTV)'), ['P11']) && same(await search('$5.00'), ['P11']) && same(await search('[เฟส 1]'), ['P11']) && same(await search('100% ครบวงจร'), ['P11']), 'literal: brackets, dollar sign, dot and percent are searched as plain text', (await search('[เฟส 1]')).join());
  record(!(await search('.')).includes('P1') && !(await search('.*')).includes('P1') && (await search('.*')).length === 0, 'literal: "." and ".*" are not wildcards (they match only text that really contains them)', `${(await search('.')).join()} | ${(await search('.*')).join()}`);

  // long Thai text: the typo-tolerant pattern used to exceed MongoDB's regex size limit
  const chars = Array.from(LONG_TITLE);
  for (const n of [40, 55, 60, 64, 80, 110]) {
    const r = await get(`/works?q=${q(chars.slice(0, n).join(''))}`);
    record(r.status === 200 && ids(r).includes('P10'), `long text: a ${n}-character Thai query finds its work (was a server error from 60 characters)`, `${r.status} ${code(r) ?? ''} ${ids(r).join()}`);
  }
  const longTypo = await get(`/works?q=${q(chars.slice(0, 20).join('') + chars.slice(21, 64).join(''))}`);
  record(longTypo.status === 200, 'long text: a long query with a typo is answered (typo tolerance is dropped for very long text, never a server error)', `${longTypo.status}`);
  record((await get(`/works?q=${q('ก'.repeat(200))}`)).status === 200, 'long text: the longest allowed query (200 characters) is fine');
  const tooLong = await get(`/works?q=${q('ก'.repeat(201))}`);
  record(tooLong.status === 400 && code(tooLong) === 'VALIDATION_ERROR' && !!tooLong.json.error.fields.q, 'limits: a 201-character query -> 400, naming "q"');
  record((await get(`/works?q=${q('a b c d e f g h')}`)).status === 200, 'limits: 8 words are fine');
  const nineWords = await get(`/works?q=${q('a b c d e f g h i')}`);
  record(nineWords.status === 400 && !!nineWords.json.error.fields.q, 'limits: 9 words -> 400');

  // ================================================================= 3. every filter
  // The oracle is plain JavaScript over the fixture list, written independently of the service.
  const bkkDay = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  type F = Partial<{ status: string; site: keyof typeof sites; tag: TagKey[]; budgetMin: number; budgetMax: number; publishedFrom: string; publishedTo: string; fiscalYear: number }>;
  const oracle = (f: F): string[] =>
    visible
      .filter(w => {
        if (f.status && w.status !== f.status) return false;
        if (f.site && w.site !== f.site) return false;
        if (f.tag) {
          const byFacet = new Map<string, TagKey[]>();
          for (const t of f.tag) byFacet.set(facetOf[t], [...(byFacet.get(facetOf[t]) ?? []), t]);
          for (const group of byFacet.values()) if (!group.some(t => w.tags.includes(t))) return false; // same facet: any; different facets: all
        }
        if (f.budgetMin !== undefined && !(w.budget !== undefined && w.budget >= f.budgetMin)) return false;
        if (f.budgetMax !== undefined && !(w.budget !== undefined && w.budget <= f.budgetMax)) return false;
        if (f.publishedFrom && !(w.pubDate && bkkDay(w.pubDate) >= f.publishedFrom)) return false;
        if (f.publishedTo && !(w.pubDate && bkkDay(w.pubDate) <= f.publishedTo)) return false;
        if (f.fiscalYear !== undefined && w.fiscalYear !== f.fiscalYear) return false;
        return true;
      })
      .map(w => w.id);
  const qsOf = (f: F): string =>
    [
      f.status && `status=${f.status}`,
      f.site && `siteId=${sites[f.site]._id}`,
      f.tag && `tag=${f.tag.map(t => tags[t]).join(',')}`,
      f.budgetMin !== undefined && `budgetMin=${f.budgetMin}`,
      f.budgetMax !== undefined && `budgetMax=${f.budgetMax}`,
      f.publishedFrom && `publishedFrom=${f.publishedFrom}`,
      f.publishedTo && `publishedTo=${f.publishedTo}`,
      f.fiscalYear !== undefined && `fiscalYear=${f.fiscalYear}`
    ]
      .filter(Boolean)
      .join('&');
  let checkedFilters = 0;
  async function filterCase(label: string, f: F, extraQs = '', expected?: string[]): Promise<void> {
    checkedFilters += 1;
    const want = expected ?? oracle(f);
    const got = await everything([qsOf(f), extraQs].filter(Boolean).join('&'));
    const okIds = same(got.ids, want) && got.total === want.length && new Set(got.ids).size === got.ids.length;
    record(okIds && !got.ids.includes('P7'), `filter: ${label}`, okIds ? `${want.length} works` : `want ${want.length} [${want.slice(0, 12).join()}] got ${got.total}/${got.ids.length} [${got.ids.slice(0, 12).join()}]`);
  }

  // alone
  for (const status of ['PLANNED', 'DRAFT_TOR', 'BIDDING', 'CANCELLED', 'AMENDED', 'AWARDED']) await filterCase(`status=${status}`, { status });
  for (const site of ['doh', 'moph', 'depa', 'bulk']) await filterCase(`site=${site}`, { site });
  await filterCase('site with no matching works (valid id, nothing in it)', {}, `siteId=${new Types.ObjectId()}`, []);
  for (const t of ['doh', 'ebid', 'specific', 'construction', 'equipment', 'smartcity', 'survey'] as TagKey[]) await filterCase(`tag=${t} (${facetOf[t]} facet)`, { tag: [t] });
  await filterCase('tag: a well-formed id that is no tag matches nothing (200, empty)', {}, `tag=${new Types.ObjectId()}`, []);
  await filterCase('tags of the SAME facet are "either" (two categories)', { tag: ['construction', 'equipment'] });
  await filterCase('tags of DIFFERENT facets are "all" (method + category)', { tag: ['ebid', 'construction'] });
  await filterCase('tags: two sites (either) and a category (all)', { tag: ['doh', 'moph', 'construction'] });
  await filterCase('budgetMax=800000 (inclusive; unpriced works are not "cheap")', { budgetMax: 800_000 });
  await filterCase('budgetMin=5000000 (inclusive: P1, P6, P2, P10 ...)', { budgetMin: 5_000_000 });
  await filterCase('budgetMin=0 (every priced work, but no unpriced one)', { budgetMin: 0 });
  await filterCase('budget range 300000..5000000 (both ends inclusive)', { budgetMin: 300_000, budgetMax: 5_000_000 });
  await filterCase('budget range with a single value (min = max = 800000)', { budgetMin: 800_000, budgetMax: 800_000 });
  await filterCase('budget with satang: 1250.50', { budgetMin: 1250.5, budgetMax: 1250.5 });
  await filterCase('budget range nobody falls in', { budgetMin: 20_000_000, budgetMax: 30_000_000 });
  await filterCase('publishedFrom=2026-03-11 (P3 is 00:30 on 11 March in Bangkok)', { publishedFrom: '2026-03-11' });
  await filterCase('publishedTo=2026-03-10 (excludes P3, which is already 11 March in Bangkok)', { publishedTo: '2026-03-10' });
  await filterCase('publishedFrom = publishedTo = 2026-03-10 (a single Bangkok day)', { publishedFrom: '2026-03-10', publishedTo: '2026-03-10' });
  await filterCase('publishedTo=2025-12-31 includes 23:59:59 that day (inclusive end of day)', { publishedTo: '2025-12-31' });
  await filterCase('publishedFrom=2026-01-01 excludes it', { publishedFrom: '2026-01-01' });
  await filterCase('date range 2026-02-01..2026-03-15', { publishedFrom: '2026-02-01', publishedTo: '2026-03-15' });
  await filterCase('a date range with no works', { publishedFrom: '2024-01-01', publishedTo: '2024-12-31' });
  for (const fiscalYear of [2568, 2569, 2570, 2571]) await filterCase(`fiscalYear=${fiscalYear}`, { fiscalYear });
  record(!ids(await get('/works?publishedFrom=2000-01-01&pageSize=50')).includes('P9') && !ids(await get('/works?budgetMin=0&pageSize=50')).includes('P9') && !ids(await get('/works?fiscalYear=2569&pageSize=50')).includes('P9'), 'filter: a work with no price, publish date or fiscal year (P9) never matches a filter on that field');

  // combined
  await filterCase('status + site', { status: 'BIDDING', site: 'doh' });
  await filterCase('status + budgetMax', { status: 'BIDDING', budgetMax: 5_000_000 });
  await filterCase('site + fiscalYear + budgetMin', { site: 'doh', fiscalYear: 2569, budgetMin: 5_000_000 });
  await filterCase('tag + status', { tag: ['construction'], status: 'AMENDED' });
  await filterCase('tag + site + dates', { tag: ['doh', 'construction'], publishedFrom: '2026-03-01', publishedTo: '2026-03-31' });
  await filterCase('budget range + date range + fiscalYear', { budgetMin: 1000, budgetMax: 6_000_000, publishedFrom: '2026-03-01', publishedTo: '2026-03-31', fiscalYear: 2569 });
  await filterCase('EVERY filter at once (status, site, tag, budget range, date range, fiscal year)', { status: 'BIDDING', site: 'doh', tag: ['construction', 'ebid'], budgetMin: 1_000_000, budgetMax: 6_000_000, publishedFrom: '2026-03-10', publishedTo: '2026-03-10', fiscalYear: 2569 });
  await filterCase('filters that contradict each other (BIDDING + AWARDED-only site) -> nothing', { status: 'AWARDED', site: 'depa' });
  // with a keyword
  record(same(ids(await get(`/works?q=${q('ถนน')}&siteId=${sites.doh._id}&status=AMENDED`)), ['P6']), 'keyword + site + status finds exactly the one work');
  record(same(ids(await get(`/works?q=${q('ก่อส้างถนน')}&budgetMin=6000000`)), ['P10']), 'keyword (with a typo) + budgetMin');
  record(same(ids(await get(`/works?q=${q('ถนน')}&publishedFrom=2026-03-12&publishedTo=2026-03-31`)), ['P10']), 'keyword + publish-date range');
  record(same(ids(await get(`/works?q=${q('กรมทางหลวง')}&fiscalYear=2569&tag=${tags.construction}&status=BIDDING`)), ['P1']), 'keyword (an agency) + fiscal year + tag + status');
  record(same(ids(await get(`/works?q=${q('ถนน เวชภัณฑ์')}&status=BIDDING`)), []), 'keyword that matches nothing together with a filter: empty');
  record(same((await everything(`q=${q('ชุดทดสอบ')}&budgetMin=500`)).ids, bulk.filter(b => b.budget).map(b => b.id)), 'keyword + budgetMin across several pages (60 priced of 120)');

  // ================================================================== 4. sorting
  const items = async (qs: string) => (await get(`/works?${qs}&pageSize=50`)).json.data.items as any[];
  // the whole ordered list, page after page
  async function ordered(qs: string): Promise<any[]> {
    const list: any[] = [];
    for (let page = 1; page <= 4; page += 1) list.push(...(await get(`/works?${qs}&pageSize=50&page=${page}`)).json.data.items);
    return list;
  }
  const time = (i: any) => (i.pubDate ? new Date(i.pubDate).getTime() : null);
  const newestFirst = (list: any[]) => {
    const t = list.map(time);
    const firstMissing = t.indexOf(null);
    const present = firstMissing === -1 ? t : t.slice(0, firstMissing);
    return (firstMissing === -1 || t.slice(firstMissing).every(x => x === null)) && present.every((x, n) => n === 0 || (present[n - 1] as number) >= (x as number));
  };
  const byDate = await ordered('sort=date');
  const byDefault = await ordered('');
  record(newestFirst(byDate) && byDate.length === visible.length, 'sort: date is newest first (works with no date last)');
  record(JSON.stringify(byDefault.map(i => i.projectId)) === JSON.stringify(byDate.map(i => i.projectId)), 'sort: date is the default order');
  const descAll = await ordered('sort=budget-desc');
  const pricedDesc = descAll.filter(i => i.budget);
  record(pricedDesc.length === visible.filter(w => w.budget).length && pricedDesc.every((i, n) => n === 0 || pricedDesc[n - 1].budget >= i.budget) && descAll.slice(0, pricedDesc.length).every(i => i.budget), 'sort: budget-desc is non-increasing and puts every unpriced work last');
  record(['P2,P10,P6,P1', 'P2,P10,P1,P6'].includes(descAll.slice(0, 4).map(i => i.projectId).join()), 'sort: budget-desc starts with the most expensive works (the tie between P1 and P6 is settled the same way every time)', descAll.slice(0, 4).map(i => i.projectId).join());
  const ascItems = await ordered('sort=budget-asc');
  const pricedCount = visible.filter(w => w.budget).length;
  record(ascItems.findIndex(i => !i.budget) === pricedCount && ascItems.slice(0, pricedCount).every((i, n, a) => n === 0 || a[n - 1].budget <= i.budget), 'sort: budget-asc puts every priced work first, cheapest first, and the unpriced ones only after them (they do not float up as "free")', `first unpriced at ${ascItems.findIndex(i => !i.budget)} of ${pricedCount} priced`);
  record(ascItems[pricedCount - 1].projectId === 'P2' && ascItems[60].projectId === 'P11' && ascItems.slice(0, 60).every(i => i.projectId.startsWith('B')), 'sort: ...the 60 works at 1,000 baht, then P11 (1,250.50), ... up to P2 (12,000,000)');
  const dl = await items('sort=deadline');
  record(dl.slice(0, 2).map(i => i.projectId).join() === 'P6,P1', 'sort: deadline puts the soonest open deadline first (P6 in 3 days, then P1 in 10)', dl.slice(0, 3).map(i => i.projectId).join());
  const dlDesc = await items('sort=deadline-desc');
  record(dlDesc.slice(0, 2).map(i => i.projectId).join() === 'P1,P6', 'sort: deadline-desc puts the furthest open deadline first', dlDesc.slice(0, 3).map(i => i.projectId).join());
  record(!dl.slice(0, 2).some(i => i.projectId === 'P2') && (await ordered('sort=deadline')).findIndex(i => i.projectId === 'P2') > 1, 'sort: P2 (AWARDED, deadline still ahead) is not "upcoming": it comes after the open ones');
  record(same((await items('sort=deadline&status=AWARDED')).slice(0, 1).map(i => i.projectId), ['P2']), 'sort: with a status filter of AWARDED, its deadline counts (P2 first)');
  // paging must never repeat or drop a work, even when every sort value ties
  for (const sort of ['date', 'budget-asc', 'budget-desc', 'deadline', 'deadline-desc']) {
    const all = await everything(`sort=${sort}`);
    const distinct = new Set(all.ids).size;
    record(all.ids.length === visible.length && distinct === visible.length && all.total === visible.length, `paging: sort=${sort} across ${all.pages} pages shows each of the ${visible.length} works exactly once (120 of them tie on price and date)`, `${all.ids.length} listed, ${distinct} distinct`);
  }
  const filteredSort = await everything(`sort=budget-desc&status=BIDDING&budgetMin=1000`);
  record(new Set(filteredSort.ids).size === filteredSort.ids.length && filteredSort.ids.length === oracle({ status: 'BIDDING', budgetMin: 1000 }).length, 'paging: a sort combined with filters also pages cleanly');
  const badSort = await get('/works?sort=price');
  record(badSort.status === 400 && !!badSort.json.error.fields.sort, 'sort: an unknown sort -> 400 naming "sort"');
  record((await get('/works?sort=DATE')).status === 400 && (await get('/works?sort=budget-desc&sort=date')).status === 400, 'sort: values are case-sensitive and a repeated sort is refused');

  // ===================================================== 5. page size and paging
  const sizes: [string, number, number][] = [['pageSize=1', 200, 1], ['pageSize=7', 200, 7], ['pageSize=50', 200, 50]];
  for (const [qs, status, count] of sizes) {
    const r = await get(`/works?${qs}`);
    record(r.status === status && r.json.data.items.length === count && r.json.data.pageSize === count, `paging: ${qs} returns ${count} works and says so`, `${r.status}`);
  }
  const lastPage = await get('/works?pageSize=50&page=3');
  const beyond = await get('/works?pageSize=50&page=4');
  record(lastPage.json.data.items.length === visible.length - 100 && lastPage.json.data.total === visible.length, 'paging: the last page holds the remainder', `${lastPage.json.data.items.length}`);
  record(beyond.status === 200 && beyond.json.data.items.length === 0 && beyond.json.data.total === visible.length && beyond.json.data.page === 4, 'paging: a page past the end -> 200 with no items and the true total (not an error)');
  record((await get('/works?page=10000')).status === 200 && (await get('/works?page=10000')).json.data.items.length === 0, 'paging: the highest allowed page (10000) is answered quickly with an empty list');
  const totals = new Set<number>();
  for (let p = 1; p <= 4; p += 1) totals.add((await get(`/works?page=${p}&pageSize=40`)).json.data.total);
  record(totals.size === 1, 'paging: the total is the same on every page');
  const badNumbers: [string, string][] = [
    ['pageSize=0', 'pageSize'], ['pageSize=51', 'pageSize'], ['pageSize=1000000', 'pageSize'], ['pageSize=-1', 'pageSize'], ['pageSize=abc', 'pageSize'], ['pageSize=', 'pageSize'],
    ['pageSize=10.5', 'pageSize'], ['pageSize=1e1', 'pageSize'], ['pageSize=0x10', 'pageSize'], ['pageSize=%2010', 'pageSize'], ['pageSize=Infinity', 'pageSize'], ['pageSize=10&pageSize=20', 'pageSize'],
    ['page=0', 'page'], ['page=-1', 'page'], ['page=abc', 'page'], ['page=', 'page'], ['page=10001', 'page'], ['page=1e21', 'page'], ['page=1.5', 'page'], ['page=99999999999', 'page']
  ];
  for (const [qs, field] of badNumbers) {
    const r = await get(`/works?${qs}`);
    record(r.status === 400 && code(r) === 'VALIDATION_ERROR' && !!r.json.error.fields?.[field], `limits: ?${qs} -> 400 VALIDATION_ERROR naming "${field}"`, `${r.status} ${code(r) ?? ''}`);
  }

  // ====================================================== 6. invalid parameters -> 400
  const hex = (n: number) => '0123456789abcdef'.repeat(4).slice(0, n);
  const invalid: [string, string][] = [
    ['status=bidding', 'status'], ['status=ALL', 'status'], ['status=', 'status'], ['status=BIDDING&status=AMENDED', 'status'],
    ['siteId=abc', 'siteId'], [`siteId=${hex(23)}`, 'siteId'], [`siteId=${hex(25)}`, 'siteId'], [`siteId=${'z'.repeat(24)}`, 'siteId'], ['siteId=', 'siteId'],
    ['tag=abc', 'tag'], [`tag=${hex(24)},abc`, 'tag'], ['tag=', 'tag'], ['tag=,', 'tag'], [`tag=${Array.from({ length: 31 }, () => hex(24)).join(',')}`, 'tag'],
    ['budgetMin=', 'budgetMin'], ['budgetMin=-1', 'budgetMin'], ['budgetMin=abc', 'budgetMin'], ['budgetMin=1e3', 'budgetMin'], ['budgetMin=0x10', 'budgetMin'], ['budgetMin=Infinity', 'budgetMin'], ['budgetMin=NaN', 'budgetMin'], ['budgetMin=1,000', 'budgetMin'], ['budgetMin=12.345', 'budgetMin'], ['budgetMin=12345678901234', 'budgetMin'], ['budgetMin=%205', 'budgetMin'],
    ['budgetMax=', 'budgetMax'], ['budgetMax=-1', 'budgetMax'], ['budgetMax=abc', 'budgetMax'], ['budgetMax=1e400', 'budgetMax'], ['budgetMax=Infinity', 'budgetMax'], ['budgetMax=0x10', 'budgetMax'], ['budgetMax=5&budgetMax=6', 'budgetMax'],
    ['budgetMin=500&budgetMax=100', 'budgetMin'],
    ['publishedFrom=2026-13-01', 'publishedFrom'], ['publishedFrom=2026-02-30', 'publishedFrom'], ['publishedFrom=26-03-10', 'publishedFrom'], ['publishedFrom=2026-3-1', 'publishedFrom'], ['publishedFrom=yesterday', 'publishedFrom'], ['publishedFrom=2026-03-10T00:00:00Z', 'publishedFrom'], ['publishedFrom=', 'publishedFrom'], ['publishedFrom=2026-00-10', 'publishedFrom'],
    ['publishedTo=2026-04-31', 'publishedTo'], ['publishedTo=10/03/2026', 'publishedTo'], ['publishedTo=', 'publishedTo'],
    ['publishedFrom=2026-04-01&publishedTo=2026-03-01', 'publishedFrom'],
    ['fiscalYear=2400', 'fiscalYear'], ['fiscalYear=2701', 'fiscalYear'], ['fiscalYear=abc', 'fiscalYear'], ['fiscalYear=2569.5', 'fiscalYear'], ['fiscalYear=', 'fiscalYear'], ['fiscalYear=0x9F9', 'fiscalYear'], ['fiscalYear=-2569', 'fiscalYear'], ['fiscalYear=2026', 'fiscalYear'], ['fiscalYear=2569&fiscalYear=2570', 'fiscalYear'],
    ['q=a&q=b', 'q'], ['foo=1', 'foo'], ['limit=5', 'limit'], ['offset=5', 'offset'], ['ingestionRelevance=not-related', 'ingestionRelevance'], ['Status=BIDDING', 'Status'], ['PageSize=5', 'PageSize']
  ];
  for (const [qs] of invalid) {
    const r = await get(`/works?${qs}`);
    record(r.status === 400 && code(r) === 'VALIDATION_ERROR' && !!r.json.error.fields && Object.keys(r.json.error.fields).length >= 1, `invalid: ?${qs.length > 60 ? qs.slice(0, 57) + '...' : qs} -> 400 VALIDATION_ERROR`, `${r.status} ${code(r) ?? ''} ${r.status === 400 ? '' : r.text.slice(0, 100)}`);
  }
  const nonsense = await get('/works?status=BIDDING&budgetMin=x&fiscalYear=y');
  record(nonsense.status === 400 && Object.keys(nonsense.json.error.fields).sort().join() === 'budgetMin,fiscalYear', 'invalid: several bad parameters are all named in one answer', JSON.stringify(nonsense.json.error.fields));
  record(!/stack|at \w+ \(|node_modules|mongoose|ObjectId/i.test(nonsense.text), 'invalid: the error says what is wrong without exposing internals');
  record(total(await get(`/works?siteId=${new Types.ObjectId()}`)) === 0 && total(await get('/works?siteId=' + hex(24).toUpperCase())) === 0, 'valid but unknown: a well-formed site id that exists nowhere (any letter case) is simply an empty result, not an error');
  record((await get('/works?budgetMax=99999999999.99')).status === 200 && (await get('/works?budgetMin=0&budgetMax=0')).status === 200, 'valid: the edges of the allowed budget range are accepted');
  record(total(await get('/works?fiscalYear=2500')) === 0 && total(await get('/works?fiscalYear=2700')) === 0, 'valid: the first and last allowed fiscal years are accepted');

  // ============================================ 7. injection, and not hanging the server
  const hostile = [
    '{"$gt":""}', '{"$ne":null}', '{"$regex":".*"}', '[$ne]=1', '$where', '$where: function() { sleep(5000) }', '"; sleep(5000); "', "'; return true; var x='", '1; while(true){}',
    '(a+)+$', '(.*)*$', '(a|aa)+$', '^(([a-z])+.)+[A-Z]([a-z])+$', 'a*a*a*a*a*a*a*a*a*b', '(?:(?:(?:(?:a*)*)*)*)*b', '\\', '[', '(', ')', '*', '+', '?', '|', '^$', '\\d+', '(?=a)', '\\p{L}+',
    'ก' + '่'.repeat(60), '‍'.repeat(50), '😀'.repeat(40), 'a'.repeat(200), '('.repeat(100), '(a+)+'.repeat(30), '$'.repeat(100), '‮‭', 'ก\u0000ก'
  ];
  let slowest = 0;
  let worst = '';
  for (const payload of hostile) {
    const r = await get(`/works?q=${q(payload)}&pageSize=50`);
    slowest = Math.max(slowest, r.ms);
    if (r.ms === slowest) worst = payload.slice(0, 20);
    const sane = (r.status === 200 && Array.isArray(r.json?.data?.items) && r.json.data.total < visible.length) || (r.status === 400 && code(r) === 'VALIDATION_ERROR');
    record(sane && r.ms < 3000, `injection: q=${JSON.stringify(payload.length > 34 ? payload.slice(0, 31) + '...' : payload)} is plain text: no server error, no dump of every work, answered fast`, `${r.status} total=${r.json?.data?.total} ${r.ms}ms`);
  }
  record(slowest < 3000, 'injection: the slowest hostile search was answered in under 3 seconds', `${slowest}ms (${JSON.stringify(worst)})`);
  const startedBurst = Date.now();
  const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => get(`/works?q=${q('(a+)+$' + 'x'.repeat(i))}&sort=budget-asc`)));
  record(burst.every(r => r.status === 200) && Date.now() - startedBurst < 10_000, 'injection: 25 hostile searches at once all complete quickly (the server is not tied up)', `${Date.now() - startedBurst}ms`);

  const operatorCases = [
    'siteId[$ne]=x', 'siteId[$gt]=', 'siteId[$in][]=a', 'status[$ne]=BIDDING', 'status[$regex]=.*', 'tag[$ne]=x', 'tag[$regex]=.', 'budgetMax[$gt]=0', 'budgetMin[$lt]=1e9', 'fiscalYear[$gte]=2500',
    'publishedFrom[$gt]=2000-01-01', 'sort[$ne]=date', 'page[$gt]=0', 'pageSize[$gt]=0', 'q[$gt]=', 'q[$regex]=.*', 'q[$where]=sleep(5000)', 'q[$ne]=zzz', 'q[]=a', 'q[0]=a&q[1]=b',
    '$where=sleep(5000)', '$or[0][status]=BIDDING', 'ingestionRelevance[$ne]=x', 'status=BIDDING%00'
  ];
  for (const qs of operatorCases) {
    const r = await get(`/works?${qs}`);
    record(r.status === 400 && code(r) === 'VALIDATION_ERROR' && r.ms < 2000, `injection: ?${qs} -> 400 (query operators are rejected, not run)`, `${r.status} ${code(r) ?? ''}`);
  }
  for (const qs of ['__proto__[polluted]=1', 'constructor[prototype][polluted]=1', '__proto__=x', 'q[__proto__][x]=1']) {
    const r = await get(`/works?${qs}`);
    record([200, 400].includes(r.status), `injection: ?${qs} is ignored or refused, never a server error`, `${r.status}`);
  }
  record(({} as Record<string, unknown>).polluted === undefined && (Object.prototype as Record<string, unknown>).polluted === undefined, 'injection: prototype pollution attempts changed nothing');
  const leakProbe = await get(`/works?status[$ne]=NONE&pageSize=50`);
  record(leakProbe.status === 400 && !ids(leakProbe).includes('P7') && !leakProbe.text.includes('ลับซ่อน'), 'injection: no operator trick lists the hidden work');
  const withBody = await get('/works?pageSize=5', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  record(withBody.status === 200, 'injection: a Content-Type header on a GET is harmless');
  const nullByte = await get('/works?q=%00');
  const badEncoding = await get('/works?q=%E0%A4%A');
  const loneSurrogate = await get('/works?q=%ED%A0%80');
  record([200, 400].includes(nullByte.status) && [200, 400].includes(badEncoding.status) && [200, 400].includes(loneSurrogate.status), 'injection: a null byte and broken percent-encoding never cause a server error', `${nullByte.status}/${badEncoding.status}/${loneSurrogate.status}`);
  const hugeUrl = await get(`/works?q=${'a'.repeat(30_000)}`).then(r => r.status, () => 0);
  record([400, 414, 431].includes(hugeUrl) || hugeUrl === 0, 'injection: a 30 KB query string is refused at the door', `${hugeUrl}`);
  const hugeHeader = await get('/works', { headers: { 'X-Padding': 'a'.repeat(20_000) } }).then(r => r.status, () => 0);
  record([400, 431].includes(hugeHeader) || hugeHeader === 0, 'injection: a 20 KB header is refused too');
  const healthy = await get('/works?pageSize=1');
  const health = await fetch(`${origin}/health`);
  record(healthy.status === 200 && health.status === 200, 'after all of that: the server still answers normally');
  record(!(await get('/works?pageSize=50')).text.includes('passwordHash') && !healthy.headers.get('x-powered-by'), 'hygiene: no credentials in any listing, no X-Powered-By header');
  record(Number(base.headers.get('content-length') ?? '0') < 150_000, 'hygiene: a full default page stays a reasonable size', base.headers.get('content-length') ?? '');

  record(checkedFilters >= 45, `coverage: ${checkedFilters} filter combinations were compared with the independent oracle`);

  server.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
