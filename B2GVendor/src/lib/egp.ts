// Links from a work back to e-GP, the government's own procurement site, so a
// vendor reading our copy of a TOR can find the original announcement.
//
// Two kinds of link, both taking the work's e-GP project number (`projectId`):
//
//  1. egpSearchUrl -- the e-GP announcement SEARCH page, with the project number
//     as the keyword. Works for every work, whatever its announcement type (a
//     draft TOR, an invitation, a winner announcement all have a project number).
//     This replaced a link BUILT to a single e-GP2 announcement page
//     (…/egp2procmainWeb/…?templateType=D2&seqNo=0), which did not open: its
//     templateType/seqNo are per-announcement values we can only know from the
//     feed, never derive from the project number.
//
//  2. egp2PageLinks -- the exact e-GP2 announcement page(s) the feed gave us for
//     this work (`html` TOR links). Nothing is ever built here, so only links
//     that e-GP itself published are offered. The feed's pages are
//     per-announcement: winner pages use seqNo 1, 2 or 3 (a project with several
//     winner announcements has one page each), so every distinct one is returned.

export interface EgpPageLink {
  url: string;
  templateType: string;
  seqNo: number;
}

export interface EgpLinkSource {
  projectId: string;
  torFiles: { linkType: string; sourceUrl: string }[];
}

const EGP_SEARCH_ORIGIN = 'https://process5.gprocurement.go.th';
const EGP_SEARCH_PATH = '/egp-agpc01-web/announcement';

// Shown next to the button so the vendor knows WHICH announcement it opens.
const TEMPLATE_LABEL: Record<string, { th: string; en: string }> = {
  W2: { th: 'ประกาศผู้ชนะการเสนอราคา', en: 'Winner announcement' },
  D2: { th: 'ประกาศเชิญชวน', en: 'Invitation' }
};

// A project number goes straight into a URL, so it must be plain digits.
export function isProjectNumber(projectId: string | undefined | null): projectId is string {
  return !!projectId && /^\d{6,20}$/.test(projectId);
}

/** The e-GP announcement search page, filtered to this project number. null for a malformed number. */
export function egpSearchUrl(projectId: string | undefined | null): string | null {
  if (!isProjectNumber(projectId)) return null;
  const url = new URL(EGP_SEARCH_PATH, EGP_SEARCH_ORIGIN);
  url.searchParams.set('keywordSearch', projectId);
  url.searchParams.set('advancedSearch', 'true');
  return url.toString();
}

function isEgpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'gprocurement.go.th' || host.endsWith('.gprocurement.go.th');
}

// The feed's own e-GP2 link for this work, or null when `raw` is anything else
// (a PDF, another host, another project, a non-http scheme).
function parseFeedLink(raw: string, projectId: string): EgpPageLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isEgpHost(url.hostname) || !url.pathname.startsWith('/egp2procmainWeb/')) return null;
  if (url.searchParams.get('projectId') !== projectId) return null;

  const seqNo = Number(url.searchParams.get('seqNo'));
  return {
    url: url.toString(),
    templateType: url.searchParams.get('templateType') ?? '',
    seqNo: Number.isFinite(seqNo) ? seqNo : 0
  };
}

/**
 * The e-GP2 announcement pages e-GP itself linked for this work: every distinct
 * one, ordered by seqNo, at most five. Empty when the feed gave none.
 */
export function egp2PageLinks(work: EgpLinkSource): EgpPageLink[] {
  const seen = new Set<string>();
  const links: EgpPageLink[] = [];
  for (const file of work.torFiles) {
    if (file.linkType !== 'html') continue;
    const link = parseFeedLink(file.sourceUrl, work.projectId);
    if (link && !seen.has(link.url)) {
      seen.add(link.url);
      links.push(link);
    }
  }
  return links.sort((a, b) => a.seqNo - b.seqNo).slice(0, 5);
}

/** "ประกาศผู้ชนะการเสนอราคา" / "Winner announcement" -- empty for a template we have no name for. */
export function egpTemplateLabel(templateType: string, lang: 'th' | 'en'): string {
  return TEMPLATE_LABEL[templateType]?.[lang] ?? '';
}
