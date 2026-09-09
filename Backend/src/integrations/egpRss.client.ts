import { XMLParser } from 'fast-xml-parser';
import { env } from '../config/env';
import { AnnounceType } from '../models/govSite.model';
import { logger } from '../utils/logger';

/**
 * Client for the live e-GP RSS feed -- the PRIMARY source of new/updated
 * TOR announcements (see ProjectDescription.md N1). Ported from
 * testAPI/explore-egp-rss.ts, with two hardening changes for production use:
 *   1. A real XML parser (fast-xml-parser) instead of the exploration
 *      script's regex-based item extractor.
 *   2. Structured return values instead of console.log output.
 *
 * Confirmed live findings this client relies on:
 *   - No API key needed.
 *   - The feed is Windows-874 (Thai codepage) encoded, NOT UTF-8, despite
 *     declaring itself as standard XML -- must decode the raw bytes
 *     explicitly as windows-874 or every Thai character is corrupted.
 *   - Each item's <link> is a direct PDF download, a zip archive of several
 *     PDFs (seen on B0/draft-TOR items -- egp-upload-service), or an HTML
 *     detail page, mixed even within the same announceType/agency --
 *     classify it, never assume one shape.
 */

export type TorLinkType = 'pdf' | 'zip' | 'html' | 'other';

export interface EgpRssItem {
  title: string;
  link: string;
  linkType: TorLinkType;
  description: string;
  pubDate: Date | null;
  projectId: string | null;
}

export function classifyLink(link: string): TorLinkType {
  if (link.includes('/egp-template-service/dwnt/view-pdf-file')) return 'pdf';
  if (link.includes('/egp-upload-service/')) return 'zip';
  if (link.includes('ShowHTMLFile')) return 'html';
  return 'other';
}

function parsePubDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractProjectId(description: string, link: string): string | null {
  // The description field ("{projectId}, ...") is reliable for both link
  // kinds -- an HTML-detail link also carries projectId in its query string,
  // but a direct-PDF link only has an opaque templateId, so prefer description.
  const fromDescription = description.match(/^(\d+),/);
  if (fromDescription) return fromDescription[1];
  const fromLink = link.match(/projectId=(\d+)/);
  return fromLink ? fromLink[1] : null;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (_name, jpath) => jpath === 'rss.channel.item'
});

export async function fetchEgpRssFeed(deptId: string | null, announceType: AnnounceType): Promise<EgpRssItem[]> {
  const url = new URL(env.EGP_RSS_BASE_URL);
  if (deptId) url.searchParams.set('deptId', deptId);
  url.searchParams.set('anounceType', announceType);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`e-GP RSS feed returned HTTP ${res.status} for ${url}`);
  }

  const buf = await res.arrayBuffer();
  // See header comment -- the feed is Windows-874 despite looking like
  // standard XML. Decoding as UTF-8 (fetch's default) garbles every Thai
  // character.
  const xml = new TextDecoder('windows-874').decode(buf);

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    logger.error('egpRss', `failed to parse XML for deptId=${deptId} type=${announceType}`, err);
    throw new Error('Failed to parse e-GP RSS feed XML');
  }

  const rawItems: any[] = parsed?.rss?.channel?.item ?? [];

  return rawItems.map((raw): EgpRssItem => {
    const link = String(raw.link ?? '');
    const description = String(raw.description ?? '');
    return {
      title: String(raw.title ?? ''),
      link,
      linkType: classifyLink(link),
      description,
      pubDate: parsePubDate(raw.pubDate ? String(raw.pubDate) : undefined),
      projectId: extractProjectId(description, link)
    };
  });
}

export interface DownloadedFile {
  buffer: Buffer;
  filename: string;
}

// Only ever called for linkType === 'pdf' | 'zip' items -- an 'html' link is
// a page for a human, never fetched (that would be scraping). Generic over
// both since the download step itself (fetch + content-disposition filename
// parse) doesn't care what's inside.
export async function downloadTorFile(url: string, extensionFallback: 'pdf' | 'zip' = 'pdf'): Promise<DownloadedFile> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download TOR file (HTTP ${res.status}) from ${url}`);
  }

  const contentDisposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = contentDisposition.match(/filename=("?)([^";]+)\1/);
  const filename = filenameMatch ? filenameMatch[2] : `tor-${Date.now()}.${extensionFallback}`;

  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filename };
}
