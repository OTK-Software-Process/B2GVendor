import { CkanResource, datastoreSearch, packageShow } from './dataGoTh.client';

/**
 * Agency directory for suggesting an e-GP `deptId` -- read from data.go.th's
 * "ข้อมูลหน่วยเบิกจ่ายส่วนราชการ" (the Ministry of Finance's list of central-
 * government payment units, one row per unit, ~7,700 rows / ~150 departments).
 *
 * Why this dataset, confirmed live (2026-10-28):
 *   - It is the only public, machine-readable agency list found that carries a
 *     department CODE (CGD's own "agencies using e-GP" list, cgd_egp_01, has
 *     only DEPT_NAME / DEPT_SUB_NAME / PROVINCE; OPDC's department list has no
 *     codes at all).
 *   - Its code is the GFMIS department code: 5 digits, the leading 0 dropped
 *     when stored as a number (08006 is stored as 8006) -- 2 digits of
 *     ministry + 3 digits of department. e-GP's `deptId` for a central
 *     department is that code with the department's always-zero leading digit
 *     removed (ministry 2 digits + department 2 digits):
 *         21002 สป.สธ.      -> 2102   (the team's live-verified MOPH deptId)
 *         21009 กรมอนามัย    -> 2109   (live-verified)
 *         08006 กรมทางหลวง   -> 0806   (live-verified)
 *         03004 กรมบัญชีกลาง  -> 0304   (the team's [TEST] deptId)
 *     All 153 departments in the dataset have a zero in that digit, so the
 *     rule never has to guess; a code that breaks the pattern is skipped, not
 *     converted.
 *
 * What it can NOT do, so the UI never presents it as more than a suggestion:
 *   - Coverage is central departments only (7-digit local-government codes and
 *     10-12 digit state-enterprise codes are not in it), and the dataset is a
 *     2022 snapshot -- e.g. depa (1106) is missing. A suggestion from here is
 *     "derived", and the live e-GP check is still what confirms it.
 *   - Its Thai names carry text-extraction typos ("กลำโหม", "ธนารีักษ์").
 */
export const MOF_PAYMENT_UNIT_DATASET = 'check_paymentcenter_11_02';

const PAGE_SIZE = 5000;
const MAX_PAGES = 20;
const COLUMNS = ['รหัสกรม', 'กรม', 'กระทรวง'] as const;

export interface DirectoryDepartment {
  // The GFMIS department code, zero-padded to 5 digits ("08006").
  gfmisCode: string;
  // The e-GP deptId derived from it ("0806").
  deptId: string;
  name: string;
  ministry: string;
}

export interface DirectoryLoad {
  departments: DirectoryDepartment[];
  // Distinct department codes that did not fit the 5-digit pattern.
  skipped: number;
  resourceId: string;
}

/** GFMIS department code -> e-GP deptId, or null when the code is not in the known shape. */
export function gfmisToDeptId(code: unknown): string | null {
  const raw = typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : '';
  if (!/^\d{3,5}$/.test(raw)) return null;
  const padded = raw.padStart(5, '0');
  // The department part is 3 digits and has always been 0xx; anything else is
  // a code this rule was never checked against.
  if (padded[2] !== '0') return null;
  return padded.slice(0, 2) + padded.slice(3);
}

function pickResource(resources: CkanResource[]): CkanResource | null {
  const active = resources.filter(r => r.datastore_active === true && !/dict|datadic/i.test(r.name ?? ''));
  return active.find(r => /csv/i.test(r.format ?? '')) ?? active[0] ?? null;
}

// The dataset's Thai was text-extracted from PDFs and has two systematic
// artifacts, both fixed here because these names end up in a form field:
//   - a stray "ี" after "ร" ("ธนารีักษ์", "วิทยาศาสตรี์", "เศรีษฐกิจ"): ี can never
//     sit before ั ์ or ษ, so removing it only ever repairs a word;
//   - "ำ" in place of "า" in "กลาโหม" ("กลำโหม").
// Other one-off typos in the source are left as they are.
export function cleanThaiName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/รี(?=[ัษ์])/g, 'ร')
    .replace(/กลำโหม/g, 'กลาโหม');
}
const clean = cleanThaiName;

export async function fetchMofDepartments(): Promise<DirectoryLoad> {
  const pkg = await packageShow(MOF_PAYMENT_UNIT_DATASET);
  const resource = pickResource(pkg.resources);
  if (!resource) throw new Error(`data.go.th dataset "${MOF_PAYMENT_UNIT_DATASET}" has no queryable resource`);

  // code -> how many rows name it with each spelling (the most common wins)
  const byCode = new Map<string, { names: Map<string, number>; ministries: Map<string, number> }>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (let page = 0, total = Infinity; page < MAX_PAGES && page * PAGE_SIZE < total; page += 1) {
    const result = await datastoreSearch(resource.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, fields: [...COLUMNS] });
    if (page === 0) {
      const present = new Set(result.fields.map(f => f.id));
      const missing = COLUMNS.filter(column => !present.has(column));
      if (missing.length > 0) {
        throw new Error(`data.go.th resource ${resource.id} no longer has the expected column(s): ${missing.join(', ')}`);
      }
    }
    total = result.total;
    for (const record of result.records) {
      const code = record['รหัสกรม'];
      const text = typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : '';
      // "8006" and "08006" are the same department.
      const key = /^\d{3,5}$/.test(text) ? text.padStart(5, '0') : text;
      const name = clean(record['กรม']);
      if (!key || !name) continue;
      const entry = byCode.get(key) ?? { names: new Map(), ministries: new Map() };
      bump(entry.names, name);
      const ministry = clean(record['กระทรวง']);
      if (ministry) bump(entry.ministries, ministry);
      byCode.set(key, entry);
    }
  }

  const mostCommon = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const departments: DirectoryDepartment[] = [];
  let skipped = 0;
  for (const [code, entry] of byCode) {
    const deptId = gfmisToDeptId(code);
    if (!deptId) {
      skipped += 1;
      continue;
    }
    departments.push({ gfmisCode: code, deptId, name: mostCommon(entry.names), ministry: mostCommon(entry.ministries) });
  }
  return { departments, skipped, resourceId: resource.id };
}
