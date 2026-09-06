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
