import type { ListWorksParams } from './backend';

// The search page's URL -> the API query for its results. Used by BOTH the
// server page (to render the first page of results into the HTML) and the
// client component (for every later change), so the two can never disagree
// about which results belong to a URL.

export const SEARCH_PAGE_SIZE = 10;

const SORTS: readonly NonNullable<ListWorksParams['sort']>[] = ['date', 'budget-asc', 'budget-desc', 'deadline', 'deadline-desc'];
const STATUSES: readonly NonNullable<ListWorksParams['status']>[] = ['PLANNED', 'DRAFT_TOR', 'BIDDING', 'CANCELLED', 'AMENDED', 'AWARDED'];

export function searchListParams(get: (key: string) => string | null): ListWorksParams {
  const q = get('q') || '';
  const status = get('status') || '';
  const site = get('site') || '';
  const tags = get('tags') || '';
  const budgetMax = get('budgetMax') || '';
  const fiscalYear = get('fiscalYear') || '';
  const sortBy = get('sortBy') || '';
  const page = parseInt(get('page') || '1', 10) || 1;

  return {
    q: q || undefined,
    // Only values the API accepts: an unknown one in a hand-edited URL would
    // fail validation (400) and show the error state instead of results.
    status: (STATUSES as readonly string[]).includes(status) ? (status as ListWorksParams['status']) : undefined,
    siteId: site || undefined,
    tag: tags || undefined,
    budgetMax: budgetMax && Number.isFinite(Number(budgetMax)) ? Number(budgetMax) : undefined,
    fiscalYear: fiscalYear && Number.isInteger(Number(fiscalYear)) ? Number(fiscalYear) : undefined,
    sort: (SORTS as readonly string[]).includes(sortBy) ? (sortBy as ListWorksParams['sort']) : 'date',
    page: Math.max(1, page),
    pageSize: SEARCH_PAGE_SIZE
  };
}

// A stable identity for a query: same key = same results.
export function searchKey(params: ListWorksParams): string {
  return JSON.stringify([params.q, params.status, params.siteId, params.tag, params.budgetMax, params.fiscalYear, params.sort, params.page, params.pageSize]);
}
