import { env } from '../config/env';

/**
 * Client for data.go.th -- the SECONDARY, historical/batch enrichment
 * source (see ProjectDescription.md N1). Ported from
 * testAPI/explore-api-data-go-th.ts. Confirmed live findings this client
 * relies on:
 *   - The real, working host is data.go.th (CKAN-based Action API at
 *     /api/3/action/<action>) -- NOT api.data.go.th, which is only the
 *     human sign-up portal page.
 *   - Public reads worked without an API key in testing; still send one if
 *     configured, since the exact header this portal expects when a key IS
 *     required was never independently confirmed (send both plausible
 *     header names, per the exploration script's own caveat).
 *   - CGD's contract datasets are periodic batch drops (one per fiscal
 *     period), not a single live filterable endpoint -- this client fetches
 *     whatever resource id a GovSite is configured with; picking the
 *     *current* period's resource id is an admin/config concern, not
 *     something this client guesses at.
 */

interface CkanEnvelope<T> {
  success: boolean;
  result?: T;
  error?: unknown;
}

function authHeaders(): Record<string, string> {
  if (!env.DATA_GO_TH_API_KEY) return {};
  return {
    Authorization: env.DATA_GO_TH_API_KEY,
    'API-KEY': env.DATA_GO_TH_API_KEY
  };
}

async function ckanAction<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${env.DATA_GO_TH_BASE_URL}/api/3/action/${action}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();

  let json: CkanEnvelope<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from data.go.th (HTTP ${res.status}) for action "${action}"`);
  }

  if (!res.ok || json.success === false) {
    throw new Error(`data.go.th action "${action}" failed (HTTP ${res.status}): ${JSON.stringify(json.error ?? json)}`);
  }
  return json.result as T;
}

export interface CkanOrganization {
  name: string;
  title: string;
  package_count?: number;
}

export async function organizationShow(slug: string): Promise<CkanOrganization> {
  return ckanAction<CkanOrganization>('organization_show', { id: slug });
}

export interface CkanDatastoreField {
  id: string;
  type: string;
}

export interface CkanDatastoreResult {
  total: number;
  fields: CkanDatastoreField[];
  records: Record<string, unknown>[];
}

export interface DatastoreSearchOptions {
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export async function datastoreSearch(
  resourceId: string,
  options: DatastoreSearchOptions = {}
): Promise<CkanDatastoreResult> {
  const params: Record<string, string> = { resource_id: resourceId };
  if (options.filters) params.filters = JSON.stringify(options.filters);
  if (options.limit) params.limit = String(options.limit);
  if (options.offset) params.offset = String(options.offset);

  return ckanAction<CkanDatastoreResult>('datastore_search', params);
}

// A package (CKAN's name for a dataset) is a set of resources. package_show
// is how a resource_id gets (re-)discovered for a known package name,
// instead of an admin having to hunt down and hardcode a raw UUID by hand --
// see dataGoThResource.service.ts for the resolution logic built on top of
// this and package_search below.
//
// CONFIRMED LIVE (2026-09-14, resource 2532b3a6-df25-4f4f-90f8-eb308b86229e
// from seedGovSites.ts): CGD's actual procurement/contract data is published
// as ONE PACKAGE PER FISCAL PERIOD (a half-month batch, in the case
// checked), not one stable package holding several dated resources -- e.g.
// package f4bb87b0-1282-4263-87d1-2992c93dc704 ("...เดือนเมษายน 2561 (ครึ่ง
// เดือนแรก)") holds exactly that period's "<date>_contract" +
// "<date>_project_location" resources. So a single pinned dataGoThPackageId
// is NOT enough by itself to track period rollovers for this dataset --
// package_search (below), not just package_show, is needed to find the
// newest matching package first. Also confirmed live: that contract
// resource's fields are proj_no/proj_name/subdep_name/proj_mny/contrct_price/
// corp_name/win_tin/contrct_num/contrct_date -- there is NO deptId or
// agency-code column, only subdep_name (a free-text Thai sub-department
// name). This dataset cannot answer the "map agency to e-GP deptId" open
// risk (ProjectDescription.md N1) -- that remains unsolved/manual.
export interface CkanResource {
  id: string;
  name: string;
  format?: string;
  // Present on resources actually queryable via datastore_search; CKAN omits
  // it entirely on some instances, so treat "missing" as "unknown", not "no".
  datastore_active?: boolean;
  created?: string;
  last_modified?: string;
  url?: string;
}

export interface CkanPackage {
  id: string;
  name: string;
  title: string;
  organization?: { name: string; title: string };
  metadata_created?: string;
  resources: CkanResource[];
}

export async function packageShow(packageId: string): Promise<CkanPackage> {
  return ckanAction<CkanPackage>('package_show', { id: packageId });
}

export interface PackageSearchOptions {
  query?: string; // raw CKAN Solr `q`, e.g. 'organization:cgd title:สัญญา'
  rows?: number;
  sort?: string; // e.g. 'metadata_created desc' -- newest package first
}

export interface PackageSearchResult {
  count: number;
  results: CkanPackage[];
}

export async function packageSearch(options: PackageSearchOptions = {}): Promise<PackageSearchResult> {
  const params: Record<string, string> = {};
  if (options.query) params.q = options.query;
  if (options.rows) params.rows = String(options.rows);
  if (options.sort) params.sort = options.sort;

  return ckanAction<PackageSearchResult>('package_search', params);
}
