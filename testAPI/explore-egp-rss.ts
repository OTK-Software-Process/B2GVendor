/**
 * explore-egp-rss.ts
 *
 * Exploration script for the LIVE e-GP RSS feed — this is the essential,
 * real-time source for TOR/procurement announcements (as opposed to
 * data.go.th/opend, which is historical/batch and covered by
 * explore-api-data-go-th.ts).
 *
 *   GET https://process3.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml
 *       ?deptId={id}&anounceType={code}
 *
 * ---------------------------------------------------------------------------
 * FINDINGS (verified live on 2026-08-20)
 * ---------------------------------------------------------------------------
 *   - No API key needed. Plain GET, public.
 *   - Response is RSS 2.0 XML, but encoded as **Windows-874 (Thai codepage)**,
 *     NOT UTF-8 — despite the `<?xml ... encoding="Windows-874" ?>` being
 *     correct, decoding the response as UTF-8 (what fetch's `.text()` and
 *     most tools assume) produces mojibake. This script reads the raw
 *     ArrayBuffer and decodes with `TextDecoder('windows-874')` explicitly.
 *   - Calling with NO deptId returns the national feed (all agencies) for
 *     that announceType — confirmed live, ~599/day for D0 (invitation).
 *   - `deptId` genuinely filters when supplied — confirmed live against two
 *     real department codes found via web search (0304, 4520101): each
 *     returned a small, agency-specific result set instead of the national
 *     feed.
 *   - There is NO published master list of valid `deptId` values (the open
 *     risk called out for the estimate). If you're tracking a fixed
 *     watchlist of agencies, collect their deptId values manually (e.g. by
 *     watching the national feed's <link> URLs, or from each agency's own
 *     e-GP procurement pages) and hardcode them; national coverage requires
 *     someone to build that list first.
 *   - Per-item fields: title, link, description (CSV-style: "{projectId},
 *     {short description}, {announce type label}"), pubDate, guid (empty,
 *     not usable as a unique key).
 *   - IMPORTANT / corrects an earlier assumption: `<link>` is NOT
 *     consistently an HTML detail page. Confirmed live, it's one of two
 *     kinds, MIXED even within the same announceType and the same agency:
 *       (a) a DIRECT PDF DOWNLOAD —
 *           https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=...
 *           Confirmed via a real HEAD request: HTTP 200,
 *           `content-type: application/pdf`, and a
 *           `content-disposition: filename=dant_<projectId>_<uuid>.pdf`
 *           header — i.e. the TOR/announcement PDF itself, no further
 *           navigation needed. This is the good case.
 *       (b) an HTML detail page —
 *           http://process.gprocurement.go.th/egp2procmainWeb/jsp/procsearch.sch?...proc_id=ShowHTMLFile...projectId=...
 *           This is a page for a human to read, not an API; getting a PDF
 *           or status from here would mean scraping it, which this script
 *           deliberately does NOT do.
 *     This script classifies each item's link as 'pdf' | 'html' | 'other'
 *     and prints it, so you can see the real mix per query instead of
 *     assuming one behavior. `projectId` is parsed out of the link's query
 *     string when present (only case (b) has it in the URL — case (a) only
 *     has an opaque `templateId`, so the item's `description` field, which
 *     starts with the projectId, is the more reliable key across both).
 *   - NOT in the feed either way: budget/money, or a structured status
 *     field beyond the announce-type label (e.g. "ประกาศเชิญชวน" /
 *     "ประกาศรายชื่อผู้ชนะการเสนอราคา"). Money and richer status still need
 *     data.go.th/CGD (after award) or the HTML detail page (before award).
 *
 * Known `anounceType` codes (confirmed via docs found while researching):
 *   P0  procurement plan            (earliest possible signal)
 *   15  reference/central price
 *   B0  draft TOR                   (spec's "essential" minimum, with D0)
 *   D0  invitation to bid           (spec's "essential" minimum, with B0)
 *   W0  winner announcement         (useful "awarded" status signal)
 *   D1  cancellation
 *   W1  winner cancellation
 *   D2  modification/amendment
 *   W2  winner modification
 *
 * ---------------------------------------------------------------------------
 * SETUP / RUN
 * ---------------------------------------------------------------------------
 *   npm install   (only needed once, shared with explore-api-data-go-th.ts)
 *   npm run rss -- [deptId] [types]
 *
 *   Examples:
 *     npm run rss --                       # national feed, default types (B0,D0)
 *     npm run rss -- 4520101                # one agency, default types (B0,D0)
 *     npm run rss -- 4520101 B0,D0,D1,D2,W0 # one agency, custom type list
 *     npm run rss -- ALL P0                 # national feed, just procurement plans
 *
 *   `deptId` accepts a real code, or the literal `ALL` (or omit it) for the
 *   unfiltered national feed.
 */

const BASE_URL = 'https://process3.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml';
const DEFAULT_TYPES = ['B0', 'D0'];

const TYPE_LABELS: Record<string, string> = {
  P0: 'Procurement plan',
  '15': 'Reference/central price',
  B0: 'Draft TOR',
  D0: 'Invitation to bid',
  W0: 'Winner announcement',
  D1: 'Cancellation',
  W1: 'Winner cancellation',
  D2: 'Modification/amendment',
  W2: 'Winner modification'
};

type LinkType = 'pdf' | 'html' | 'other';

interface RssItem {
  title: string;
  link: string;
  linkType: LinkType;
  description: string;
  pubDate: string;
  projectId: string | null;
}

function classifyLink(link: string): LinkType {
  if (link.includes('/egp-template-service/dwnt/view-pdf-file')) return 'pdf';
  if (link.includes('ShowHTMLFile')) return 'html';
  return 'other';
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1]) : '';
}

// Lightweight, dependency-free RSS <item> parser — good enough for
// exploration; swap for a real XML parser (e.g. fast-xml-parser) in the
// real backend for robustness against malformed/edge-case feeds.
function parseItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const link = extractTag(block, 'link');
    const description = extractTag(block, 'description');
    // projectId is only present in the link's query string for HTML-detail
    // links; PDF links only carry an opaque templateId. The description
    // field ("{projectId}, ...") is reliable for both, so prefer it.
    const projectIdMatch = description.match(/^(\d+),/) ?? link.match(/projectId=(\d+)/);
    items.push({
      title: extractTag(block, 'title'),
      link,
      linkType: classifyLink(link),
      description,
      pubDate: extractTag(block, 'pubDate'),
      projectId: projectIdMatch ? projectIdMatch[1] : null
    });
  }
  return items;
}

async function fetchFeed(deptId: string | null, anounceType: string): Promise<{ xml: string; items: RssItem[]; countByDay: string | null }> {
  const url = new URL(BASE_URL);
  if (deptId) url.searchParams.set('deptId', deptId);
  url.searchParams.set('anounceType', anounceType);

  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  // The feed declares Windows-874 encoding and really is Windows-874 —
  // decoding as UTF-8 (the fetch default) garbles every Thai character.
  const xml = new TextDecoder('windows-874').decode(buf);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const countMatch = xml.match(/<countbyday>(\d+)<\/countbyday>/);
  return { xml, items: parseItems(xml), countByDay: countMatch ? countMatch[1] : null };
}

async function main(): Promise<void> {
  const [, , rawDeptId, rawTypes] = process.argv;
  const deptId = !rawDeptId || rawDeptId.toUpperCase() === 'ALL' ? null : rawDeptId;
  const types = (rawTypes ?? DEFAULT_TYPES.join(',')).split(',').map(t => t.trim()).filter(Boolean);

  console.log(`\n=== e-GP RSS feed: deptId=${deptId ?? '(none — national feed)'}  types=${types.join(', ')} ===\n`);

  for (const type of types) {
    try {
      const { items, countByDay } = await fetchFeed(deptId, type);
      const label = TYPE_LABELS[type] ?? '(unknown type — check the code)';
      const pdfCount = items.filter(i => i.linkType === 'pdf').length;
      const htmlCount = items.filter(i => i.linkType === 'html').length;
      console.log(`--- ${type} (${label}) — ${items.length} item(s), countbyday=${countByDay ?? '?'}  [${pdfCount} direct PDF, ${htmlCount} HTML page] ---`);
      for (const item of items.slice(0, 5)) {
        console.log(`  [${item.pubDate}] projectId=${item.projectId ?? '?'}  link=${item.linkType.toUpperCase()}  ${item.title}`);
        console.log(`      ${item.description}`);
        console.log(`      ${item.link}`);
      }
      if (items.length > 5) console.log(`  ... and ${items.length - 5} more`);
      console.log();
    } catch (err) {
      console.error(`  [error] ${type}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    'Reminder: link type is mixed per item (see counts above) — "PDF" items are ready to download\n' +
    'as-is; "HTML" items point to a human detail page and would need scraping to go further, which\n' +
    'this script deliberately does not do. Neither kind carries budget/money or a structured status\n' +
    'field beyond the announce-type label.'
  );
}

main().catch(err => {
  console.error('\n[fatal]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
