import { GovSite } from '../models/govSite.model';
import { DirectoryDepartment, fetchMofDepartments } from '../integrations/govAgencyDirectory.client';
import { logger } from '../utils/logger';
import { buildThaiSearchRegex, normalizeThaiSearchText } from '../utils/thaiSearch';

// Suggests e-GP `deptId`s for the "Add Government Site" form, so a Super Admin
// picks an agency instead of hunting for its code by hand.
//
// Two sources, merged (see govAgencyDirectory.client.ts for why there is no
// single authoritative list):
//   'confirmed'  KNOWN_AGENCIES below: codes the team checked against the live
//                e-GP feed (seedGovSites.ts), with clean names.
//   'derived'    the data.go.th / Ministry of Finance department list, with each
//                code converted to the e-GP form. Probably right, not proven:
//                the form's "Verify live" button is what proves it.
// A suggestion is never saved by itself -- it only fills the form.

export type DeptIdConfidence = 'confirmed' | 'derived';

export interface DeptIdSuggestion {
  deptId: string;
  name: string;
  nameEn?: string;
  shortCode?: string;
  ministry?: string;
  confidence: DeptIdConfidence;
  // Set when a government site already uses this deptId (adding it again would fail).
  alreadyAdded?: { siteId: string; name: string; shortCode: string };
}

export interface DirectoryState {
  // ok: freshly loaded/cached. stale: refresh failed, the last good copy is used.
  // unavailable: never loaded -- only the built-in agencies can be suggested.
  status: 'ok' | 'stale' | 'unavailable';
  loadedAt: string | null;
  agencies: number;
  error?: string;
}

export interface DeptIdSuggestionResult {
  query: string;
  suggestions: DeptIdSuggestion[];
  directory: DirectoryState;
}

interface KnownAgency {
  deptId: string;
  name: string;
  nameEn: string;
  shortCode: string;
  ministry: string;
}

// Verified live against the e-GP RSS feed -- the same four agencies, names and
// codes as scripts/seedGovSites.ts.
export const KNOWN_AGENCIES: readonly KnownAgency[] = [
  { deptId: '2102', name: 'สำนักงานปลัดกระทรวงสาธารณสุข', nameEn: 'Office of the Permanent Secretary, Ministry of Public Health', shortCode: 'MOPH', ministry: 'กระทรวงสาธารณสุข' },
  { deptId: '0806', name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOH-highway', ministry: 'กระทรวงคมนาคม' },
  { deptId: '2109', name: 'กรมอนามัย', nameEn: 'Department of Health', shortCode: 'DOH-health', ministry: 'กระทรวงสาธารณสุข' },
  { deptId: '1106', name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล', nameEn: 'Digital Economy Promotion Agency', shortCode: 'depa', ministry: 'กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม' }
];

export const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000; // a 2022 snapshot: it will not change by the hour
export const DIRECTORY_RETRY_AFTER_MS = 60 * 1000; // after a failed load, do not ask again for a minute
const DIRECTORY_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 8;
const MIN_TEXT_QUERY_LENGTH = 2;

interface DirectoryCache {
  departments: DirectoryDepartment[];
  loadedAt: number;
}

let cache: DirectoryCache | null = null;
let inFlight: Promise<DirectoryCache> | null = null;
let lastFailure: { at: number; message: string } | null = null;

/** For tests: forget everything loaded so far. */
export function resetDeptIdDirectoryCache(): void {
  cache = null;
  inFlight = null;
  lastFailure = null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s waiting for data.go.th.`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function loadDirectory(now: number): Promise<DirectoryCache> {
  // One load at a time: a burst of keystrokes must not fan out into a burst of
  // requests to data.go.th.
  inFlight ??= withTimeout(fetchMofDepartments(), DIRECTORY_TIMEOUT_MS)
    .then(load => {
      if (load.departments.length === 0) throw new Error('data.go.th returned no usable departments.');
      cache = { departments: load.departments, loadedAt: now };
      lastFailure = null;
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function directoryFor(now: number): Promise<{ departments: DirectoryDepartment[]; state: DirectoryState }> {
  const describe = (status: DirectoryState['status'], extra: Partial<DirectoryState> = {}): DirectoryState => ({
    status,
    loadedAt: cache ? new Date(cache.loadedAt).toISOString() : null,
    agencies: cache?.departments.length ?? 0,
    ...extra
  });

  if (cache && now - cache.loadedAt < DIRECTORY_TTL_MS) {
    return { departments: cache.departments, state: describe('ok') };
  }
  if (lastFailure && now - lastFailure.at < DIRECTORY_RETRY_AFTER_MS) {
    return { departments: cache?.departments ?? [], state: describe(cache ? 'stale' : 'unavailable', { error: lastFailure.message }) };
  }

  try {
    const loaded = await loadDirectory(now);
    return { departments: loaded.departments, state: describe('ok') };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastFailure = { at: now, message };
    logger.warn('deptId', `Could not load the agency directory from data.go.th: ${message}`);
    return { departments: cache?.departments ?? [], state: describe(cache ? 'stale' : 'unavailable', { error: message }) };
  }
}

interface Candidate extends DeptIdSuggestion {
  haystack: string;
}

function candidatesFrom(departments: DirectoryDepartment[]): Candidate[] {
  const byDeptId = new Map<string, Candidate>();
  const add = (candidate: DeptIdSuggestion) => {
    byDeptId.set(candidate.deptId, {
      ...candidate,
      haystack: normalizeThaiSearchText([candidate.name, candidate.nameEn, candidate.shortCode, candidate.ministry].filter(Boolean).join(' '))
    });
  };
  for (const department of departments) {
    add({ deptId: department.deptId, name: department.name, ministry: department.ministry || undefined, confidence: 'derived' });
  }
  // Verified agencies replace a derived entry for the same code (clean name, proven code).
  for (const known of KNOWN_AGENCIES) {
    add({ deptId: known.deptId, name: known.name, nameEn: known.nameEn, shortCode: known.shortCode, ministry: known.ministry, confidence: 'confirmed' });
  }
  return [...byDeptId.values()];
}

// Higher is a better match; 0 is no match.
function scoreCandidate(candidate: Candidate, query: string, isCode: boolean, regex: RegExp | null): number {
  if (isCode) {
    if (candidate.deptId === query) return 100;
    return candidate.deptId.startsWith(query) ? 80 : 0;
  }
  const needle = normalizeThaiSearchText(query);
  const name = normalizeThaiSearchText(candidate.name);
  if (name === needle || normalizeThaiSearchText(candidate.shortCode ?? '') === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (name.includes(needle)) return 60;
  if (candidate.haystack.includes(needle)) return 40;
  // The directory's own Thai text has typos, so a near match still counts --
  // for Thai queries only (a one-letter slip in "depa" is just a different word).
  return regex?.test(candidate.haystack) ? 20 : 0;
}

export interface SuggestOptions {
  limit?: number;
  now?: number;
}

export async function suggestDeptIds(rawQuery: string, options: SuggestOptions = {}): Promise<DeptIdSuggestionResult> {
  const query = rawQuery.trim();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const isCode = /^\d{1,5}$/.test(query);

  // Too little to search on: do not even touch data.go.th.
  if (!isCode && Array.from(query).length < MIN_TEXT_QUERY_LENGTH) {
    return { query, suggestions: [], directory: { status: cache ? 'ok' : 'unavailable', loadedAt: cache ? new Date(cache.loadedAt).toISOString() : null, agencies: cache?.departments.length ?? 0 } };
  }

  const { departments, state } = await directoryFor(options.now ?? Date.now());
  const regex = isCode || !/[\u0E00-\u0E7F]/.test(query) ? null : buildThaiSearchRegex(query);

  const ranked = candidatesFrom(departments)
    .map(candidate => ({ candidate, score: scoreCandidate(candidate, query, isCode, regex) }))
    .filter(entry => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // typed digits: lowest code first; typed words: verified agencies first
        (isCode
          ? a.candidate.deptId.localeCompare(b.candidate.deptId)
          : Number(b.candidate.confidence === 'confirmed') - Number(a.candidate.confidence === 'confirmed') ||
            a.candidate.name.localeCompare(b.candidate.name, 'th'))
    )
    .slice(0, limit)
    .map(entry => entry.candidate);

  const taken = ranked.length > 0 ? await GovSite.find({ deptId: { $in: ranked.map(r => r.deptId) } }).select('deptId name shortCode') : [];
  const siteByDeptId = new Map(taken.map(site => [site.deptId, site]));

  const suggestions = ranked.map(({ haystack: _haystack, ...suggestion }): DeptIdSuggestion => {
    const site = siteByDeptId.get(suggestion.deptId);
    return site ? { ...suggestion, alreadyAdded: { siteId: site._id.toString(), name: site.name, shortCode: site.shortCode } } : suggestion;
  });

  return { query, suggestions, directory: state };
}
