import { promises as fs } from 'node:fs';
import path from 'node:path';
import mongoose, { Types } from 'mongoose';

// Seeds a realistic data set for the performance tests (perf/README.md):
//   - the 7 launch government sites, with their site tags
//   - ~70 category / keyword / method tags
//   - PERF_WORKS works (default 20,000 -- several years of the 7 sites' e-GP
//     announcements) with Thai titles and descriptions, statuses, budgets,
//     deadlines, fiscal years, tags, TOR entries and status history
//   - vendors (one shared password) following tags, Poll Admins with live
//     sessions, and a Super Admin
// and writes perf/.state/perf-state.json (ids, cookies, logins) for the k6 scripts.
//
//   PERF_MONGODB_URI=mongodb://127.0.0.1:27018/b2g-perf npm run perf:seed
//
// Safety: it DROPS the target database, so it refuses any database whose name
// doesn't contain "perf".

export interface PerfState {
  baseApi?: string;
  siteIds: string[];
  tagIds: { category: string[]; keyword: string[]; site: string[] };
  workIds: string[];
  adminCookies: string[];
  vendorLogins: { email: string; password: string }[];
  searchTerms: string[];
  counts: { works: number; vendors: number; admins: number; follows: number };
}

export const PERF_PASSWORD = 'PerfPass123!x';

const SITES = [
  { name: 'กรุงเทพมหานคร', nameEn: 'Bangkok Metropolitan Administration', shortCode: 'BMA', deptId: '9000001' },
  { name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOH', deptId: '9000002' },
  { name: 'การไฟฟ้าส่วนภูมิภาค', nameEn: 'Provincial Electricity Authority', shortCode: 'PEA', deptId: '9000003' },
  { name: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', nameEn: 'EGAT', shortCode: 'EGAT', deptId: '9000004' },
  { name: 'สำนักงานปลัดกระทรวงสาธารณสุข', nameEn: 'Office of the Permanent Secretary, MOPH', shortCode: 'MOPH', deptId: '9000005' },
  { name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', nameEn: 'depa', shortCode: 'DEPA', deptId: '9000006' },
  { name: 'สำนักงานพัฒนารัฐบาลดิจิทัล', nameEn: 'DGA', shortCode: 'DGA', deptId: '9000007' }
];
const CATEGORIES = ['งานก่อสร้างและโยธา', 'ครุภัณฑ์คอมพิวเตอร์และดิจิทัล', 'ซอฟต์แวร์และระบบสารสนเทศ', 'วัสดุสำนักงาน', 'งานบริการและจ้างเหมา', 'เครื่องมือแพทย์และเวชภัณฑ์', 'ไฟฟ้าและพลังงาน', 'ยานพาหนะ', 'ที่ปรึกษาและวิจัย', 'ระบบรักษาความปลอดภัย', 'งานซ่อมบำรุง', 'ระบบน้ำและสุขาภิบาล'];
const ITEMS: { text: string; category: number; keywords: string[] }[] = [
  { text: 'ก่อสร้างถนนคอนกรีตเสริมเหล็ก', category: 0, keywords: ['ถนน', 'คอนกรีต'] },
  { text: 'ปรับปรุงอาคารสำนักงาน', category: 0, keywords: ['อาคาร', 'ปรับปรุง'] },
  { text: 'ก่อสร้างสะพานข้ามคลอง', category: 0, keywords: ['สะพาน', 'คลอง'] },
  { text: 'ขุดลอกคลองและระบายน้ำ', category: 11, keywords: ['คลอง', 'ระบายน้ำ'] },
  { text: 'วางท่อระบายน้ำ', category: 11, keywords: ['ท่อ', 'ระบายน้ำ'] },
  { text: 'ครุภัณฑ์คอมพิวเตอร์โน้ตบุ๊ก', category: 1, keywords: ['คอมพิวเตอร์', 'โน้ตบุ๊ก'] },
  { text: 'เครื่องคอมพิวเตอร์แม่ข่าย (Server)', category: 1, keywords: ['คอมพิวเตอร์', 'เซิร์ฟเวอร์'] },
  { text: 'พัฒนาระบบสารสนเทศเพื่อการบริหาร', category: 2, keywords: ['ระบบสารสนเทศ', 'ซอฟต์แวร์'] },
  { text: 'ซอฟต์แวร์ลิขสิทธิ์สำนักงาน', category: 2, keywords: ['ซอฟต์แวร์', 'ลิขสิทธิ์'] },
  { text: 'พัฒนาแอปพลิเคชันบริการประชาชน', category: 2, keywords: ['แอปพลิเคชัน', 'ซอฟต์แวร์'] },
  { text: 'ระบบคลาวด์และศูนย์ข้อมูล', category: 2, keywords: ['คลาวด์', 'ศูนย์ข้อมูล'] },
  { text: 'วัสดุสำนักงานและกระดาษ', category: 3, keywords: ['วัสดุสำนักงาน', 'กระดาษ'] },
  { text: 'จ้างเหมาบริการทำความสะอาด', category: 4, keywords: ['ทำความสะอาด', 'จ้างเหมา'] },
  { text: 'จ้างเหมาบริการรักษาความปลอดภัย', category: 9, keywords: ['รักษาความปลอดภัย', 'จ้างเหมา'] },
  { text: 'ระบบกล้องโทรทัศน์วงจรปิด (CCTV)', category: 9, keywords: ['กล้องวงจรปิด', 'CCTV'] },
  { text: 'เวชภัณฑ์และวัสดุการแพทย์', category: 5, keywords: ['เวชภัณฑ์', 'การแพทย์'] },
  { text: 'เครื่องช่วยหายใจ', category: 5, keywords: ['เครื่องมือแพทย์', 'การแพทย์'] },
  { text: 'ติดตั้งระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์', category: 6, keywords: ['โซลาร์เซลล์', 'พลังงาน'] },
  { text: 'บำรุงรักษาระบบไฟฟ้าแรงสูง', category: 10, keywords: ['ไฟฟ้า', 'บำรุงรักษา'] },
  { text: 'ติดตั้งโคมไฟส่องสว่างทาง', category: 6, keywords: ['ไฟฟ้า', 'โคมไฟ'] },
  { text: 'รถยนต์บรรทุกส่วนกลาง', category: 7, keywords: ['รถยนต์', 'ยานพาหนะ'] },
  { text: 'จ้างที่ปรึกษาศึกษาความเหมาะสมโครงการ', category: 8, keywords: ['ที่ปรึกษา', 'ศึกษา'] },
  { text: 'ซ่อมแซมเครื่องปรับอากาศ', category: 10, keywords: ['เครื่องปรับอากาศ', 'ซ่อมบำรุง'] },
  { text: 'ระบบเครือข่ายไร้สาย', category: 1, keywords: ['เครือข่าย', 'ไร้สาย'] }
];
const PLACES = ['เขตบางเขน', 'เขตลาดพร้าว', 'เขตจตุจักร', 'ถนนพหลโยธิน', 'จังหวัดนนทบุรี', 'จังหวัดเชียงใหม่', 'จังหวัดขอนแก่น', 'จังหวัดสงขลา', 'อำเภอเมือง', 'สำนักงานใหญ่', 'การไฟฟ้าเขต 3', 'โรงพยาบาลชุมชน', 'ศูนย์ราชการ', 'ทางหลวงหมายเลข 304', 'ซอยรามคำแหง 24'];
const METHODS = [
  { prefix: 'ประกวดราคาจ้าง', suffix: 'ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', tag: 'e-bidding' },
  { prefix: 'ประกวดราคาซื้อ', suffix: 'ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', tag: 'e-bidding' },
  { prefix: 'จ้าง', suffix: 'โดยวิธีเฉพาะเจาะจง', tag: 'เฉพาะเจาะจง' },
  { prefix: 'ซื้อ', suffix: 'โดยวิธีเฉพาะเจาะจง', tag: 'เฉพาะเจาะจง' },
  { prefix: 'จ้าง', suffix: 'ด้วยวิธีคัดเลือก', tag: 'คัดเลือก' },
  { prefix: 'เช่า', suffix: 'ด้วยวิธีตลาดอิเล็กทรอนิกส์ (e-market)', tag: 'e-market' }
];
const STATUSES = [
  { status: 'BIDDING', type: 'D0', weight: 25 },
  { status: 'DRAFT_TOR', type: 'B0', weight: 15 },
  { status: 'AWARDED', type: 'W0', weight: 35 },
  { status: 'PLANNED', type: 'P0', weight: 10 },
  { status: 'CANCELLED', type: 'D1', weight: 5 },
  { status: 'AMENDED', type: 'D2', weight: 10 }
] as const;

// Deterministic, so two runs seed the same data.
function prng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedPerfData(uri: string, options: { works?: number; vendors?: number; admins?: number; stateFile?: string } = {}): Promise<PerfState> {
  const dbName = new URL(uri).pathname.replace(/^\//, '');
  if (!/perf/i.test(dbName)) throw new Error(`Refusing to seed: database "${dbName}" doesn't contain "perf" and this script drops it.`);
  process.env.MONGODB_URI ??= uri;

  const worksTotal = options.works ?? Number(process.env.PERF_WORKS ?? 20_000);
  const vendorsTotal = options.vendors ?? 300;
  const adminsTotal = options.admins ?? 30;
  const rand = prng(20261116);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  const { GovSite } = await import('../src/models/govSite.model');
  const { Work } = await import('../src/models/work.model');
  const { Tag } = await import('../src/models/tag.model');
  const { Account } = await import('../src/models/account.model');
  const { Follow } = await import('../src/models/follow.model');
  const { Session, issueSessionToken, SESSION_TTL_MS } = await import('../src/models/session.model');
  const { IngestionSettings } = await import('../src/models/ingestionSettings.model');
  const { sessionCookieName } = await import('../src/config/cookie');
  const { env } = await import('../src/config/env');
  // The perf API always runs in PRODUCTION (perf/run.ts), where the cookie carries
  // the __Host- prefix -- this seeding process is not in production mode itself.
  const SESSION_COOKIE_NAME = sessionCookieName(env.SESSION_COOKIE_NAME, true);
  const { createGovSite } = await import('../src/services/govSite.service');
  const { normalizeThaiSearchText } = await import('../src/utils/thaiSearch');
  const bcrypt = (await import('bcryptjs')).default;

  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite, Work, Tag, Account, Follow, Session, IngestionSettings].map(m => m.syncIndexes()));
  await IngestionSettings.create({ scheduleEnabled: false }); // no scheduled polls during a load test

  // ---- sites and tags
  const sites = [];
  for (const s of SITES) sites.push(await createGovSite({ ...s, announceTypes: ['P0', 'B0', 'D0', 'W0', 'D1', 'D2'], requestsPerMinute: 60 }));
  const siteTags = await Tag.find({ facet: 'site' });
  const siteTagBySite = new Map(siteTags.map(t => [String(t.siteId), t._id]));
  const categoryTags = await Tag.insertMany(CATEGORIES.map(name => ({ name, facet: 'category' })));
  const keywordNames = [...new Set(ITEMS.flatMap(i => i.keywords))];
  const keywordTags = await Tag.insertMany(keywordNames.map(name => ({ name, facet: 'keyword' })));
  const methodTags = await Tag.insertMany([...new Set(METHODS.map(m => m.tag))].map(name => ({ name, facet: 'method' })));
  const keywordId = new Map(keywordTags.map(t => [t.name, t._id]));
  const methodId = new Map(methodTags.map(t => [t.name, t._id]));

  // ---- works
  const statusTotal = STATUSES.reduce((sum, s) => sum + s.weight, 0);
  const pickStatus = () => {
    let r = rand() * statusTotal;
    for (const s of STATUSES) if ((r -= s.weight) < 0) return s;
    return STATUSES[0];
  };
  const now = Date.now();
  const DAY = 86_400_000;
  const workIds: Types.ObjectId[] = [];
  const BATCH = 1000;
  for (let start = 0; start < worksTotal; start += BATCH) {
    const docs = [];
    for (let i = start; i < Math.min(worksTotal, start + BATCH); i++) {
      const site = sites[i % sites.length];
      const item = pick(ITEMS);
      const method = pick(METHODS);
      const place = pick(PLACES);
      const st = pickStatus();
      const fiscalYear = pick([2568, 2569, 2569, 2570]);
      const title = `${method.prefix}${item.text} ${place} ${method.suffix}`;
      const description = `${site.name}มีความประสงค์จะ${method.prefix}${item.text} บริเวณ${place} ตามรายละเอียดคุณลักษณะเฉพาะและขอบเขตของงาน (TOR) ` +
        `ผู้ยื่นข้อเสนอต้องมีคุณสมบัติตามที่กำหนด และเสนอราคาผ่านระบบจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ พ.ศ. ${fiscalYear}`;
      const budget = rand() < 0.75 ? Math.round(Math.exp(Math.log(50_000) + rand() * (Math.log(200_000_000) - Math.log(50_000))) / 100) * 100 : undefined;
      const pubDate = new Date(now - Math.floor(rand() * 400) * DAY);
      const id = new Types.ObjectId();
      workIds.push(id);
      const projectId = `6${String(fiscalYear).slice(-2)}${String(i).padStart(8, '0')}`;
      docs.push({
        _id: id,
        siteId: site._id,
        projectId,
        title,
        description,
        searchText: normalizeThaiSearchText(`${title}\n${description}`),
        status: st.status,
        announceType: st.type,
        pubDate,
        budget,
        budgetMissingReason: budget ? undefined : 'not-stated',
        fiscalYear,
        fiscalYearSource: 'document',
        ...(st.status === 'BIDDING' ? { deadlineAt: new Date(now + (1 + Math.floor(rand() * 30)) * DAY), deadlineHasTime: true } : {}),
        torFiles: [
          { announceType: st.type, linkType: 'pdf', sourceUrl: `https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=${projectId}`, storageKey: `${projectId.padEnd(24, '0')}.pdf`, filename: `TOR-${projectId}.pdf`, downloadedAt: pubDate }
        ],
        statusHistory: [{ status: st.status, announceType: st.type, changedAt: pubDate }],
        tags: [siteTagBySite.get(String(site._id)), categoryTags[item.category]._id, ...item.keywords.map(k => keywordId.get(k)), methodId.get(method.tag)].filter(Boolean),
        excludedTags: [],
        createdAt: pubDate,
        updatedAt: pubDate
      });
    }
    await Work.collection.insertMany(docs, { ordered: false });
  }

  // ---- accounts (one bcrypt hash for every vendor: hashing 300 passwords at 12 rounds would take a minute)
  const passwordHash = await bcrypt.hash(PERF_PASSWORD, Number(process.env.BCRYPT_ROUNDS ?? 12));
  const base = { passwordHash, status: 'active', emailVerified: true, emailNotificationsEnabled: true, failedLoginCount: 0, createdAt: new Date(), updatedAt: new Date() };
  const vendors = Array.from({ length: vendorsTotal }, (_, i) => ({
    _id: new Types.ObjectId(),
    ...base,
    email: `vendor${i}@perf.b2gvendor.test`,
    name: `ผู้ประกอบการ ${i}`,
    role: 'user',
    permissions: [],
    type: 'individual',
    notificationFrequency: i % 4 === 0 ? 'daily' : 'instant'
  }));
  const admins = Array.from({ length: adminsTotal }, (_, i) => ({
    _id: new Types.ObjectId(),
    ...base,
    email: `admin${i}@perf.b2gvendor.test`,
    name: `ผู้ดูแลระบบ ${i}`,
    role: 'admin',
    permissions: ['poll:manage'],
    notificationFrequency: 'instant'
  }));
  await Account.collection.insertMany([...vendors, ...admins, { _id: new Types.ObjectId(), ...base, email: 'superadmin@perf.b2gvendor.test', name: 'Super Admin', role: 'superadmin', permissions: [], notificationFrequency: 'instant' }]);

  const followable = [...siteTags.map(t => t._id), ...categoryTags.map(t => t._id), ...keywordTags.map(t => t._id)];
  const follows = new Map<string, { accountId: Types.ObjectId; tagId: Types.ObjectId }>();
  for (const v of vendors) {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const tagId = pick(followable);
      follows.set(`${v._id}:${tagId}`, { accountId: v._id, tagId });
    }
  }
  await Follow.collection.insertMany([...follows.values()].map(f => ({ ...f, paused: false, createdAt: new Date(), updatedAt: new Date() })));

  const adminCookies: string[] = [];
  const sessions = admins.map(a => {
    const { raw, tokenHash } = issueSessionToken();
    adminCookies.push(`${SESSION_COOKIE_NAME}=${raw}`);
    return { accountId: a._id, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS), createdAt: new Date(), updatedAt: new Date() };
  });
  await Session.collection.insertMany(sessions);

  const state: PerfState = {
    siteIds: sites.map(s => String(s._id)),
    tagIds: { category: categoryTags.map(t => String(t._id)), keyword: keywordTags.map(t => String(t._id)), site: siteTags.map(t => String(t._id)) },
    workIds: workIds.filter((_, i) => i % Math.max(1, Math.floor(worksTotal / 2000)) === 0).map(String),
    adminCookies,
    vendorLogins: vendors.map(v => ({ email: v.email, password: PERF_PASSWORD })),
    searchTerms: [
      ...keywordNames,
      ...ITEMS.slice(0, 8).map(i => i.text),
      'โยธา', 'ก่อสร้าง', 'คอมพิวเตอร์', 'e-bidding', 'กรุงเทพ',
      'ก่อส้าง', 'คอมพิวเตอ', 'ซอฟแวร์' // typos / partial words
    ],
    counts: { works: worksTotal, vendors: vendorsTotal, admins: adminsTotal, follows: follows.size }
  };

  const stateFile = options.stateFile ?? path.join(__dirname, '.state', 'perf-state.json');
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  return state;
}

if (require.main === module) {
  const uri = process.env.PERF_MONGODB_URI;
  if (!uri) {
    console.error('Set PERF_MONGODB_URI, e.g. mongodb://127.0.0.1:27018/b2g-perf (the database name must contain "perf").');
    process.exit(2);
  }
  const started = Date.now();
  seedPerfData(uri)
    .then(async state => {
      console.log(`Seeded ${JSON.stringify(state.counts)} in ${((Date.now() - started) / 1000).toFixed(1)}s -> perf/.state/perf-state.json`);
      await mongoose.disconnect();
    })
    .catch(async err => {
      console.error(err);
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    });
}
