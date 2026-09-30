import { XMLParser } from 'fast-xml-parser';
import { env } from '../config/env';
import { AnnounceType } from '../models/govSite.model';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

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

// For linkType === 'pdf' | 'zip' items. (An 'html' link is read by
// fetchHtmlDocument below instead -- it is text to read, not a file to store.)
// Generic over both since the download step itself (fetch +
// content-disposition filename parse) doesn't care what's inside.
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

// --- HTML announcement pages ------------------------------------------------
//
// An RSS item whose <link> is an 'html' page (confirmed live: every winner
// announcement, announce type W0, e.g. ".../procsearch.sch?...proc_id=
// ShowHTMLFile&projectId=...") is the announcement itself, and the only place
// its price is published -- so, by an explicit team decision that overrides the
// earlier "never fetch an HTML page" rule (and that host's robots.txt, which
// disallows all automated access), the app reads that ONE page.
//
// The scope is kept as narrow as that decision allows: only the exact URL the
// feed gives for the item is requested (nothing on the page is followed, no
// listing/search pages are ever touched), only on e-GP hosts, text only, paced
// well below the site's own rate limit, and the whole thing can be switched
// off with EGP_HTML_TOR_ENABLED=false.

const HTML_TIMEOUT_MS = 30_000;
const HTML_MAX_REDIRECTS = 5;
const HTML_MAX_BYTES = 2 * 1024 * 1024; // real pages are ~12 KB
const DEFAULT_HTML_MIN_GAP_MS = 1000;
// e-GP's pages declare charset=TIS-620 (Windows-874) -- the same Thai codepage
// as the RSS feed -- so that is what an undeclared page is assumed to be.
const DEFAULT_HTML_CHARSET = 'windows-874';

// The link comes out of a feed, so it must never become "fetch any URL a feed
// item names": http(s) only, and only e-GP's own hosts (or the host the RSS
// feed itself is configured on, which is what lets a local test server work).
export function isAllowedHtmlSource(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (host === 'gprocurement.go.th' || host.endsWith('.gprocurement.go.th')) return true;
  try {
    return host === new URL(env.EGP_RSS_BASE_URL).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function charsetFromContentType(header: string | null | undefined): string | null {
  const match = header?.match(/charset\s*=\s*["']?([^\s;"']+)/i);
  return match ? match[1] : null;
}

// <meta http-equiv="Content-Type" content="text/html; charset=TIS-620"> or
// <meta charset="...">. e-GP's pages have hundreds of blank lines before it.
function charsetFromMeta(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 8192).toString('latin1');
  const match = head.match(/<meta[^>]+charset\s*=\s*["']?([a-z0-9_\-]+)/i);
  return match ? match[1] : null;
}

// Decodes a fetched page using the charset it declares (header first, then a
// <meta> tag). Decoding a TIS-620 page as UTF-8 turns every Thai character into
// "�" and silently destroys "บาท", which is what the price scan anchors on.
export function decodeHtmlBytes(buffer: Buffer, contentType?: string | null): string {
  const label = charsetFromContentType(contentType) ?? charsetFromMeta(buffer) ?? DEFAULT_HTML_CHARSET;
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    // An encoding label Node doesn't know -- fall back to e-GP's own.
    return new TextDecoder(DEFAULT_HTML_CHARSET).decode(buffer);
  }
}

// Reads a response body but gives up as soon as it exceeds the cap, instead of
// buffering whatever the server chooses to send.
async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`HTML page is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Spaces HTML requests out: each one starts at least `minGapMs` after the
// previous one (the pipeline is sequential, so this is a simple next-free-slot).
let nextHtmlSlotAt = 0;
async function waitForHtmlSlot(minGapMs: number): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextHtmlSlotAt);
  nextHtmlSlotAt = startAt + minGapMs;
  if (startAt > now) await sleep(startAt - now);
}

/**
 * GETs one announcement page and returns it decoded to a string. Throws on
 * anything unexpected (disallowed host, HTTP error, oversize, timeout) --
 * the caller treats that as "no document" and the retry sweep tries again.
 */
export async function fetchHtmlDocument(url: string, options: { minGapMs?: number } = {}): Promise<string> {
  if (!isAllowedHtmlSource(url)) {
    throw new Error(`Refusing to fetch an HTML page from an unexpected address: ${url}`);
  }

  await waitForHtmlSlot(options.minGapMs ?? DEFAULT_HTML_MIN_GAP_MS);

  // Redirects are followed by hand (e-GP redirects http -> https), so every hop
  // is checked against the allow-list BEFORE it is requested -- letting fetch
  // follow them itself would already have contacted an unexpected host by the
  // time we could look at where it ended up.
  const signal = AbortSignal.timeout(HTML_TIMEOUT_MS);
  let currentUrl = url;
  let res: Response | null = null;
  for (let hop = 0; hop <= HTML_MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, {
      signal,
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'B2GVendor-ingestion/1.0 (public procurement announcements)' }
    });

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, currentUrl).toString();
      if (!isAllowedHtmlSource(next)) {
        throw new Error(`HTML page redirected to an unexpected address: ${next}`);
      }
      await response.body?.cancel().catch(() => undefined);
      currentUrl = next;
      continue;
    }

    res = response;
    break;
  }
  if (!res) throw new Error(`HTML page redirected more than ${HTML_MAX_REDIRECTS} times: ${url}`);

  if (!res.ok) {
    throw new Error(`HTML page returned HTTP ${res.status}: ${url}`);
  }

  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > HTML_MAX_BYTES) {
    throw new Error(`HTML page is larger than ${HTML_MAX_BYTES} bytes: ${url}`);
  }

  return decodeHtmlBytes(await readBodyCapped(res, HTML_MAX_BYTES), res.headers.get('content-type'));
}
