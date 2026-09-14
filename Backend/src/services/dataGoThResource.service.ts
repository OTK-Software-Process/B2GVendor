import { IGovSite } from '../models/govSite.model';
import { packageShow, packageSearch, CkanPackage, CkanResource } from '../integrations/dataGoTh.client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Picks the best datastore-backed resource out of a package's resource list.
//
// Confirmed live against a real CGD contract package (see dataGoTh.client.ts
// header comment): a period's package can bundle sibling resources that are
// ALL datastore_active (e.g. "<date>_contract" next to
// "<date>_project_location", created seconds apart) -- enrichWorkFromContractRecord
// (ingestion.service.ts) only understands the contract shape
// (proj_no/contrct_price/corp_name/win_tin), so when more than one candidate
// is name-tagged "contract" that's preferred outright over a same-day
// tiebreak; otherwise fall back to most recently created/modified.
function pickLatestResource(resources: CkanResource[]): CkanResource | null {
  if (resources.length === 0) return null;

  const active = resources.filter(r => r.datastore_active === true);
  let candidates = active.length > 0 ? active : resources;

  const contractNamed = candidates.filter(r => /contract/i.test(r.name));
  if (contractNamed.length > 0) candidates = contractNamed;

  return candidates.reduce((latest, r) => {
    const latestDate = latest.last_modified ?? latest.created ?? '';
    const rDate = r.last_modified ?? r.created ?? '';
    return rDate > latestDate ? r : latest;
  }, candidates[0]);
}

async function resolveViaPackageId(packageId: string, site: IGovSite): Promise<string | null> {
  try {
    const pkg = await packageShow(packageId);
    const resource = pickLatestResource(pkg.resources);
    if (!resource) {
      logger.warn('dataGoThResource', `package "${packageId}" has no resources to resolve for ${site.shortCode}`);
      return null;
    }
    return resource.id;
  } catch (err) {
    logger.warn('dataGoThResource', `Failed to resolve a resource_id from package "${packageId}" for ${site.shortCode}`, err);
    return null;
  }
}

// For datasets published as one PACKAGE per fiscal period (confirmed live --
// see dataGoTh.client.ts) rather than one package with many dated resources,
// a fixed package id can't track the rollover by itself: this finds the
// newest package matching a CKAN search query first, then resolves a
// resource inside THAT package the same way.
//
// Caveat, confirmed live and worth stating plainly: "newest" here means
// sorted by CKAN's metadata_created, which is when the package was catalogued
// on data.go.th -- NOT necessarily the period it actually covers. A live
// query for 89 CGD procurement-report packages showed many distinct
// half-month periods sharing the exact same metadata_created timestamp
// (bulk-imported together), so this is a best-effort heuristic, not a
// guarantee of picking the true latest fiscal period -- an admin should
// still spot-check resolvedResourceId in run history occasionally rather
// than assume this is infallible.
async function resolveViaSearchQuery(searchQuery: string, site: IGovSite): Promise<string | null> {
  try {
    const { results } = await packageSearch({ query: searchQuery, rows: 1, sort: 'metadata_created desc' });
    const pkg: CkanPackage | undefined = results[0];
    if (!pkg) {
      logger.warn('dataGoThResource', `package_search "${searchQuery}" returned no packages for ${site.shortCode}`);
      return null;
    }
    const resource = pickLatestResource(pkg.resources);
    if (!resource) {
      logger.warn('dataGoThResource', `Newest package "${pkg.id}" for query "${searchQuery}" has no resources (site ${site.shortCode})`);
      return null;
    }
    return resource.id;
  } catch (err) {
    logger.warn('dataGoThResource', `package_search "${searchQuery}" failed for ${site.shortCode}`, err);
    return null;
  }
}

/**
 * Resolves the resource_id runDataGoThEnrichment (ingestion.service.ts)
 * should pass to datastore_search for a given site, trying each configured
 * path in order and falling through on failure (never throws):
 *
 *   1. site.dataGoThResourceId -- a manual pin. Always wins outright when
 *      set; the only path that existed before this.
 *   2. site.dataGoThPackageId (or the shared DATA_GO_TH_DEFAULT_PACKAGE_ID)
 *      -- resolved via package_show, picking the current resource out of
 *      that package. Fits a dataset published as one package with several
 *      dated resources inside it (e.g. cgd_egp_01).
 *   3. site.dataGoThSearchQuery (or the shared
 *      DATA_GO_TH_DEFAULT_SEARCH_QUERY) -- resolved via package_search for
 *      the newest matching PACKAGE, then a resource inside it. Fits a
 *      dataset published as one new package per period (confirmed live to
 *      be how CGD's actual contract data works -- see dataGoTh.client.ts).
 *
 * Returns null when nothing is configured or every configured path fails --
 * callers must treat that as "nothing to enrich yet", same as an
 * unconfigured site today.
 */
export async function resolveDataGoThResourceId(site: IGovSite): Promise<string | null> {
  if (site.dataGoThResourceId) return site.dataGoThResourceId;

  const packageId = site.dataGoThPackageId ?? env.DATA_GO_TH_DEFAULT_PACKAGE_ID;
  if (packageId) {
    const resolved = await resolveViaPackageId(packageId, site);
    if (resolved) return resolved;
  }

  const searchQuery = site.dataGoThSearchQuery ?? env.DATA_GO_TH_DEFAULT_SEARCH_QUERY;
  if (searchQuery) {
    const resolved = await resolveViaSearchQuery(searchQuery, site);
    if (resolved) return resolved;
  }

  return null;
}

// Whether a site has ANY path to a data.go.th resource -- used to decide
// whether it's even worth attempting an enrichment run (see
// pollAllEnabledSites in ingestion.service.ts).
export function hasDataGoThConfig(site: IGovSite): boolean {
  return !!(
    site.dataGoThResourceId ||
    site.dataGoThPackageId ||
    env.DATA_GO_TH_DEFAULT_PACKAGE_ID ||
    site.dataGoThSearchQuery ||
    env.DATA_GO_TH_DEFAULT_SEARCH_QUERY
  );
}
