import { Work, IWork, WorkStatus } from '../models/work.model';
import { AppError } from '../utils/AppError';
import { buildThaiSearchRegex } from '../utils/thaiSearch';

// Best-effort full-text + facet query against a plain Mongo instance -- NOT
// MongoDB Atlas Search. Atlas Search ($search/$searchMeta over an Atlas
// Search index) requires an actual Atlas cluster, which this project isn't
// pointed at yet (local Backend/.env uses a self-hosted mongo). Once an
// Atlas connection string is available, swap the $or/regex block below for
// a $search aggregation stage (autocomplete/text operator on title +
// description, facet collectors on status/siteId/tags) -- the filter shape
// (ListWorksFilter) and paginated response shape are kept stable so that
// swap doesn't ripple into the controller or the frontend.
export interface ListWorksFilter {
  siteId?: string;
  status?: WorkStatus;
  tag?: string; // one or more Tag ObjectIds, comma-separated (matches any)
  q?: string; // free-text query over title + description (name search)
  budgetMax?: number;
  sort?: 'date' | 'budget-asc' | 'budget-desc';
  page?: number;
  pageSize?: number;
}

export interface ListWorksResult {
  items: IWork[];
  total: number;
  page: number;
  pageSize: number;
}

const SORTS: Record<NonNullable<ListWorksFilter['sort']>, Record<string, 1 | -1>> = {
  date: { pubDate: -1, createdAt: -1 },
  'budget-desc': { budget: -1 },
  'budget-asc': { budget: 1 }
};

const POPULATE_SITE = { path: 'siteId', select: 'name shortCode' };
const POPULATE_TAGS = { path: 'tags', select: 'name facet' };

// "Budget: low to high" must not start with the works that have NO price --
// Mongo sorts a missing/null field lowest, so they'd float to the top looking
// like the cheapest. Page through the priced works first (ascending), then the
// unpriced ones (newest first). A single find() can't sort nulls last, so the
// page window is split across the two groups.
async function listWorksPricedFirst(
  query: Record<string, unknown>,
  page: number,
  pageSize: number
): Promise<ListWorksResult> {
  const priced = { ...query, budget: { $gt: 0 } };
  const unpriced = { ...query, budget: { $not: { $gt: 0 } } };
  const [pricedTotal, unpricedTotal] = await Promise.all([
    Work.countDocuments(priced),
    Work.countDocuments(unpriced)
  ]);

  const skip = (page - 1) * pageSize;
  const items: IWork[] = [];

  if (skip < pricedTotal) {
    items.push(
      ...(await Work.find(priced)
        .sort({ budget: 1, _id: 1 })
        .skip(skip)
        .limit(pageSize)
        .select('-excludedTags')
        .populate(POPULATE_SITE)
        .populate(POPULATE_TAGS))
    );
  }

  const remaining = pageSize - items.length;
  if (remaining > 0) {
    items.push(
      ...(await Work.find(unpriced)
        .sort(SORTS.date)
        .skip(Math.max(0, skip - pricedTotal))
        .limit(remaining)
        .select('-excludedTags')
        .populate(POPULATE_SITE)
        .populate(POPULATE_TAGS))
    );
  }

  return { items, total: pricedTotal + unpricedTotal, page, pageSize };
}

export async function listWorks(filter: ListWorksFilter = {}): Promise<ListWorksResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  // Customer requirement: a work explicitly marked 'not-related' by the
  // ingestion topic filter never appears on the public site. Anything else
  // (an explicit 'shown', or unset -- the filter was off, or this work
  // predates the feature) shows normally, so this never affects a
  // deployment that doesn't use the filter (see Work.ingestionRelevance).
  const query: Record<string, unknown> = { ingestionRelevance: { $ne: 'not-related' } };
  if (filter.siteId) query.siteId = filter.siteId;
  if (filter.status) query.status = filter.status;

  if (filter.tag) {
    const tagIds = filter.tag
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (tagIds.length > 0) query.tags = { $in: tagIds };
  }

  if (filter.budgetMax !== undefined) {
    query.budget = { $lte: filter.budgetMax };
  }

  if (filter.q) {
    const pattern = buildThaiSearchRegex(filter.q);
    const legacyExactPattern = new RegExp(
      filter.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'iu'
    );
    // searchText stores normalized Thai text for fuzzy matching. The title
    // and description clauses retain exact matching until the backfill has
    // populated searchText on every existing work.
    query.$or = [
      { searchText: pattern },
      { title: legacyExactPattern },
      { description: legacyExactPattern }
    ];
  }

  // With a budgetMax filter every match already has a price, so the plain
  // sort below is correct; without one, unpriced works must be pushed last.
  if (filter.sort === 'budget-asc' && filter.budgetMax === undefined) {
    return listWorksPricedFirst(query, page, pageSize);
  }

  const [items, total] = await Promise.all([
    Work.find(query)
      .sort(SORTS[filter.sort ?? 'date'])
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('-excludedTags')
      .populate(POPULATE_SITE)
      .populate(POPULATE_TAGS),
    Work.countDocuments(query)
  ]);

  return { items, total, page, pageSize };
}

export async function getWorkById(id: string): Promise<IWork> {
  const work = await Work.findOne({ _id: id, ingestionRelevance: { $ne: 'not-related' } })
    .select('-excludedTags')
    .populate(POPULATE_SITE)
    .populate(POPULATE_TAGS);
  if (!work) throw AppError.notFound('Work not found.');
  return work;
}
