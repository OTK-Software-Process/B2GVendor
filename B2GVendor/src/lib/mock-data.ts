export type ProcurementStatus = 'INVITATION' | 'BIDDING' | 'EVALUATION' | 'AWARDED' | 'CANCELLED';
export type ProcurementMethod = 'e-bidding' | 'e-market' | 'specific' | 'selection';

export interface TagItem {
  id: string;
  name: string;
  facet: 'site' | 'agency' | 'method' | 'category' | 'keyword';
  aliases: string[];
  followerCount: number;
  worksCount: number;
  retired?: boolean;
}

export interface GovSiteItem {
  id: string;
  name: string;
  nameEn: string;
  shortCode: string;
  datasetId: string;
  enabled: boolean;
  requestsPerMin: number;
  worksCount: number;
}

export interface TORFile {
  id: string;
  name: string;
  size: string;
  url: string;
  date: string;
  type: string;
}

export interface StatusHistoryItem {
  date: string;
  status: ProcurementStatus;
  statusLabel: string;
  note: string;
}

export interface WorkItem {
  id: string;
  title: string;
  siteId: string;
  siteName: string;
  agencyId: string;
  agencyName: string;
  category: string;
  method: ProcurementMethod;
  methodLabel: string;
  budget: number;
  publishDate: string;
  closingDate: string;
  status: ProcurementStatus;
  statusLabel: string;
  description: string;
  tags: TagItem[];
  torFiles: TORFile[];
  history: StatusHistoryItem[];
  updatedAt: string;
}

export interface AgencyItem {
  id: string;
  siteId: string;
  name: string;
  code: string;
  worksCount: number;
  category: string;
  description: string;
}

export interface NotificationItem {
  id: string;
  workId: string;
  workTitle: string;
  agencyName: string;
  budget: number;
  method: string;
  status: ProcurementStatus;
  statusLabel: string;
  matchedTags: string[];
  ingestedDate: string;
  read: boolean;
}

export interface LogEntry {
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export interface SiteRunBreakdown {
  siteId: string;
  siteName: string;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
}

export interface IngestionRun {
  runId: string;
  startTime: string;
  endTime: string;
  duration: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'RUNNING';
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  siteBreakdown: SiteRunBreakdown[];
  logs: LogEntry[];
}

export interface SitePollConfig {
  id: string;
  siteId: string;
  siteName: string;
  datasetId: string;
  scopeCategories: string[];
  dateRangeDays: number;
  requestsPerMin: number;
  retryAttempts: number;
  enabled: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  details: string;
}


export const MOCK_STATUS_CONFIG: Record<ProcurementStatus, { label: string; labelEn: string; boxClass: string; dotClass: string }> = {
  INVITATION: {
    label: 'ประกาศเชิญชวน',
    labelEn: 'Invitation',
    boxClass: 'bg-blue-600 text-white',
    dotClass: 'bg-blue-500'
  },
  BIDDING: {
    label: 'อยู่ระหว่างเสนอราคา',
    labelEn: 'Bidding Open',
    boxClass: 'bg-emerald-600 text-white',
    dotClass: 'bg-emerald-500'
  },
  EVALUATION: {
    label: 'พิจารณาผล',
    labelEn: 'Evaluation',
    boxClass: 'bg-amber-700 text-white',
    dotClass: 'bg-amber-500'
  },
  AWARDED: {
    label: 'ประกาศผู้ชนะ',
    labelEn: 'Awarded',
    boxClass: 'bg-sky-600 text-white',
    dotClass: 'bg-sky-500'
  },
  CANCELLED: {
    label: 'ยกเลิก',
    labelEn: 'Cancelled',
    boxClass: 'bg-rose-600 text-white',
    dotClass: 'bg-rose-500'
  }
};

export const MOCK_GOV_SITES: GovSiteItem[] = [
  { id: 'site-bma', name: 'กรุงเทพมหานคร', nameEn: 'BMA', shortCode: 'BMA', datasetId: 'bma-procurement-disclosure', enabled: true, requestsPerMin: 120, worksCount: 5 },
  { id: 'site-doh', name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOH', datasetId: 'doh-procurement-disclosure', enabled: true, requestsPerMin: 90, worksCount: 1 },
  { id: 'site-pea', name: 'การไฟฟ้าส่วนภูมิภาค', nameEn: 'PEA', shortCode: 'PEA', datasetId: 'pea-procurement-disclosure', enabled: true, requestsPerMin: 90, worksCount: 1 },
  { id: 'site-egat', name: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', nameEn: 'EGAT', shortCode: 'EGAT', datasetId: 'egat-procurement-disclosure', enabled: true, requestsPerMin: 90, worksCount: 1 },
  { id: 'site-moph', name: 'สำนักงานปลัดกระทรวงสาธารณสุข', nameEn: 'Office of the Permanent Secretary, MOPH', shortCode: 'MOPH', datasetId: 'moph-ops-procurement-disclosure', enabled: true, requestsPerMin: 90, worksCount: 1 },
  { id: 'site-depa', name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', nameEn: 'depa', shortCode: 'depa', datasetId: 'depa-procurement-disclosure', enabled: true, requestsPerMin: 60, worksCount: 1 },
  { id: 'site-dga', name: 'สำนักงานพัฒนารัฐบาลดิจิทัล', nameEn: 'DGA', shortCode: 'DGA', datasetId: 'dga-procurement-disclosure', enabled: false, requestsPerMin: 60, worksCount: 0 },
];

export const MOCK_TAGS: TagItem[] = [
  { id: 'tag-site-bma', name: 'กรุงเทพมหานคร (BMA)', facet: 'site', aliases: ['BMA', 'กทม.'], followerCount: 2640, worksCount: 5 },
  { id: 'tag-site-doh', name: 'กรมทางหลวง (Department of Highways)', facet: 'site', aliases: ['DOH', 'กรมทางหลวง'], followerCount: 410, worksCount: 1 },
  { id: 'tag-site-pea', name: 'การไฟฟ้าส่วนภูมิภาค (PEA)', facet: 'site', aliases: ['PEA', 'กฟภ.'], followerCount: 380, worksCount: 1 },
  { id: 'tag-site-egat', name: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย (EGAT)', facet: 'site', aliases: ['EGAT', 'กฟผ.'], followerCount: 520, worksCount: 1 },
  { id: 'tag-site-moph', name: 'สำนักงานปลัดกระทรวงสาธารณสุข (MOPH)', facet: 'site', aliases: ['MOPH', 'สป.สธ.'], followerCount: 460, worksCount: 1 },
  { id: 'tag-site-depa', name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล (depa)', facet: 'site', aliases: ['depa', 'ดีป้า'], followerCount: 290, worksCount: 1 },
  { id: 'tag-site-dga', name: 'สำนักงานพัฒนารัฐบาลดิจิทัล (DGA)', facet: 'site', aliases: ['DGA'], followerCount: 150, worksCount: 0 },
  { id: 'tag-1', name: 'งานก่อสร้างและโยธา', facet: 'category', aliases: ['โยธา', 'ก่อสร้าง', 'ปรับปรุงถนน', 'ทำสะพาน'], followerCount: 1420, worksCount: 45 },
  { id: 'tag-2', name: 'ครุภัณฑ์คอมพิวเตอร์และดิจิทัล', facet: 'category', aliases: ['คอมพิวเตอร์', 'ไอที', 'Hardware', 'Server'], followerCount: 980, worksCount: 28 },
  { id: 'tag-3', name: 'เวชภัณฑ์และอุปกรณ์ทางการแพทย์', facet: 'category', aliases: ['ยา', 'การแพทย์', 'โรงพยาบาล', 'อุปกรณ์การแพทย์'], followerCount: 760, worksCount: 19 },
  { id: 'tag-4', name: 'บริการพัฒนาระบบซอฟต์แวร์', facet: 'category', aliases: ['Software', 'App', 'ระบบสารสนเทศ', 'Cloud'], followerCount: 1150, worksCount: 22 },
  { id: 'tag-5', name: 'สำนักการโยธา', facet: 'agency', aliases: ['สนย.', 'สำนักโยธา BMA'], followerCount: 890, worksCount: 38 },
  { id: 'tag-6', name: 'สำนักการระบายน้ำ', facet: 'agency', aliases: ['สนน.', 'ระบายน้ำกทม.'], followerCount: 640, worksCount: 24 },
  { id: 'tag-7', name: 'สำนักการแพทย์', facet: 'agency', aliases: ['สนพ.', 'การแพทย์ กทม.'], followerCount: 520, worksCount: 16 },
  { id: 'tag-8', name: 'สำนักดิจิทัลเพื่อการพัฒนาเมือง', facet: 'agency', aliases: ['สนด.', 'BMA Digital'], followerCount: 1040, worksCount: 12 },
  { id: 'tag-9', name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method', aliases: ['e-bidding', 'อีบิดดิ้ง'], followerCount: 2100, worksCount: 85 },
  { id: 'tag-10', name: 'วิธีตลาดอิเล็กทรอนิกส์ (e-market)', facet: 'method', aliases: ['e-market', 'อีมาร์เก็ต'], followerCount: 1200, worksCount: 34 },
  { id: 'tag-11', name: 'ระบบระบายน้ำและป้องกันน้ำท่วม', facet: 'keyword', aliases: ['น้ำท่วม', 'คลอง', 'เครื่องสูบน้ำ'], followerCount: 810, worksCount: 15 },
  { id: 'tag-12', name: 'กล้องวงจรปิด CCTV', facet: 'keyword', aliases: ['CCTV', 'กล้องความปลอดภัย', 'Smart City'], followerCount: 670, worksCount: 8 },
];

export const MOCK_AGENCIES: AgencyItem[] = [
  { id: 'agency-yotha', siteId: 'site-bma', name: 'สำนักการโยธา กรุงเทพมหานคร', code: 'BMA-PWD', worksCount: 38, category: 'โยธาและโครงสร้างพื้นฐาน', description: 'รับผิดชอบงานก่อสร้าง ปรับปรุงถนน สะพาน และอาคารภาครัฐในเขตกรุงเทพมหานคร' },
  { id: 'agency-drainage', siteId: 'site-bma', name: 'สำนักการระบายน้ำ กรุงเทพมหานคร', code: 'BMA-DDS', worksCount: 24, category: 'การระบายน้ำและสิ่งแวดล้อม', description: 'บริหารจัดการระบบอุโมงค์ระบายน้ำ เขื่อน และสถานีสูบน้ำทั่วกรุงเทพฯ' },
  { id: 'agency-digital', siteId: 'site-bma', name: 'สำนักดิจิทัลเพื่อการพัฒนาเมือง', code: 'BMA-DIGITAL', worksCount: 12, category: 'เทคโนโลยีและดิจิทัล', description: 'ขับเคลื่อนนโยบาย Smart City บริการอิเล็กทรอนิกส์ และระบบโครงสร้างพื้นฐานดิจิทัล' },
  { id: 'agency-health', siteId: 'site-bma', name: 'สำนักการแพทย์ กรุงเทพมหานคร', code: 'BMA-MSD', worksCount: 16, category: 'สาธารณสุขและการแพทย์', description: 'กำกับดูแลโรงพยาบาลในสังกัดกรุงเทพมหานคร และการจัดซื้อครุภัณฑ์ทางการแพทย์' },
  { id: 'agency-traffic', siteId: 'site-bma', name: 'สำนักการจราจรและขนส่ง', code: 'BMA-TRAFFIC', worksCount: 14, category: 'การจราจรและขนส่ง', description: 'บริหารจัดการระบบไฟจราจร กล้อง CCTV ป้ายจราจร และระบบขนส่งมวลชน' },
  { id: 'agency-doh-central', siteId: 'site-doh', name: 'กองบริหารงานก่อสร้างทางที่ 1 กรมทางหลวง', code: 'DOH-CONST1', worksCount: 1, category: 'โยธาและโครงสร้างพื้นฐาน', description: 'รับผิดชอบงานก่อสร้างและบำรุงรักษาทางหลวงแผ่นดินทั่วประเทศ' },
  { id: 'agency-pea-central', siteId: 'site-pea', name: 'ฝ่ายจัดหาพัสดุ การไฟฟ้าส่วนภูมิภาค', code: 'PEA-PROC', worksCount: 1, category: 'พลังงานและสาธารณูปโภค', description: 'จัดหาอุปกรณ์และงานก่อสร้างระบบจำหน่ายไฟฟ้าส่วนภูมิภาค' },
  { id: 'agency-egat-central', siteId: 'site-egat', name: 'ฝ่ายจัดหา การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', code: 'EGAT-PROC', worksCount: 1, category: 'พลังงานและสาธารณูปโภค', description: 'จัดหาเครื่องจักร อุปกรณ์ผลิตไฟฟ้า และงานก่อสร้างโรงไฟฟ้า' },
  { id: 'agency-moph-central', siteId: 'site-moph', name: 'กองเศรษฐกิจสุขภาพและหลักประกันสุขภาพ สป.สธ.', code: 'MOPH-ECON', worksCount: 1, category: 'สาธารณสุขและการแพทย์', description: 'จัดซื้อจัดจ้างเวชภัณฑ์และครุภัณฑ์การแพทย์ให้หน่วยงานในสังกัดกระทรวงสาธารณสุข' },
  { id: 'agency-depa-central', siteId: 'site-depa', name: 'ฝ่ายจัดซื้อจัดจ้าง สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', code: 'DEPA-PROC', worksCount: 1, category: 'เทคโนโลยีและดิจิทัล', description: 'จัดหาระบบและบริการดิจิทัลเพื่อส่งเสริมเศรษฐกิจดิจิทัลของประเทศ' },
  { id: 'agency-dga-central', siteId: 'site-dga', name: 'ฝ่ายจัดซื้อจัดจ้าง สำนักงานพัฒนารัฐบาลดิจิทัล', code: 'DGA-PROC', worksCount: 0, category: 'เทคโนโลยีและดิจิทัล', description: 'จัดหาระบบโครงสร้างพื้นฐานดิจิทัลภาครัฐ (ยังไม่เปิดใช้งานการดึงข้อมูล)' }
];

export const MOCK_WORKS: WorkItem[] = [
  {
    id: 'W-2026-0891',
    title: 'ประกวดราคาจ้างก่อสร้างปรับปรุงถนนและสะพานข้ามคลองแสนแสบ ช่วงเขตราชเทวี ถึงเขตวัฒนา ด้วยวิธี e-bidding',
    siteId: 'site-bma',
    siteName: 'กรุงเทพมหานคร',
    agencyId: 'agency-yotha',
    agencyName: 'สำนักการโยธา กรุงเทพมหานคร',
    category: 'งานก่อสร้างและโยธา',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 48500000,
    publishDate: '2026-08-01',
    closingDate: '2026-08-25',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'โครงการปรับปรุงโครงสร้างสะพานคอนกรีตเสริมเหล็กข้ามคลองแสนแสบ ขยายผิวจราจรพร้อมติดตั้งระบบไฟส่องสว่างประหยัดพลังงาน LED และทางเท้าเพื่อผู้พิการ',
    tags: [MOCK_TAGS[0], MOCK_TAGS[7], MOCK_TAGS[11], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-1', name: 'ประกาศเชิญชวน e-bidding W-2026-0891.pdf', size: '1.8 MB', url: '/files/announcement-0891.pdf', date: '2026-08-01', type: 'PDF' },
      { id: 'f-2', name: 'เอกสารคุณลักษณะเฉพาะ (TOR) โครงการสะพานคลองแสนแสบ.pdf', size: '4.5 MB', url: '/files/tor-0891.pdf', date: '2026-08-01', type: 'PDF' },
      { id: 'f-3', name: 'BOQ ราคากลางและบัญชีปริมาณงาน.xlsx', size: '820 KB', url: '/files/boq-0891.xlsx', date: '2026-08-01', type: 'XLSX' }
    ],
    history: [
      { date: '2026-08-01 09:00', status: 'INVITATION', statusLabel: 'ประกาศเชิญชวน', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th ครั้งแรกโดยอัตโนมัติ (Poll Run #RUN-8891)' },
      { date: '2026-08-05 10:30', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'เปิดให้ผู้ค้าดาวน์โหลดเอกสารยื่นข้อเสนอราคา' }
    ],
    updatedAt: '2026-08-11 14:20'
  },
  {
    id: 'W-2026-0892',
    title: 'ประกวดราคาซื้อจัดหากล้องวงจรปิด CCTV ตรวจจับอัจฉริยะ พร้อมระบบวิเคราะห์ AI จำนวน 120 จุด เขตปทุมวัน',
    siteId: 'site-bma',
    siteName: 'กรุงเทพมหานคร',
    agencyId: 'agency-traffic',
    agencyName: 'สำนักการจราจรและขนส่ง',
    category: 'ครุภัณฑ์คอมพิวเตอร์และดิจิทัล',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 18200000,
    publishDate: '2026-08-04',
    closingDate: '2026-08-28',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'จัดหาและติดตั้งกล้องวงจรปิดความละเอียดสูง 4K รองรับระบบ License Plate Recognition (LPR) เชื่อมต่อศูนย์ควบคุมจราจร กทม.',
    tags: [MOCK_TAGS[0], MOCK_TAGS[8], MOCK_TAGS[18], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-4', name: 'ข้อกำหนดครุภัณฑ์ CCTV AI 2026.pdf', size: '3.1 MB', url: '/files/cctv-tor.pdf', date: '2026-08-04', type: 'PDF' }
    ],
    history: [
      { date: '2026-08-04 11:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'ประกาศ B2G Vendor' }
    ],
    updatedAt: '2026-08-10 09:15'
  },
  {
    id: 'W-2026-0893',
    title: 'ประกวดราคาจ้างพัฒนาระบบสารสนเทศบริหารจัดการน้ำท่วมแบบเรียลไทม์ (BMA Flood Monitoring System)',
    siteId: 'site-bma',
    siteName: 'กรุงเทพมหานคร',
    agencyId: 'agency-digital',
    agencyName: 'สำนักดิจิทัลเพื่อการพัฒนาเมือง',
    category: 'บริการพัฒนาระบบซอฟต์แวร์',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 29800000,
    publishDate: '2026-07-20',
    closingDate: '2026-08-15',
    status: 'EVALUATION',
    statusLabel: 'พิจารณาผล',
    description: 'พัฒนาระบบ Dashboard แสดงระดับน้ำในคลองและประตูระบายน้ำ พร้อมระบบแจ้งเตือนภัยล่วงหน้าผ่านแอปพลิเคชันและ SMS',
    tags: [MOCK_TAGS[0], MOCK_TAGS[10], MOCK_TAGS[14], MOCK_TAGS[17]],
    torFiles: [
      { id: 'f-5', name: 'TOR Software Flood Monitoring.pdf', size: '2.9 MB', url: '/files/flood-tor.pdf', date: '2026-07-20', type: 'PDF' }
    ],
    history: [
      { date: '2026-07-20 08:30', status: 'INVITATION', statusLabel: 'ประกาศเชิญชวน', note: 'สร้างรายการ' },
      { date: '2026-08-01 17:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'ปิดรับซองเสนอราคา' },
      { date: '2026-08-02 09:00', status: 'EVALUATION', statusLabel: 'พิจารณาผล', note: 'อยู่ระหว่างตรวจสอบคุณสมบัติผู้ยื่นข้อเสนอ' }
    ],
    updatedAt: '2026-08-11 11:00'
  },
  {
    id: 'W-2026-0894',
    title: 'ประกวดราคาซื้อเครื่องช่วยหายใจชนิดควบคุมด้วยปริมาตรและแรงดัน สำหรับโรงพยาบาลตากสิน',
    siteId: 'site-bma',
    siteName: 'กรุงเทพมหานคร',
    agencyId: 'agency-health',
    agencyName: 'สำนักการแพทย์ กรุงเทพมหานคร',
    category: 'เวชภัณฑ์และอุปกรณ์ทางการแพทย์',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 12500000,
    publishDate: '2026-06-15',
    closingDate: '2026-07-10',
    status: 'AWARDED',
    statusLabel: 'ประกาศผู้ชนะ',
    description: 'การจัดซื้อเครื่องช่วยหายใจประสิทธิภาพสูงจำนวน 10 เครื่อง เพื่อรองรับผู้ป่วยหอผู้ป่วยหนัก (ICU)',
    tags: [MOCK_TAGS[0], MOCK_TAGS[9], MOCK_TAGS[13]],
    torFiles: [
      { id: 'f-6', name: 'ประกาศผลผู้ชนะการเสนอราคา.pdf', size: '950 KB', url: '/files/winner-0894.pdf', date: '2026-07-25', type: 'PDF' }
    ],
    history: [
      { date: '2026-06-15 10:00', status: 'INVITATION', statusLabel: 'ประกาศเชิญชวน', note: 'ประกาศเชิญชวน' },
      { date: '2026-07-25 14:00', status: 'AWARDED', statusLabel: 'ประกาศผู้ชนะ', note: 'บริษัท เมดิคอลเทค จำกัด เป็นผู้ชนะการประกวดราคา ที่วงเงิน 11,980,000 บาท' }
    ],
    updatedAt: '2026-07-25 14:00'
  },
  {
    id: 'W-2026-0895',
    title: 'ประกวดราคาจ้างก่อสร้างเขื่อนป้องกันน้ำท่วมขอบคลองลาดพร้าว ช่วงเขตห้วยขวาง',
    siteId: 'site-bma',
    siteName: 'กรุงเทพมหานคร',
    agencyId: 'agency-drainage',
    agencyName: 'สำนักการระบายน้ำ กรุงเทพมหานคร',
    category: 'งานก่อสร้างและโยธา',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 87000000,
    publishDate: '2026-08-08',
    closingDate: '2026-09-02',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'ก่อสร้างเขื่อนคสล. ความยาวรวม 2.4 กิโลเมตร พร้อมดักขยะและติดตั้งราวกั้นความปลอดภัย',
    tags: [MOCK_TAGS[0], MOCK_TAGS[7], MOCK_TAGS[12], MOCK_TAGS[17]],
    torFiles: [
      { id: 'f-7', name: 'TOR เขื่อนคลองลาดพร้าว.pdf', size: '5.2 MB', url: '/files/dam-tor.pdf', date: '2026-08-08', type: 'PDF' }
    ],
    history: [
      { date: '2026-08-08 09:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'ประกาศเปิดรับซองเสนอราคา' }
    ],
    updatedAt: '2026-08-11 16:00'
  },
  {
    id: 'W-2026-0910',
    title: 'ประกวดราคาจ้างก่อสร้างขยายผิวจราจรทางหลวงหมายเลข 32 ช่วงบางปะอิน-นครสวรรค์ ด้วยวิธี e-bidding',
    siteId: 'site-doh',
    siteName: 'กรมทางหลวง',
    agencyId: 'agency-doh-central',
    agencyName: 'กองบริหารงานก่อสร้างทางที่ 1 กรมทางหลวง',
    category: 'งานก่อสร้างและโยธา',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 156000000,
    publishDate: '2026-08-05',
    closingDate: '2026-09-10',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'ขยายผิวจราจรจาก 4 ช่องจราจรเป็น 6 ช่องจราจร ระยะทางรวม 18 กิโลเมตร พร้อมติดตั้งไฟฟ้าแสงสว่างและป้ายจราจร',
    tags: [MOCK_TAGS[1], MOCK_TAGS[7], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-10', name: 'TOR ขยายผิวจราจรทางหลวง 32.pdf', size: '6.1 MB', url: '/files/doh-tor-910.pdf', date: '2026-08-05', type: 'PDF' }
    ],
    history: [
      { date: '2026-08-05 09:00', status: 'INVITATION', statusLabel: 'ประกาศเชิญชวน', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th (ชุดข้อมูล กรมทางหลวง)' },
      { date: '2026-08-06 10:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'เปิดให้ผู้ค้าดาวน์โหลดเอกสารยื่นข้อเสนอราคา' }
    ],
    updatedAt: '2026-08-11 09:30'
  },
  {
    id: 'W-2026-0911',
    title: 'ประกวดราคาจ้างก่อสร้างสายไฟฟ้าใต้ดินเพื่อทดแทนสายอากาศ พื้นที่จังหวัดขอนแก่น',
    siteId: 'site-pea',
    siteName: 'การไฟฟ้าส่วนภูมิภาค',
    agencyId: 'agency-pea-central',
    agencyName: 'ฝ่ายจัดหาพัสดุ การไฟฟ้าส่วนภูมิภาค',
    category: 'งานก่อสร้างและโยธา',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 64200000,
    publishDate: '2026-08-02',
    closingDate: '2026-08-30',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'ก่อสร้างระบบสายไฟฟ้าใต้ดินทดแทนสายไฟฟ้าอากาศ ระยะทาง 4.5 กิโลเมตร ในเขตเทศบาลนครขอนแก่น',
    tags: [MOCK_TAGS[2], MOCK_TAGS[7], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-11', name: 'TOR สายไฟฟ้าใต้ดินขอนแก่น.pdf', size: '3.4 MB', url: '/files/pea-tor-911.pdf', date: '2026-08-02', type: 'PDF' }
    ],
    history: [
      { date: '2026-08-02 09:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th (ชุดข้อมูล PEA)' }
    ],
    updatedAt: '2026-08-10 14:10'
  },
  {
    id: 'W-2026-0912',
    title: 'ประกวดราคาซื้อพร้อมติดตั้งหม้อแปลงไฟฟ้ากำลังสำหรับโรงไฟฟ้าพลังน้ำ เขื่อนภูมิพล',
    siteId: 'site-egat',
    siteName: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย',
    agencyId: 'agency-egat-central',
    agencyName: 'ฝ่ายจัดหา การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย',
    category: 'งานก่อสร้างและโยธา',
    method: 'selection',
    methodLabel: 'วิธีคัดเลือก',
    budget: 210000000,
    publishDate: '2026-07-28',
    closingDate: '2026-08-22',
    status: 'EVALUATION',
    statusLabel: 'พิจารณาผล',
    description: 'จัดซื้อและติดตั้งหม้อแปลงไฟฟ้ากำลังทดแทนของเดิมที่หมดอายุการใช้งาน เพื่อรักษาเสถียรภาพระบบผลิตไฟฟ้า',
    tags: [MOCK_TAGS[3], MOCK_TAGS[7]],
    torFiles: [
      { id: 'f-12', name: 'TOR หม้อแปลงไฟฟ้ากำลัง เขื่อนภูมิพล.pdf', size: '4.8 MB', url: '/files/egat-tor-912.pdf', date: '2026-07-28', type: 'PDF' }
    ],
    history: [
      { date: '2026-07-28 09:00', status: 'INVITATION', statusLabel: 'ประกาศเชิญชวน', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th (ชุดข้อมูล EGAT)' },
      { date: '2026-08-15 09:00', status: 'EVALUATION', statusLabel: 'พิจารณาผล', note: 'อยู่ระหว่างตรวจสอบคุณสมบัติผู้ยื่นข้อเสนอ' }
    ],
    updatedAt: '2026-08-15 09:00'
  },
  {
    id: 'W-2026-0913',
    title: 'ประกวดราคาซื้อชุดตรวจวินิจฉัยและเวชภัณฑ์สำหรับหน่วยบริการปฐมภูมิ 12 เขตสุขภาพ',
    siteId: 'site-moph',
    siteName: 'สำนักงานปลัดกระทรวงสาธารณสุข',
    agencyId: 'agency-moph-central',
    agencyName: 'กองเศรษฐกิจสุขภาพและหลักประกันสุขภาพ สป.สธ.',
    category: 'เวชภัณฑ์และอุปกรณ์ทางการแพทย์',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 38700000,
    publishDate: '2026-08-06',
    closingDate: '2026-08-29',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'จัดซื้อชุดตรวจวินิจฉัยโรคเบื้องต้นและเวชภัณฑ์คงคลังสำหรับโรงพยาบาลส่งเสริมสุขภาพตำบลใน 12 เขตสุขภาพทั่วประเทศ',
    tags: [MOCK_TAGS[4], MOCK_TAGS[9], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-13', name: 'TOR ชุดตรวจวินิจฉัยและเวชภัณฑ์ 12 เขตสุขภาพ.pdf', size: '2.6 MB', url: '/files/moph-tor-913.pdf', date: '2026-08-06', type: 'PDF' }
    ],
    history: [
      { date: '2026-08-06 09:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th (ชุดข้อมูล สป.สธ.)' }
    ],
    updatedAt: '2026-08-11 08:45'
  },
  {
    id: 'W-2026-0914',
    title: 'ประกวดราคาจ้างพัฒนาแพลตฟอร์มส่งเสริมผู้ประกอบการดิจิทัล SME (depa Digital SME Platform)',
    siteId: 'site-depa',
    siteName: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล',
    agencyId: 'agency-depa-central',
    agencyName: 'ฝ่ายจัดซื้อจัดจ้าง สำนักงานส่งเสริมเศรษฐกิจดิจิทัล',
    category: 'บริการพัฒนาระบบซอฟต์แวร์',
    method: 'e-bidding',
    methodLabel: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    budget: 22400000,
    publishDate: '2026-07-30',
    closingDate: '2026-08-25',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    description: 'พัฒนาแพลตฟอร์มออนไลน์ให้คำปรึกษาและจับคู่ทุนสนับสนุนผู้ประกอบการดิจิทัลรายย่อยทั่วประเทศ',
    tags: [MOCK_TAGS[5], MOCK_TAGS[10], MOCK_TAGS[15]],
    torFiles: [
      { id: 'f-14', name: 'TOR depa Digital SME Platform.pdf', size: '3.9 MB', url: '/files/depa-tor-914.pdf', date: '2026-07-30', type: 'PDF' }
    ],
    history: [
      { date: '2026-07-30 09:00', status: 'BIDDING', statusLabel: 'อยู่ระหว่างเสนอราคา', note: 'นำเข้าระบบผ่านการ Poll ข้อมูลจาก api.data.go.th (ชุดข้อมูล depa)' }
    ],
    updatedAt: '2026-08-09 16:20'
  }
];

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n-1',
    workId: 'W-2026-0891',
    workTitle: 'ประกวดราคาจ้างก่อสร้างปรับปรุงถนนและสะพานข้ามคลองแสนแสบ ช่วงเขตราชเทวี',
    agencyName: 'สำนักการโยธา กรุงเทพมหานคร',
    budget: 48500000,
    method: 'e-bidding',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    matchedTags: ['งานก่อสร้างและโยธา', 'สำนักการโยธา'],
    ingestedDate: '2026-08-11 14:20',
    read: false
  },
  {
    id: 'n-2',
    workId: 'W-2026-0893',
    workTitle: 'ประกวดราคาจ้างพัฒนาระบบสารสนเทศบริหารจัดการน้ำท่วมแบบเรียลไทม์ (BMA Flood Monitoring System)',
    agencyName: 'สำนักดิจิทัลเพื่อการพัฒนาเมือง',
    budget: 29800000,
    method: 'e-bidding',
    status: 'EVALUATION',
    statusLabel: 'พิจารณาผล',
    matchedTags: ['บริการพัฒนาระบบซอฟต์แวร์', 'ระบบระบายน้ำและป้องกันน้ำท่วม'],
    ingestedDate: '2026-08-11 11:00',
    read: false
  },
  {
    id: 'n-3',
    workId: 'W-2026-0892',
    workTitle: 'ประกวดราคาซื้อจัดหากล้องวงจรปิด CCTV ตรวจจับอัจฉริยะ พร้อมระบบวิเคราะห์ AI',
    agencyName: 'สำนักการจราจรและขนส่ง',
    budget: 18200000,
    method: 'e-bidding',
    status: 'BIDDING',
    statusLabel: 'อยู่ระหว่างเสนอราคา',
    matchedTags: ['ครุภัณฑ์คอมพิวเตอร์และดิจิทัล', 'กล้องวงจรปิด CCTV'],
    ingestedDate: '2026-08-10 09:15',
    read: true
  }
];

export const MOCK_INGESTION_RUNS: IngestionRun[] = [
  {
    runId: 'RUN-20260811-1400',
    startTime: '2026-08-11 14:00:00',
    endTime: '2026-08-11 14:03:42',
    duration: '3m 42s',
    status: 'SUCCESS',
    fetchedCount: 142,
    newCount: 8,
    updatedCount: 15,
    skippedCount: 119,
    failedCount: 0,
    siteBreakdown: [
      { siteId: 'site-bma', siteName: 'กรุงเทพมหานคร', fetchedCount: 58, newCount: 3, updatedCount: 7, failedCount: 0 },
      { siteId: 'site-doh', siteName: 'กรมทางหลวง', fetchedCount: 22, newCount: 1, updatedCount: 3, failedCount: 0 },
      { siteId: 'site-pea', siteName: 'การไฟฟ้าส่วนภูมิภาค', fetchedCount: 19, newCount: 1, updatedCount: 2, failedCount: 0 },
      { siteId: 'site-egat', siteName: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', fetchedCount: 15, newCount: 1, updatedCount: 1, failedCount: 0 },
      { siteId: 'site-moph', siteName: 'สำนักงานปลัดกระทรวงสาธารณสุข', fetchedCount: 17, newCount: 1, updatedCount: 1, failedCount: 0 },
      { siteId: 'site-depa', siteName: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', fetchedCount: 11, newCount: 1, updatedCount: 1, failedCount: 0 }
    ],
    logs: [
      { time: '14:00:00', level: 'INFO', message: 'เริ่มต้นการดึงข้อมูลตามรอบเวลา (Cron schedule active) — 6 แหล่งข้อมูลที่เปิดใช้งาน' },
      { time: '14:01:15', level: 'INFO', message: 'เรียก api.data.go.th สำเร็จสำหรับทุกหน่วยงาน (HTTP 200 OK)' },
      { time: '14:02:40', level: 'INFO', message: 'พบรายการใหม่รวม 8 รายการ, รายการอัปเดตสถานะรวม 15 รายการ จาก 6 หน่วยงาน' },
      { time: '14:03:42', level: 'INFO', message: 'ประมวลผลการจัดหมวดหมู่แท็กอัตโนมัติ (Tag Resolution Engine) เสร็จสิ้น รวมถึงแท็กหน่วยงานภาครัฐ' }
    ]
  },
  {
    runId: 'RUN-20260811-0800',
    startTime: '2026-08-11 08:00:00',
    endTime: '2026-08-11 08:04:12',
    duration: '4m 12s',
    status: 'WARNING',
    fetchedCount: 135,
    newCount: 3,
    updatedCount: 9,
    skippedCount: 121,
    failedCount: 2,
    siteBreakdown: [
      { siteId: 'site-bma', siteName: 'กรุงเทพมหานคร', fetchedCount: 61, newCount: 1, updatedCount: 4, failedCount: 0 },
      { siteId: 'site-doh', siteName: 'กรมทางหลวง', fetchedCount: 24, newCount: 0, updatedCount: 2, failedCount: 2 },
      { siteId: 'site-pea', siteName: 'การไฟฟ้าส่วนภูมิภาค', fetchedCount: 18, newCount: 1, updatedCount: 1, failedCount: 0 },
      { siteId: 'site-egat', siteName: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', fetchedCount: 14, newCount: 0, updatedCount: 1, failedCount: 0 },
      { siteId: 'site-moph', siteName: 'สำนักงานปลัดกระทรวงสาธารณสุข', fetchedCount: 12, newCount: 1, updatedCount: 1, failedCount: 0 },
      { siteId: 'site-depa', siteName: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', fetchedCount: 6, newCount: 0, updatedCount: 0, failedCount: 0 }
    ],
    logs: [
      { time: '08:00:00', level: 'INFO', message: 'เริ่มต้นการดึงข้อมูลอัตโนมัติจาก 6 แหล่งข้อมูล (api.data.go.th)' },
      { time: '08:02:10', level: 'WARN', message: 'กรมทางหลวง (DOH): ไม่สามารถดาวน์โหลดไฟล์ TOR สำหรับรายการ W-2026-0744 ได้ (HTTP 504 Gateway Timeout)' },
      { time: '08:04:12', level: 'WARN', message: 'จบการทำงานพร้อมข้อผิดพลาดไม่รุนแรง 2 รายการ จากแหล่งข้อมูล กรมทางหลวง' }
    ]
  }
];

export const MOCK_SITE_POLL_CONFIGS: SitePollConfig[] = [
  { id: 'cfg-bma', siteId: 'site-bma', siteName: 'กรุงเทพมหานคร (BMA)', datasetId: 'bma-procurement-disclosure', scopeCategories: ['โยธา', 'คอมพิวเตอร์', 'การแพทย์', 'ซอฟต์แวร์', 'การจราจร'], dateRangeDays: 30, requestsPerMin: 120, retryAttempts: 3, enabled: true },
  { id: 'cfg-doh', siteId: 'site-doh', siteName: 'กรมทางหลวง (Department of Highways)', datasetId: 'doh-procurement-disclosure', scopeCategories: ['โยธา'], dateRangeDays: 30, requestsPerMin: 90, retryAttempts: 3, enabled: true },
  { id: 'cfg-pea', siteId: 'site-pea', siteName: 'การไฟฟ้าส่วนภูมิภาค (PEA)', datasetId: 'pea-procurement-disclosure', scopeCategories: ['โยธา', 'พลังงาน'], dateRangeDays: 30, requestsPerMin: 90, retryAttempts: 3, enabled: true },
  { id: 'cfg-egat', siteId: 'site-egat', siteName: 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย (EGAT)', datasetId: 'egat-procurement-disclosure', scopeCategories: ['โยธา', 'พลังงาน'], dateRangeDays: 30, requestsPerMin: 90, retryAttempts: 3, enabled: true },
  { id: 'cfg-moph', siteId: 'site-moph', siteName: 'สำนักงานปลัดกระทรวงสาธารณสุข (MOPH)', datasetId: 'moph-ops-procurement-disclosure', scopeCategories: ['การแพทย์'], dateRangeDays: 30, requestsPerMin: 90, retryAttempts: 3, enabled: true },
  { id: 'cfg-depa', siteId: 'site-depa', siteName: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล (depa)', datasetId: 'depa-procurement-disclosure', scopeCategories: ['ซอฟต์แวร์'], dateRangeDays: 30, requestsPerMin: 60, retryAttempts: 3, enabled: true },
  { id: 'cfg-dga', siteId: 'site-dga', siteName: 'สำนักงานพัฒนารัฐบาลดิจิทัล (DGA)', datasetId: 'dga-procurement-disclosure', scopeCategories: ['ซอฟต์แวร์'], dateRangeDays: 30, requestsPerMin: 60, retryAttempts: 3, enabled: false }
];

export const MOCK_AUDIT_LOGS: AuditLogEntry[] = [
  { id: 'aud-1', timestamp: '2026-08-11 15:30', actor: 'admin@bma.go.th', action: 'TAG_RETIRE', target: 'แท็ก #ปรับปรุงถนนเก่า', details: 'ปลดระวางแท็กที่ไม่ใช้งานแล้ว' },
  { id: 'aud-2', timestamp: '2026-08-11 10:15', actor: 'system-scheduler', action: 'INGESTION_RUN', target: 'Run #RUN-20260811-0800', details: 'ดึงข้อมูลสำเร็จ 135 รายการ พบงานใหม่ 3 รายการ จาก 6 หน่วยงาน' },
  { id: 'aud-3', timestamp: '2026-08-10 16:45', actor: 'superadmin@bma.go.th', action: 'SOURCE_CONFIG_UPDATE', target: 'กรมทางหลวง (Department of Highways)', details: 'ปรับ Requests Per Min จาก 60 เป็น 90 req/min' },
  { id: 'aud-4', timestamp: '2026-08-09 11:05', actor: 'superadmin@bma.go.th', action: 'SITE_ADDED', target: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล (depa)', details: 'เพิ่มหน่วยงานใหม่เข้าสู่ระบบ Poll ผ่าน api.data.go.th (ชุดข้อมูล depa-procurement-disclosure)' }
];

export interface VendorAccount {
  id: string;
  name: string;
  email: string;
  type: 'individual' | 'business';
  companyName?: string;
  taxId?: string;
  followedTagsCount: number;
  status: 'active' | 'suspended';
  registeredDate: string;
}

export const MOCK_VENDOR_ACCOUNTS: VendorAccount[] = [
  { id: 'vnd-1', name: 'สมชาย ใจดี', email: 'user@company.co.th', type: 'business', companyName: 'บริษัท บีเอ็มเอ ก่อสร้าง จำกัด', taxId: '0105558123456', followedTagsCount: 3, status: 'active', registeredDate: '2026-05-12' },
  { id: 'vnd-2', name: 'วิภาวรรณ ศรีสุข', email: 'wipawan.s@example.com', type: 'individual', followedTagsCount: 1, status: 'active', registeredDate: '2026-06-02' },
  { id: 'vnd-3', name: 'ประยุทธ์ ช่างทอง', email: 'prayuth.tech@example.com', type: 'business', companyName: 'ห้างหุ้นส่วนจำกัด ทองไอที', taxId: '0105561987654', followedTagsCount: 5, status: 'active', registeredDate: '2026-04-18' },
  { id: 'vnd-4', name: 'กมลชนก แสงทอง', email: 'kamonchanok@example.com', type: 'individual', followedTagsCount: 2, status: 'suspended', registeredDate: '2026-03-27' },
  { id: 'vnd-5', name: 'ธนกร รุ่งเรือง', email: 'thanakorn.med@example.com', type: 'business', companyName: 'บริษัท เมดิคอลเทค จำกัด', taxId: '0105552233445', followedTagsCount: 4, status: 'active', registeredDate: '2026-07-01' },
  { id: 'vnd-6', name: 'อรุณี พงษ์พันธ์', email: 'arunee.p@example.com', type: 'individual', followedTagsCount: 0, status: 'active', registeredDate: '2026-07-22' }
];
