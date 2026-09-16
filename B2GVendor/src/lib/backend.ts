// Live backend API layer -- fetch functions + adapters that map the real
// Backend response shapes (Backend/src/models/*.ts, work.service.ts) onto
// the existing frontend view types in mock-data.ts, so the already-built UI
// components (WorkCard, StatusBadge, TORDownloadList, FilterBar, ...) can
// render real data without a full rewrite. Pages that still use MOCK_* data
// (admin tooling, notifications) are unaffected -- this file only backs the
// public search / home / agencies / work-detail pages.

import { api } from './api';
import {
  WorkItem,
  TagItem,
  GovSiteItem,
  TORFile,
  ProcurementStatus,
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
  createdAt: string;
  updatedAt: string;
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
  contractNumber?: string;
  contractDate?: string;
  winnerName?: string;
  winnerTin?: string;
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
  sort?: 'date' | 'budget-asc' | 'budget-desc';
  page?: number;
  pageSize?: number;
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

export function fetchTags(params: { facet?: BackendTagFacet } = {}): Promise<BackendTag[]> {
  return api.get<BackendTag[]>(`/tags${buildQuery(params)}`);
}

export function fetchGovSites(): Promise<BackendGovSite[]> {
  return api.get<BackendGovSite[]>('/gov-sites');
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

export function toGovSiteItem(site: BackendGovSite): GovSiteItem {
  return {
    id: site._id,
    name: site.name,
    nameEn: site.nameEn ?? site.shortCode,
    shortCode: site.shortCode,
    datasetId: site.dataGoThOrgSlug ?? site.deptId,
    enabled: site.enabled,
    requestsPerMin: site.requestsPerMinute,
    worksCount: 0 // not tracked by the backend yet
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

export function toTORFile(workId: string, file: BackendTorFile, index: number): TORFile {
  const downloadable = Boolean(file.storageKey);
  return {
    id: `${workId}-${index}`,
    name: torFileName(file, index),
    size: '', // the backend doesn't track file size
    url: downloadable ? torFileUrl(workId, index) : file.sourceUrl,
    date: (file.downloadedAt ?? '').slice(0, 10),
    type: file.linkType.toUpperCase(),
    external: !downloadable
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
    title: work.title,
    siteId: work.siteId._id,
    siteName: work.siteId.name,
    agencyId: agencyTag?.id ?? '',
    agencyName: agencyTag?.name ?? work.siteId.name,
    category: categoryTag?.name ?? '',
    method: 'e-bidding',
    methodLabel: methodTag?.name ?? ANNOUNCE_TYPE_LABEL[work.announceType] ?? work.announceType,
    budget: work.budget ?? 0,
    publishDate: (work.pubDate ?? work.createdAt).slice(0, 10),
    closingDate: '', // not tracked by the backend (no bid-closing-date field on Work)
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
