import { Request, Response } from 'express';
import { packageShow, packageSearch, datastoreSearch } from '../integrations/dataGoTh.client';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

/**
 * Read-only admin passthrough onto data.go.th's own CKAN Action API
 * (package_show / package_search / datastore_search) -- lets an admin browse
 * a dataset's resources and sample its records straight from the app, to
 * find/verify a current resource_id for a GovSite's enrichment config (see
 * dataGoThResource.service.ts), instead of needing a separate script.
 *
 * This is about the data.go.th enrichment side ONLY (post-award budget/
 * winner facts) -- deptId (the live RSS feed's site key) is unrelated and is
 * NOT resolvable through data.go.th at all: confirmed live that its
 * datasets carry no deptId/agency-code field (see dataGoTh.client.ts).
 */

export async function showPackage(req: Request, res: Response): Promise<void> {
  const pkg = await packageShow(req.params.packageId);
  ok(res, pkg);
}

// GET /admin/data-go-th/search?q=organization:cgd title:สัญญา -- finds
// candidate packages by a raw CKAN query, newest first by default. Useful
// for a dataset published as one new package per period (see
// dataGoThResource.service.ts) where there's no single package id to look up.
export async function searchPackages(req: Request, res: Response): Promise<void> {
  const { q, rows, sort } = req.query as { q?: string; rows?: number; sort?: string };
  const result = await packageSearch({ query: q, rows, sort: sort ?? 'metadata_created desc' });
  ok(res, result);
}

export async function searchDatastore(req: Request, res: Response): Promise<void> {
  const { limit, offset, filters } = req.query as { limit?: number; offset?: number; filters?: string };

  let parsedFilters: Record<string, string> | undefined;
  if (filters) {
    try {
      parsedFilters = JSON.parse(filters);
    } catch {
      throw AppError.validation({ filters: 'filters must be a JSON object, e.g. {"win_tin":"..."}' });
    }
  }

  const result = await datastoreSearch(req.params.resourceId, { filters: parsedFilters, limit, offset });
  ok(res, result);
}
