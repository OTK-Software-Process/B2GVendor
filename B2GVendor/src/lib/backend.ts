// Live backend API layer -- fetch functions + adapters that map the real
// Backend response shapes (Backend/src/models/*.ts, work.service.ts) onto
// the existing frontend view types in mock-data.ts, so the already-built UI
// components (WorkCard, StatusBadge, TORDownloadList, FilterBar, ...) can
// render real data without a full rewrite. Also backs the admin ingestion
// pages (poll trigger, run history/detail) -- see fetchIngestionRuns,
// pollSite/pollAllSites, toIngestionRun below -- and the department list,
// poll status and automatic schedule (fetchAdminGovSites, fetchPollStatus,
// fetchSchedule). Pages that still use MOCK_* data (tag management,
// account/user admin) are unaffected.

import { api } from './api';
import { egp2PageLinks } from './egp';
import {
  WorkItem,
  TagItem,
  GovSiteItem,
  SiteLastRun,
  TORFile,
  ProcurementStatus,
  BudgetMissingReason,
  BudgetBasis,
  IngestionRun,
  LogEntry,
  MOCK_STATUS_CONFIG
} from './mock-data';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type BackendTagFacet = 'site' | 'agency' | 'method' | 'category' | 'keyword';
export type BackendWorkStatus = 'PLANNED' | 'DRAFT_TOR' | 'BIDDING' | 'CANCELLED' | 'AMENDED' | 'AWARDED';
export type BackendAnnounceType = 'P0' | '15' | 'B0' | 'D0' | 'W0' | 'D1' | 'W1' | 'D2' | 'W2';
export type BackendTorLinkType = 'pdf' | 'zip' | 'html' | 'other';

export interface BackendTag {
  _id: string;
  name: string;
  facet: BackendTagFacet;
  aliases?: string[];
  siteId?: string;
  retired?: boolean;
}

export interface BackendGovSiteRef {
  _id: string;
  name: string;
  shortCode: string;
}

export interface BackendGovSite extends BackendGovSiteRef {
  nameEn?: string;
  deptId: string;
  announceTypes: BackendAnnounceType[];
  dataGoThOrgSlug?: string;
  enabled: boolean;
  requestsPerMinute: number;
  pollIntervalMinutes?: number;
  // Real number of listed works -- both the public directory and the admin
  // list carry it.
  worksCount?: number;
  createdAt: string;
  updatedAt: string;
}

// GET /admin/gov-sites -- the same site plus its real run results and schedule.
export interface BackendAdminGovSite extends BackendGovSite {
  lastRun: SiteLastRun | null;
  effectiveIntervalMinutes: number;
  nextRunAt: string | null;
}

export interface BackendTorFile {
  announceType: BackendAnnounceType;
  linkType: BackendTorLinkType;
  sourceUrl: string;
  storageKey?: string;
  filename?: string;
  downloadedAt?: string;
  role?: 'primary' | 'attachment';
  supersededAt?: string;
}

export interface BackendStatusHistoryEntry {
  status: BackendWorkStatus;
  announceType: BackendAnnounceType;
  changedAt: string;
  note?: string;
}

export interface BackendWork {
  _id: string;
  siteId: BackendGovSiteRef;
  projectId: string;
  title: string;
  description?: string;
  status: BackendWorkStatus;
  announceType: BackendAnnounceType;
  pubDate?: string;
  torFiles: BackendTorFile[];
  statusHistory: BackendStatusHistoryEntry[];
  budget?: number;
  budgetMissingReason?: BudgetMissingReason;
  budgetBasis?: BudgetBasis;
  contractNumber?: string;
  contractDate?: string;
  winnerName?: string;
  winnerTin?: string;
  fiscalYear?: number;
  fiscalYearSource?: 'document' | 'estimated';
  deadlineAt?: string;
  deadlineStartAt?: string;
  deadlineHasTime?: boolean;
  tags: BackendTag[];
  createdAt: string;
  updatedAt: string;
}

export interface ListWorksResponse {
  items: BackendWork[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListWorksParams {
  siteId?: string;
  status?: BackendWorkStatus;
  tag?: string; // comma-separated Tag ids
  q?: string;
  budgetMax?: number;
  fiscalYear?: number; // ปีงบประมาณ, Buddhist Era
  sort?: 'date' | 'budget-asc' | 'budget-desc' | 'deadline';
  page?: number;
  pageSize?: number;
}

export interface FiscalYearOption {
  year: number;
  count: number;
}

function buildQuery(params: object): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export function fetchWorks(params: ListWorksParams = {}): Promise<ListWorksResponse> {
  return api.get<ListWorksResponse>(`/works${buildQuery(params)}`);
}

export function fetchWorkById(id: string): Promise<BackendWork> {
  return api.get<BackendWork>(`/works/${id}`);
}

// The fiscal years that have works, newest first -- what the ปีงบประมาณ filter offers.
export function fetchFiscalYears(): Promise<FiscalYearOption[]> {
  return api.get<FiscalYearOption[]>('/works/fiscal-years');
}

export function fetchTags(params: { facet?: BackendTagFacet } = {}): Promise<BackendTag[]> {
  return api.get<BackendTag[]>(`/tags${buildQuery(params)}`);
}

export function fetchGovSites(): Promise<BackendGovSite[]> {
  return api.get<BackendGovSite[]>('/gov-sites');
}

// Admin list: real works count, last run and next scheduled run per site.
export function fetchAdminGovSites(): Promise<BackendAdminGovSite[]> {
  return api.get<BackendAdminGovSite[]>('/admin/gov-sites');
}

// Enable/disable a department for polling (Super Admin only -- the API
// answers 403 to a regular admin). Returns the updated site.
export function updateGovSite(id: string, patch: { enabled?: boolean }): Promise<BackendGovSite> {
  return api.patch<BackendGovSite>(`/admin/gov-sites/${id}`, patch);
}

export interface CreateGovSiteBody {
  name: string;
  nameEn?: string;
  shortCode: string;
  deptId: string;
  requestsPerMinute?: number;
}

export function createGovSite(body: CreateGovSiteBody): Promise<BackendGovSite> {
  return api.post<BackendGovSite>('/admin/gov-sites', body);
}

export function torFileUrl(workId: string, index: number): string {
  return `${API_BASE}/works/${workId}/tor/${index}`;
}

// --- Adapters: Backend* -> the frontend's existing view types ---

export function toTagItem(tag: BackendTag): TagItem {
  return {
    id: tag._id,
    name: tag.name,
    facet: tag.facet,
    aliases: tag.aliases ?? [],
    followerCount: 0, // not tracked by the backend yet
    worksCount: 0,
    retired: tag.retired
  };
}

export function toGovSiteItem(site: BackendGovSite | BackendAdminGovSite): GovSiteItem {
  const admin = site as Partial<BackendAdminGovSite>;
  return {
    id: site._id,
    name: site.name,
    nameEn: site.nameEn ?? site.shortCode,
    shortCode: site.shortCode,
    enabled: site.enabled,
    requestsPerMin: site.requestsPerMinute,
    worksCount: site.worksCount ?? 0,
    deptId: site.deptId,
    announceTypes: site.announceTypes,
    dataGoThOrgSlug: site.dataGoThOrgSlug,
    pollIntervalMinutes: site.pollIntervalMinutes ?? null,
    effectiveIntervalMinutes: admin.effectiveIntervalMinutes,
    nextRunAt: admin.nextRunAt,
    lastRun: admin.lastRun
  };
}

const ANNOUNCE_TYPE_LABEL: Record<string, string> = {
  P0: 'แผนการจัดซื้อจัดจ้าง',
  '15': 'ราคากลาง',
  B0: 'ร่าง TOR',
  D0: 'ประกาศเชิญชวน',
  D1: 'ยกเลิกประกาศ',
  D2: 'แก้ไขประกาศ',
  W0: 'ประกาศผู้ชนะ',
  W1: 'ยกเลิกผลการประกวดราคา',
  W2: 'แก้ไขผลการประกวดราคา'
};

function torFileName(file: BackendTorFile, index: number): string {
  if (file.filename) return file.filename;
  try {
    const base = new URL(file.sourceUrl).pathname.split('/').pop();
    if (base) return decodeURIComponent(base);
  } catch {
    // sourceUrl wasn't a parseable absolute URL -- fall through
  }
  return `เอกสาร ${index + 1} (${ANNOUNCE_TYPE_LABEL[file.announceType] ?? file.announceType})`;
}

// A link to show the user must be a plain web address. The TOR links come out of
// an external feed, so anything else (javascript:, data:, a relative path) is
// dropped instead of being rendered as a clickable href.
export function safeHttpUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function toTORFile(workId: string, file: BackendTorFile, index: number): TORFile {
  const downloadable = Boolean(file.storageKey);
  return {
    id: `${workId}-${index}`,
    name: torFileName(file, index),
    size: '', // the backend doesn't track file size
    url: downloadable ? torFileUrl(workId, index) : (safeHttpUrl(file.sourceUrl) ?? '#'),
    // Only a file WE downloaded has a download date: an HTML announcement page
    // is read (its `downloadedAt` marks that) but stays a link to the source site.
    date: downloadable ? (file.downloadedAt ?? '').slice(0, 10) : '',
    type: file.linkType.toUpperCase(),
    external: !downloadable,
    // Every TOR links back to where the government published it -- including the
    // ones we also host a copy of.
    sourceUrl: safeHttpUrl(file.sourceUrl)
  };
}

function statusLabel(status: string): string {
  return MOCK_STATUS_CONFIG[status as ProcurementStatus]?.label ?? status;
}

export function toWorkItem(work: BackendWork): WorkItem {
  const tags = work.tags.map(toTagItem);
  const agencyTag = tags.find(t => t.facet === 'agency');
  const categoryTag = tags.find(t => t.facet === 'category');
  const methodTag = tags.find(t => t.facet === 'method');

  return {
    id: work._id,
    projectId: work.projectId,
    egpPages: egp2PageLinks(work),
    title: work.title,
    siteId: work.siteId._id,
    siteName: work.siteId.name,
    agencyId: agencyTag?.id ?? '',
    agencyName: agencyTag?.name ?? work.siteId.name,
    category: categoryTag?.name ?? '',
    method: 'e-bidding',
    // The procurement method (วิธีการจัดซื้อจัดจ้าง) is its 'method' tag -- empty
    // when the work has none, never the announce-type label ("ประกาศเชิญชวน"),
    // which is a lifecycle stage and used to be shown here as if it were a method.
    methodLabel: methodTag?.name ?? '',
    // No price is null, not 0 -- the UI shows why (budgetMissingReason).
    budget: work.budget && work.budget > 0 ? work.budget : null,
    budgetMissingReason: work.budgetMissingReason,
    budgetBasis: work.budgetBasis,
    publishDate: (work.pubDate ?? work.createdAt).slice(0, 10),
    closingDate: '', // unused -- the deadline is deadlineAt below, an instant shown in Thailand time (lib/deadline.ts)
    fiscalYear: work.fiscalYear,
    fiscalYearEstimated: work.fiscalYear ? work.fiscalYearSource === 'estimated' : undefined,
    deadlineAt: work.deadlineAt,
    deadlineStartAt: work.deadlineStartAt,
    deadlineHasTime: work.deadlineHasTime,
    status: work.status as ProcurementStatus,
    statusLabel: statusLabel(work.status),
    description: work.description ?? '',
    tags,
    torFiles: work.torFiles.map((f, i) => toTORFile(work._id, f, i)),
    history: work.statusHistory.map(h => ({
      date: h.changedAt.slice(0, 16).replace('T', ' '),
      status: h.status as ProcurementStatus,
      statusLabel: statusLabel(h.status),
      note: h.note ?? (ANNOUNCE_TYPE_LABEL[h.announceType] ?? h.announceType)
    })),
    updatedAt: work.updatedAt.slice(0, 16).replace('T', ' ')
  };
}

// --- Admin: ingestion runs + poll jobs ---
//
// Backend/src/models/ingestionRun.model.ts's design and this UI's IngestionRun
// (mock-data.ts) don't line up 1:1: a real IngestionRun is always exactly ONE
// (site, source) pair, while the mock type represents a whole multi-site poll
// EVENT with a siteBreakdown array. Rather than reconstruct that grouping
// (would need to correlate runs back to the PollJob that produced them), each
// real run is shown as its own row with a single-entry siteBreakdown -- more
// granular than the mock demo, but every number on it is real. "logs" has no
// real equivalent either (the backend keeps counts + errorLog, not a
// timestamped trace) -- toIngestionRun() below synthesizes log lines FROM the
// real fields (real counts/errors, reformatted as log lines), not fabricated
// data.

export type BackendIngestionSource = 'rss' | 'data_go_th';
export type BackendIngestionRunStatus = 'running' | 'success' | 'partial' | 'failed';
export type BackendPollJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BackendIngestionRun {
  _id: string;
  siteId: BackendGovSiteRef;
  source: BackendIngestionSource;
  status: BackendIngestionRunStatus;
  resolvedResourceId?: string;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
  errorLog: string[];
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendPollJob {
  _id: string;
  scope: 'site' | 'all';
  siteId?: string;
  source: 'rss' | 'data_go_th' | 'both';
  status: BackendPollJobStatus;
  claimedAt?: string;
  finishedAt?: string;
  resultRunIds: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListIngestionRunsParams {
  siteId?: string;
  source?: BackendIngestionSource;
  status?: BackendIngestionRunStatus;
  page?: number;
  pageSize?: number;
}

export interface ListIngestionRunsResponse {
  items: BackendIngestionRun[];
  total: number;
  page: number;
  pageSize: number;
}

export function fetchIngestionRuns(params: ListIngestionRunsParams = {}): Promise<ListIngestionRunsResponse> {
  return api.get<ListIngestionRunsResponse>(`/admin/ingestion/runs${buildQuery(params)}`);
}

export function fetchIngestionRunById(id: string): Promise<BackendIngestionRun> {
  return api.get<BackendIngestionRun>(`/admin/ingestion/runs/${id}`);
}

// Enqueues a real PollJob -- the ingestion-worker process (not this request)
// actually claims and executes it (see Backend/src/worker.ts). Returns
// immediately with status "queued"; whether it is still running is read from
// fetchPollStatus() below (see the status loop in AppContext.tsx). Answers 409
// when a poll is already running.
export function pollSite(siteId: string, source: 'rss' | 'data_go_th' | 'both' = 'both'): Promise<BackendPollJob> {
  return api.post<BackendPollJob>(`/admin/gov-sites/${siteId}/poll`, { source });
}

export function pollAllSites(): Promise<BackendPollJob> {
  return api.post<BackendPollJob>('/admin/gov-sites/poll-all', {});
}

// Server-side truth for "is a poll running?" -- the same answer for every
// admin account, and it survives a page refresh (unlike a flag in this tab).
export interface BackendActivePollJob {
  id: string;
  scope: 'site' | 'all';
  siteId?: string;
  siteName?: string;
  source: 'rss' | 'data_go_th' | 'both';
  status: 'queued' | 'running';
  trigger: 'scheduler' | 'manual';
  createdAt: string;
  claimedAt?: string;
}

export interface BackendPollStatus {
  isPolling: boolean;
  activeJobs: BackendActivePollJob[];
}

export function fetchPollStatus(): Promise<BackendPollStatus> {
  return api.get<BackendPollStatus>('/admin/ingestion/status');
}

// The automatic schedule (admin > Data Ingestion > Automatic Schedule).
export interface BackendScheduleOverview {
  pollIntervalMinutes: number;
  scheduleEnabled: boolean;
  minIntervalMinutes: number; // the floor the API enforces (2 hours)
  maxIntervalMinutes: number;
  defaultIntervalMinutes: number; // 24 hours
  nextRunAt: string | null;
  updatedAt: string;
}

export function fetchSchedule(): Promise<BackendScheduleOverview> {
  return api.get<BackendScheduleOverview>('/admin/ingestion/settings');
}

export function updateSchedule(patch: { pollIntervalMinutes?: number; scheduleEnabled?: boolean }): Promise<BackendScheduleOverview> {
  return api.patch<BackendScheduleOverview>('/admin/ingestion/settings', patch);
}

// "YYYY-MM-DD HH:mm:ss" in the viewer's LOCAL time. (Was a raw slice of the UTC
// ISO string, which read 7 hours behind the local times the rest of the admin
// area shows -- the department list, next-run countdowns -- for the same run.)
function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatDuration(startedAt: string, finishedAt: string | undefined): string {
  if (!finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const RUN_STATUS_MAP: Record<BackendIngestionRunStatus, IngestionRun['status']> = {
  running: 'RUNNING',
  success: 'SUCCESS',
  partial: 'WARNING',
  failed: 'FAILED'
};

const SOURCE_LABEL: Record<BackendIngestionSource, string> = {
  rss: 'e-GP RSS',
  data_go_th: 'data.go.th'
};

function buildRunLogs(run: BackendIngestionRun): LogEntry[] {
  const logs: LogEntry[] = [
    { time: formatDateTime(run.startedAt), level: 'INFO', message: `Started ${SOURCE_LABEL[run.source]} poll for ${run.siteId.name}` }
  ];

  if (run.resolvedResourceId) {
    logs.push({ time: formatDateTime(run.startedAt), level: 'INFO', message: `Resolved data.go.th resource: ${run.resolvedResourceId}` });
  }

  const finishTime = formatDateTime(run.finishedAt);
  if (run.status !== 'running') {
    logs.push({
      time: finishTime,
      level: 'INFO',
      message: `Fetched ${run.fetchedCount} item(s) -- ${run.newCount} new, ${run.updatedCount} updated`
    });
  }

  for (const message of run.errorLog) {
    logs.push({ time: finishTime, level: 'WARN', message });
  }

  if (run.status !== 'running') {
    logs.push({
      time: finishTime,
      level: run.status === 'failed' ? 'ERROR' : 'INFO',
      message: `Run finished with status=${run.status}`
    });
  }

  return logs;
}

export function toIngestionRun(run: BackendIngestionRun): IngestionRun {
  const skippedCount = Math.max(0, run.fetchedCount - run.newCount - run.updatedCount - run.failedCount);

  return {
    runId: run._id,
    startTime: formatDateTime(run.startedAt),
    endTime: formatDateTime(run.finishedAt),
    duration: formatDuration(run.startedAt, run.finishedAt),
    status: RUN_STATUS_MAP[run.status],
    fetchedCount: run.fetchedCount,
    newCount: run.newCount,
    updatedCount: run.updatedCount,
    skippedCount,
    failedCount: run.failedCount,
    siteBreakdown: [
      {
        siteId: run.siteId._id,
        siteName: `${run.siteId.name} (${SOURCE_LABEL[run.source]})`,
        fetchedCount: run.fetchedCount,
        newCount: run.newCount,
        updatedCount: run.updatedCount,
        failedCount: run.failedCount
      }
    ],
    logs: buildRunLogs(run)
  };
}

// --- Account: notification settings ---
// Backend/src/models/account.model.ts's emailNotificationsEnabled /
// notificationFrequency + Follow.paused (per-tag mute) -- see
// Backend/src/services/notification.service.ts for how these actually gate
// email delivery (in-app notifications are always created regardless).

export type BackendNotificationFrequency = 'instant' | 'daily';

export interface BackendNotificationSettings {
  emailNotificationsEnabled: boolean;
  notificationFrequency: BackendNotificationFrequency;
  pausedTagIds: string[];
}

export function fetchNotificationSettings(): Promise<BackendNotificationSettings> {
  return api.get<BackendNotificationSettings>('/account/notification-settings');
}

export function updateNotificationSettings(update: {
  emailNotificationsEnabled?: boolean;
  notificationFrequency?: BackendNotificationFrequency;
}): Promise<{ emailNotificationsEnabled: boolean; notificationFrequency: BackendNotificationFrequency }> {
  return api.patch('/account/notification-settings', update);
}

export function setTagPaused(tagId: string, paused: boolean): Promise<void> {
  return api.patch(`/follows/tags/${tagId}/pause`, { paused });
}

// ---------------------------------------------------------------------------
// Admin dashboard -- GET /admin/dashboard (Backend/src/services/adminDashboard.service.ts).
// One read-only snapshot of live counts; nothing on it is editable.
// ---------------------------------------------------------------------------

export interface BackendDashboardRun {
  id: string;
  source: BackendIngestionSource;
  status: BackendIngestionRunStatus;
  startedAt: string;
  finishedAt?: string;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  failedCount: number;
}

export interface BackendDashboardSiteRow {
  siteId: string;
  name: string;
  shortCode: string;
  enabled: boolean;
  lastRun: BackendDashboardRun | null;
}

export interface BackendAdminDashboard {
  generatedAt: string;
  accounts: {
    vendors: { total: number; active: number; suspended: number };
    admins: { total: number; admin: number; superadmin: number; suspended: number };
  };
  tags: { active: number; retired: number; byFacet: Record<BackendTagFacet, number> };
  sites: { total: number; enabled: number };
  works: { total: number; visible: number; hidden: number };
  ingestion: {
    lastRun: (BackendDashboardRun & { site: { id: string; name: string; shortCode: string } }) | null;
    failedRuns24h: number;
    runningNow: number;
    queuedJobs: number;
    nextScheduledAt: string | null;
    scheduleEnabled: boolean;
    pollIntervalMinutes: number;
    sites: BackendDashboardSiteRow[];
  };
}

export function fetchAdminDashboard(): Promise<BackendAdminDashboard> {
  return api.get<BackendAdminDashboard>('/admin/dashboard');
}

// ---------------------------------------------------------------------------
// Admin tag management -- /admin/tags (Backend/src/services/tag.service.ts).
// Duplicate handling is governance, not merging: a redundant tag is retired.
// ---------------------------------------------------------------------------

export interface BackendAdminTag {
  _id: string;
  name: string;
  facet: BackendTagFacet;
  aliases: string[];
  siteId?: string;
  retired: boolean;
  includeInIngestionFilter: boolean;
  worksCount: number;
  followerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackendTagMatch {
  tagId: string;
  name: string;
  facet: BackendTagFacet;
  retired: boolean;
  candidateTerm: string;
  existingTerm: string;
  similarity: number;
}

export interface BackendTagConflicts {
  exact: BackendTagMatch[];
  similar: BackendTagMatch[];
}

export function fetchAdminTags(
  params: { facet?: BackendTagFacet; includeRetired?: boolean; search?: string } = {}
): Promise<BackendAdminTag[]> {
  return api.get<BackendAdminTag[]>(`/admin/tags${buildQuery(params)}`);
}

export function checkTagDuplicates(input: {
  name: string;
  aliases?: string[];
  facet?: BackendTagFacet;
  excludeId?: string;
}): Promise<BackendTagConflicts> {
  return api.post<BackendTagConflicts>('/admin/tags/check-duplicates', input);
}

export function createAdminTag(input: {
  name: string;
  facet: Exclude<BackendTagFacet, 'site'>;
  aliases?: string[];
  confirmNearDuplicate?: boolean;
}): Promise<BackendAdminTag> {
  return api.post<BackendAdminTag>('/admin/tags', input);
}

export function updateAdminTag(
  id: string,
  input: { name?: string; aliases?: string[]; confirmNearDuplicate?: boolean }
): Promise<BackendAdminTag> {
  return api.patch<BackendAdminTag>(`/admin/tags/${id}`, input);
}

export function retireAdminTag(id: string): Promise<BackendAdminTag> {
  return api.patch<BackendAdminTag>(`/admin/tags/${id}/retire`);
}

export function reactivateAdminTag(id: string): Promise<BackendAdminTag> {
  return api.patch<BackendAdminTag>(`/admin/tags/${id}/reactivate`);
}

// ---------------------------------------------------------------------------
// Admin work tag curation -- /admin/works (Backend/src/services/adminWork.service.ts).
// The only thing an admin edits on a work is which tags it carries; status and
// every other field stay source-derived.
// ---------------------------------------------------------------------------

export interface BackendAdminWorkTag {
  _id: string;
  name: string;
  facet: BackendTagFacet;
  retired?: boolean;
}

export type BackendIngestionRelevance = 'shown' | 'not-related';

export interface BackendAdminWork {
  _id: string;
  siteId: BackendGovSiteRef;
  projectId: string;
  title: string;
  status: BackendWorkStatus;
  announceType: BackendAnnounceType;
  pubDate?: string;
  tags: BackendAdminWorkTag[];
  /** Tags an admin removed by hand; future polls never re-add them (detail only). */
  excludedTags?: string[];
  ingestionRelevance?: BackendIngestionRelevance;
  updatedAt: string;
}

export interface BackendAdminWorkList {
  items: BackendAdminWork[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BackendAdminWorkDetail {
  work: BackendAdminWork;
  ingestionFilter: { active: boolean; inScopeTagIds: string[] };
}

export interface BackendSetWorkTagsResult {
  work: BackendAdminWork;
  added: { id: string; name: string }[];
  removed: { id: string; name: string }[];
  relevance: { from: BackendIngestionRelevance | null; to: BackendIngestionRelevance | null };
}

export function fetchAdminWorks(
  params: { q?: string; siteId?: string; tag?: string; visibility?: 'visible' | 'hidden'; page?: number; pageSize?: number } = {}
): Promise<BackendAdminWorkList> {
  return api.get<BackendAdminWorkList>(`/admin/works${buildQuery(params)}`);
}

export function fetchAdminWork(id: string): Promise<BackendAdminWorkDetail> {
  return api.get<BackendAdminWorkDetail>(`/admin/works/${encodeURIComponent(id)}`);
}

export function setAdminWorkTags(id: string, tagIds: string[]): Promise<BackendSetWorkTagsResult> {
  return api.put<BackendSetWorkTagsResult>(`/admin/works/${encodeURIComponent(id)}/tags`, { tagIds });
}

// ---------------------------------------------------------------------------
// Admin vendor accounts -- /admin/accounts (Backend/src/services/adminAccount.service.ts).
// Only vendor ("user") accounts; staff are managed separately. The admin never
// sets a vendor's password: creating an account emails the vendor a link.
// ---------------------------------------------------------------------------

export type BackendAccountStatus = 'active' | 'suspended';
export type BackendAccountType = 'individual' | 'business';

export interface BackendVendor {
  id: string;
  name: string;
  email: string;
  phone?: string;
  type: BackendAccountType;
  businessProfile?: { companyName: string; taxId: string };
  status: BackendAccountStatus;
  createdAt: string;
  updatedAt: string;
  followedTagsCount: number;
  lastActiveAt: string | null;
}

export interface BackendVendorList {
  items: BackendVendor[];
  total: number;
  page: number;
  pageSize: number;
  /** Unfiltered totals, independent of search/filters. */
  summary: { total: number; active: number; suspended: number };
}

export interface BackendSetupEmailResult {
  sent: boolean;
  reason?: 'smtp_not_configured' | 'send_failed';
}

export function fetchVendors(
  params: {
    q?: string;
    status?: BackendAccountStatus;
    type?: BackendAccountType;
    sort?: 'newest' | 'oldest' | 'name';
    page?: number;
    pageSize?: number;
  } = {}
): Promise<BackendVendorList> {
  return api.get<BackendVendorList>(`/admin/accounts${buildQuery(params)}`);
}

export function createVendor(input: {
  name: string;
  email: string;
  phone?: string;
  type: BackendAccountType;
  businessProfile?: { companyName: string; taxId: string };
}): Promise<{ vendor: BackendVendor; setupEmail: BackendSetupEmailResult }> {
  return api.post('/admin/accounts', input);
}

export function updateVendor(
  id: string,
  input: { name?: string; phone?: string | null; businessProfile?: { companyName: string; taxId: string } }
): Promise<BackendVendor> {
  return api.patch<BackendVendor>(`/admin/accounts/${encodeURIComponent(id)}`, input);
}

export function suspendVendor(id: string): Promise<BackendVendor> {
  return api.patch<BackendVendor>(`/admin/accounts/${encodeURIComponent(id)}/suspend`);
}

export function reactivateVendor(id: string): Promise<BackendVendor> {
  return api.patch<BackendVendor>(`/admin/accounts/${encodeURIComponent(id)}/reactivate`);
}

export function sendVendorPasswordLink(id: string): Promise<BackendSetupEmailResult> {
  return api.post<BackendSetupEmailResult>(`/admin/accounts/${encodeURIComponent(id)}/password-link`);
}

export function deleteVendor(id: string): Promise<{ id: string; email: string }> {
  return api.del<{ id: string; email: string }>(`/admin/accounts/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Admin (staff) accounts -- /admin/staff (Backend/src/services/adminStaff.service.ts).
// Super Admin only. Plain Admins can be changed; Super Admins are listed
// read-only (`manageable: false`).
// ---------------------------------------------------------------------------

export type BackendStaffRole = 'admin' | 'superadmin';

export interface BackendStaff {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: BackendStaffRole;
  /**
   * Which of the three Admin roles an Admin holds. null for a Super Admin, and
   * for an Admin nobody has assigned a role yet (created before roles were split).
   */
  permission: 'poll:manage' | 'tag:manage' | 'poll&tag:manage' | null;
  status: BackendAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  /** Live (not revoked, not expired) sessions: who could act right now. */
  activeSessions: number;
  manageable: boolean;
}

export interface BackendStaffList {
  items: BackendStaff[];
  total: number;
  page: number;
  pageSize: number;
  /** Unfiltered totals, independent of search/filters. */
  summary: { total: number; admins: number; superadmins: number; suspended: number };
}

export function fetchStaff(
  params: {
    q?: string;
    status?: BackendAccountStatus;
    role?: BackendStaffRole;
    sort?: 'newest' | 'oldest' | 'name';
    page?: number;
    pageSize?: number;
  } = {}
): Promise<BackendStaffList> {
  return api.get<BackendStaffList>(`/admin/staff${buildQuery(params)}`);
}

export function createAdminAccount(input: {
  name: string;
  email: string;
  phone?: string;
  permission: 'poll:manage' | 'tag:manage' | 'poll&tag:manage';
}): Promise<{ admin: BackendStaff; setupEmail: BackendSetupEmailResult }> {
  return api.post('/admin/staff', input);
}

export function updateAdminAccount(
  id: string,
  input: { name?: string; phone?: string | null; permission?: 'poll:manage' | 'tag:manage' | 'poll&tag:manage' }
): Promise<BackendStaff> {
  return api.patch<BackendStaff>(`/admin/staff/${encodeURIComponent(id)}`, input);
}

export function suspendAdminAccount(id: string): Promise<BackendStaff> {
  return api.patch<BackendStaff>(`/admin/staff/${encodeURIComponent(id)}/suspend`);
}

export function reactivateAdminAccount(id: string): Promise<BackendStaff> {
  return api.patch<BackendStaff>(`/admin/staff/${encodeURIComponent(id)}/reactivate`);
}

export function signOutAdminAccount(id: string): Promise<{ revoked: number }> {
  return api.post<{ revoked: number }>(`/admin/staff/${encodeURIComponent(id)}/sign-out`);
}

export function sendAdminPasswordLink(id: string): Promise<BackendSetupEmailResult> {
  return api.post<BackendSetupEmailResult>(`/admin/staff/${encodeURIComponent(id)}/password-link`);
}

export function deleteAdminAccount(id: string): Promise<{ id: string; email: string }> {
  return api.del<{ id: string; email: string }>(`/admin/staff/${encodeURIComponent(id)}`);
}
