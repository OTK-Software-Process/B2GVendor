/**
 * explore-api-data-go-th.ts
 *
 * Exploration script for Thailand's open government data platform
 * (data.go.th), built to answer three questions before we design the real
 * N1 ingestion backend:
 *
 *   1. What does the API actually return (response shape, field types)?
 *   2. How many government sites/agencies can we pull TOR/procurement data
 *      from, and are they really 7 separate integrations or one shared one?
 *   3. What does a real integration call look like (base URL, auth header,
 *      params) so we can carry it over into the Node backend later?
 *
 * ---------------------------------------------------------------------------
 * FINDINGS (verified live against the real API on 2026-08-19)
 * ---------------------------------------------------------------------------
 *   - The real, working host is **data.go.th** — not api.data.go.th.
 *     api.data.go.th only serves the human-facing registration/portal page
 *     (HTML), not the JSON API. data.go.th is CKAN-based, so its "Action
 *     API" is mounted at `/api/3/action/<action_name>` — that's what this
 *     script calls.
 *   - Public reads (organization_show, package_search, datastore_search)
 *     worked in testing WITHOUT an API key. Keep API_DATA_GO_TH_KEY set
 *     anyway — some resources/rate limits may require it — but don't be
 *     surprised if the free reads succeed with an empty key.
 *   - `organization_list` is unreliable: it returned only 25 organizations
 *     total, silently omitting ones that clearly have datasets (confirmed
 *     via package_search facets returning 500+ orgs). Don't use
 *     organization_list to enumerate agencies — use organization_show with
 *     a known slug, or package_search's `organization` facet, instead.
 *   - All 7 government sites from the spec ARE on the catalog, confirmed by
 *     resolving their exact org slugs via organization_show:
 *       bangkok_metropolitan_administration (BMA)   — 1384 datasets
 *       doh                                  (DOH)  —   41 datasets
 *       pea                                  (PEA)  —  181 datasets
 *       egat                                 (EGAT) —   22 datasets
 *       office-moph                          (MOPH) —   90 datasets
 *       depa                                 (depa) —   12 datasets
 *       dga                                  (DGA)  —   74 datasets
 *   - There is also a CENTRAL organization, **cgd** (กรมบัญชีกลาง — the
 *     Comptroller General's Department, which runs the actual e-GP system
 *     at process.gprocurement.go.th that every agency posts through): 116
 *     datasets, 97 of them procurement-related. This is the one to check
 *     first for a "single integration instead of 7" architecture — see the
 *     `cgd` command.
 *   - IMPORTANT: CGD's procurement datasets are PERIODIC BATCH DROPS (one
 *     dataset per month/fiscal year, each holding CSV + ZIP resources named
 *     after that period), not a single live, filterable REST endpoint. A
 *     real poller against CGD means "detect + download the newest
 *     month's/year's CSV," not "GET with a date-range query param." Budget
 *     the backend design accordingly.
 *   - A guessed direct endpoint (opend.data.go.th/govspending/cgdcontract),
 *     found via a search-engine snippet before live testing, turned out to
 *     be dead (404, different site entirely) once actually called. Left out
 *     of this version — lesson: always verify via `search`/`site`, don't
 *     trust a URL until you've called it.
 *   - The CGD contract table supports server-side filtering by winner TIN
 *     (`datastore_search`'s `filters` param, e.g. `{"win_tin":"..."}`) —
 *     confirmed live: filtering a 25,250-record resource down to one
 *     winner's 8 contracts. Useful for competitor analysis. See `winner`.
 *   - There's also a CGD-published agency name/code lookup dataset
 *     (`cgd_egp_01`, "หน่วยงานที่ดำเนินการจัดซื้อจัดจ้าง" — literally "which
 *     agencies use e-GP"), one resource per fiscal year. It is NOT
 *     DataStore-backed (datastore_search 404s on it) — it's a plain CSV/XLSX
 *     file download hosted on catalog.cgd.go.th. See `departments`.
 *
 * There is a SEPARATE, more important source for live TOR data: the e-GP RSS
 * feed at process3.gprocurement.go.th — see explore-egp-rss.ts in this same
 * folder. This script (data.go.th/opend) only covers the historical/batch
 * side (CGDContract-equivalent + the agency lookup); it cannot deliver TORs
 * at all, since it only knows about projects after they've been awarded.
 *
 * NOT independently confirmed — verify once you have a real API key and can
 * see your dashboard's auto-generated sample code:
 *   - The exact HTTP header name api.data.go.th expects when a key IS
 *     required (CKAN's own default is `Authorization: <key>`; some CKAN
 *     configs use `X-CKAN-API-Key`). This script sends both — trim to
 *     whichever one your dashboard shows, then delete the other.
 *
 * ---------------------------------------------------------------------------
 * SETUP
 * ---------------------------------------------------------------------------
 * 1. Register at https://opend.data.go.th/register_api/ (or api.data.go.th)
 *    and copy your API key. (Public reads worked without one in testing —
 *    register anyway so you're covered for anything that does require it.)
 * 2. Create a `.env` file next to this script (copy .env.example):
 *        API_DATA_GO_TH_KEY=your-key-here
 *    Loaded automatically by this script (see loadDotEnv() below) — no
 *    dotenv package, no --env-file flag needed.
 * 3. Install once, then run via the npm script:
 *        npm install
 *        npm run explore -- orgs
 *        npm run explore -- site pea
 *        npm run explore -- search "จัดซื้อจัดจ้าง"
 *        npm run explore -- resource <resource_id from a search/site result>
 *        npm run explore -- cgd
 *    (Or directly: npx tsx explore-api-data-go-th.ts <command>)
 *    (Requires Node 18+ for global fetch.)
 *
 * ---------------------------------------------------------------------------
 * COMMANDS
 * ---------------------------------------------------------------------------
 *   orgs                 Resolve all 7 target government sites + CGD by
 *                        their confirmed org slugs and print dataset
 *                        counts.                                          (Q2)
 *   site <slug>          Show one organization's details and list its
 *                        datasets/resources (e.g. `site pea`, `site cgd`,
 *                        `site bangkok_metropolitan_administration`).      (Q1/Q2)
 *   search [keyword]     Full-text search datasets for a keyword (defaults
 *                        to "จัดซื้อจัดจ้าง" = procurement). Prints title,
 *                        organization, and resource list per match.        (Q1/Q2)
 *   resource <id>        datastore_search a specific tabular resource:
 *                        prints its field schema + a few sample records.  (Q1)
 *   cgd                  Lists CGD's (the central e-GP authority) own
 *                        procurement datasets, to gauge whether one
 *                        integration can cover all agencies.           (Q2/Q3)
 *   winner <tin>          Filter the CGD contract table by winner TIN
 *                        (competitor analysis).                           (Q1)
 *   departments [year]    Resolve CGD's agency name/code lookup dataset for
 *                        a fiscal year (default 2566) and print its
 *                        download URL + a schema probe.                (Q2/Q3)
 */

// Load .env variables (API key, optional CKAN base URL) — no external
// dependency (no "dotenv" package needed): reads .env next to this file and
// populates process.env for any key not already set in the real environment.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadDotEnv(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const CKAN_BASE = process.env.CKAN_BASE_URL ?? 'https://data.go.th';
const API_KEY = process.env.API_DATA_GO_TH_KEY ?? '';

// Confirmed org slugs for the 7 government sites named in the project spec,
// resolved live via organization_show on 2026-08-19.
const TARGET_SITES: { label: string; slug: string }[] = [
  { label: 'BMA', slug: 'bangkok_metropolitan_administration' },
  { label: 'Department of Highways (DOH)', slug: 'doh' },
  { label: 'PEA', slug: 'pea' },
  { label: 'EGAT', slug: 'egat' },
  { label: 'MOPH (Office of the Permanent Secretary)', slug: 'office-moph' },
  { label: 'depa', slug: 'depa' },
  { label: 'DGA', slug: 'dga' }
];

const CGD_SLUG = 'cgd'; // Comptroller General's Department — runs e-GP for everyone

// A CGDContract-style resource confirmed to be DataStore-backed (queryable),
// found via `search`/`cgd` — used by the `winner` command. This specific
// resource id may age out as CGD publishes new periods; if it 404s, run
// `cgd` again to find a current one and pass it via CGD_CONTRACT_RESOURCE_ID.
const CGD_CONTRACT_RESOURCE_ID = process.env.CGD_CONTRACT_RESOURCE_ID ?? '2532b3a6-df25-4f4f-90f8-eb308b86229e';

// The CGD agency name/code lookup dataset ("หน่วยงานที่ดำเนินการจัดซื้อจัดจ้าง"
// — which agencies use e-GP), one resource per fiscal year (Buddhist Era).
const CGD_DEPARTMENTS_DATASET = 'cgd_egp_01';

function requireApiKey(): void {
  if (!API_KEY) {
    console.warn(
      '[warn] API_DATA_GO_TH_KEY is not set. Public catalog reads (orgs/site/search/resource)\n' +
      '       worked without a key in testing, but set one anyway from\n' +
      '       https://opend.data.go.th/register_api/ in case a resource requires it.\n'
    );
  }
}

function authHeaders(): Record<string, string> {
  if (!API_KEY) return {};
  // Sent both ways since the exact header name isn't independently confirmed
  // for this portal — see the header comment above. Trim to the one that
  // actually works once you've tested against your own key.
  return {
    Authorization: API_KEY,
    'API-KEY': API_KEY
  };
}

async function ckanAction<T = unknown>(action: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${CKAN_BASE}/api/3/action/${action}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url} (HTTP ${res.status}):\n${text.slice(0, 500)}`);
  }

  if (!res.ok || json.success === false) {
    throw new Error(`CKAN action "${action}" failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`);
  }
  return json.result as T;
}

interface CkanOrganization {
  name: string;
  title: string;
  package_count?: number;
}

interface CkanResource {
  id: string;
  name: string;
  format: string;
  url: string;
}

interface CkanPackage {
  name: string;
  title: string;
  organization: { title: string } | null;
  resources: CkanResource[];
}

async function cmdOrgs(): Promise<void> {
  console.log(`\n=== Confirmed coverage of the 7 target government sites on ${CKAN_BASE} ===\n`);

  for (const site of TARGET_SITES) {
    try {
      const org = await ckanAction<CkanOrganization>('organization_show', { id: site.slug });
      console.log(`✓ ${site.label.padEnd(40)} slug="${site.slug}"  title="${org.title}"  datasets=${org.package_count}`);
    } catch (err) {
      console.log(`✗ ${site.label.padEnd(40)} slug="${site.slug}"  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n--- Central authority (all agencies post through this one) ---\n`);
  const cgd = await ckanAction<CkanOrganization>('organization_show', { id: CGD_SLUG });
  console.log(`  ${CGD_SLUG}  title="${cgd.title}"  datasets=${cgd.package_count}`);

  console.log(
    '\nRun `npm run explore -- cgd` to see whether CGD\'s own datasets already cover procurement\n' +
    'across all agencies, which would mean one poller instead of 7 separate site adapters.\n'
  );
}

async function cmdSite(slug: string): Promise<void> {
  console.log(`\n=== Organization: ${slug} on ${CKAN_BASE} ===\n`);
  const org = await ckanAction<CkanOrganization>('organization_show', { id: slug });
  console.log(`Title: ${org.title}\nTotal datasets: ${org.package_count}\n`);

  const result = await ckanAction<{ count: number; results: CkanPackage[] }>('package_search', {
    fq: `organization:${slug}`,
    rows: '15'
  });
  console.log(`Showing ${result.results.length} of ${result.count} datasets:\n`);
  for (const pkg of result.results) {
    console.log(`- ${pkg.title}`);
    for (const r of pkg.resources) {
      console.log(`    resource: ${r.name || '(unnamed)'}  format=${r.format}  id=${r.id}`);
    }
  }
}

async function cmdSearch(keyword: string): Promise<void> {
  console.log(`\n=== package_search: "${keyword}" on ${CKAN_BASE} ===\n`);
  const result = await ckanAction<{ count: number; results: CkanPackage[] }>('package_search', {
    q: keyword,
    rows: '50'
  });

  console.log(`Total matching datasets: ${result.count}\n`);
  for (const pkg of result.results) {
    console.log(`- ${pkg.title}  [org: ${pkg.organization?.title ?? 'unknown'}]`);
    for (const r of pkg.resources) {
      console.log(`    resource: ${r.name || '(unnamed)'}  format=${r.format}  id=${r.id}`);
    }
  }

  if (result.results.length === 0) {
    console.log('No matches — try another keyword, e.g. "TOR", "ประกวดราคา", "e-GP", or an agency name.');
  }
}

async function cmdResource(resourceId: string): Promise<void> {
  console.log(`\n=== datastore_search: resource ${resourceId} ===\n`);
  const result = await ckanAction<{
    fields: { id: string; type: string }[];
    records: Record<string, unknown>[];
    total: number;
  }>('datastore_search', { resource_id: resourceId, limit: '3' });

  console.log(`Total records in this resource: ${result.total}\n`);
  console.log('Field schema (this is the "data structure" answer for this resource):');
  console.table(result.fields);

  console.log('\nSample records:');
  console.log(JSON.stringify(result.records, null, 2));

  console.log(
    '\n[note] Not every resource is a queryable DataStore table — some are plain file downloads\n' +
    '(CSV/ZIP/PDF on disk). If this errors with "not found", the resource likely isn\'t backed by\n' +
    'the DataStore; download the file directly from its `url` (see `search`/`site` output) instead.'
  );
}

async function cmdCgd(): Promise<void> {
  console.log(`\n=== CGD (กรมบัญชีกลาง) procurement datasets — the central e-GP authority ===\n`);
  console.log('CGD runs process.gprocurement.go.th, the e-GP system every government agency posts');
  console.log('through (including all 7 target sites). If this covers everyone, the backend may need');
  console.log('ONE poller against CGD (filtered by agency) instead of 7 separate site adapters.\n');

  const result = await ckanAction<{ count: number; results: CkanPackage[] }>('package_search', {
    fq: `organization:${CGD_SLUG}`,
    q: 'จัดซื้อจัดจ้าง',
    rows: '10'
  });

  console.log(`CGD procurement-related datasets: ${result.count} (showing ${result.results.length})\n`);
  for (const pkg of result.results) {
    console.log(`- ${pkg.title}`);
    for (const r of pkg.resources) {
      console.log(`    resource: ${r.name || '(unnamed)'}  format=${r.format}  id=${r.id}`);
    }
  }

  console.log(
    '\n[architecture note] These are typically ONE DATASET PER MONTH/FISCAL YEAR, each holding\n' +
    'CSV/ZIP resources named after that period — a periodic batch drop, not a single live,\n' +
    'filterable REST endpoint. A real poller here means "detect the newest period\'s dataset and\n' +
    'download its CSV," not "GET with a date-range query param." Run `resource <id>` on one of the\n' +
    'CSV resource ids above (if it\'s DataStore-backed) to inspect its actual column structure.'
  );
}

async function cmdWinner(tin: string): Promise<void> {
  console.log(`\n=== CGD contract records for winner TIN "${tin}" (resource ${CGD_CONTRACT_RESOURCE_ID}) ===\n`);
  const result = await ckanAction<{
    total: number;
    records: Record<string, unknown>[];
  }>('datastore_search', {
    resource_id: CGD_CONTRACT_RESOURCE_ID,
    filters: JSON.stringify({ win_tin: tin })
  });

  console.log(`Total contracts won by this TIN (in this one resource/period): ${result.total}\n`);
  console.log(JSON.stringify(result.records, null, 2));

  if (result.total === 0) {
    console.log(
      '\nNo matches. This only searches ONE period\'s resource (see CGD_CONTRACT_RESOURCE_ID above) —\n' +
      'run `cgd` to find other periods\' resource ids and pass one via the CGD_CONTRACT_RESOURCE_ID\n' +
      'env var to search a different month/year, or grab a real win_tin via `resource <id>` first.'
    );
  }
}

async function cmdDepartments(year: string): Promise<void> {
  console.log(`\n=== CGD agency (e-GP department) lookup for FY ${year}: dataset "${CGD_DEPARTMENTS_DATASET}" ===\n`);

  const pkg = await ckanAction<CkanPackage>('package_show', { id: CGD_DEPARTMENTS_DATASET });
  const resource = pkg.resources.find(r => r.name.includes(year) && r.format === 'CSV');

  if (!resource) {
    console.log(`No CSV resource found for ${year}. Available resources:`);
    for (const r of pkg.resources) console.log(`  - ${r.name}  format=${r.format}  id=${r.id}`);
    return;
  }

  console.log(`Resource: ${resource.name}\nDirect download URL: ${resource.url}\n`);

  try {
    const probe = await ckanAction<{ fields: { id: string; type: string }[] }>('datastore_search', {
      resource_id: resource.id,
      limit: '1'
    });
    console.log('DataStore-backed — field schema:');
    console.table(probe.fields);
  } catch {
    console.log(
      '[note] Not DataStore-backed (confirmed on the 2565/2566 resources during testing) — this is a\n' +
      'plain CSV file download, not a queryable table. Fetching it directly to preview columns...\n'
    );
    try {
      const res = await fetch(resource.url);
      const buf = await res.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        text = new TextDecoder('windows-874').decode(buf);
      }
      console.log(text.split('\n').slice(0, 5).join('\n'));
    } catch (err) {
      console.log(
        `[warn] Could not fetch ${resource.url} directly (${err instanceof Error ? err.message : err}).\n` +
        'Some sandboxed/restricted networks can\'t reach catalog.cgd.go.th even though data.go.th\n' +
        'works — try this from an unrestricted network, or open the URL in a browser.'
      );
    }
  }
}

async function main(): Promise<void> {
  requireApiKey();
  const [, , cmd, ...rest] = process.argv;

  try {
    switch (cmd) {
      case 'orgs':
        await cmdOrgs();
        break;
      case 'site':
        if (!rest[0]) throw new Error('Usage: site <org_slug>  (e.g. site pea, site cgd)');
        await cmdSite(rest[0]);
        break;
      case 'search':
        await cmdSearch(rest.join(' ') || 'จัดซื้อจัดจ้าง');
        break;
      case 'resource':
        if (!rest[0]) throw new Error('Usage: resource <resource_id>');
        await cmdResource(rest[0]);
        break;
      case 'cgd':
        await cmdCgd();
        break;
      case 'winner':
        if (!rest[0]) throw new Error('Usage: winner <tin>');
        await cmdWinner(rest[0]);
        break;
      case 'departments':
        await cmdDepartments(rest[0] || '2566');
        break;
      default:
        console.log(
          'Usage:\n' +
          '  npm run explore -- orgs\n' +
          '  npm run explore -- site <org_slug>       (e.g. site pea, site cgd)\n' +
          '  npm run explore -- search [keyword]\n' +
          '  npm run explore -- resource <resource_id>\n' +
          '  npm run explore -- cgd\n' +
          '  npm run explore -- winner <tin>\n' +
          '  npm run explore -- departments [year]    (default 2566)\n'
        );
    }
  } catch (err) {
    console.error('\n[error]', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();
