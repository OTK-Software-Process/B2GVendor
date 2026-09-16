import { Work, IWork, WorkStatus } from '../models/work.model';
import { AppError } from '../utils/AppError';

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

// Escapes regex metacharacters so a user's free-text query is matched
// literally, not interpreted as a regex.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SORTS: Record<NonNullable<ListWorksFilter['sort']>, Record<string, 1 | -1>> = {
  date: { pubDate: -1, createdAt: -1 },
  'budget-desc': { budget: -1 },
  'budget-asc': { budget: 1 }
};

export async function listWorks(filter: ListWorksFilter = {}): Promise<ListWorksResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = {};
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
    // Substring/typo-tolerant-ish match via case-insensitive regex rather
    // than Mongo's $text (word-stemmed) index: $text tokenizes on word
    // boundaries, which does not work well for Thai (no spaces between
    // words) or for partial-word queries -- see ProjectDescription.md N4.
    const pattern = new RegExp(escapeRegExp(filter.q.trim()), 'i');
    query.$or = [{ title: pattern }, { description: pattern }];
  }

  const [items, total] = await Promise.all([
    Work.find(query)
      .sort(SORTS[filter.sort ?? 'date'])
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('siteId', 'name shortCode')
      .populate('tags', 'name facet'),
    Work.countDocuments(query)
  ]);

  return { items, total, page, pageSize };
}

export async function getWorkById(id: string): Promise<IWork> {
  const work = await Work.findById(id).populate('siteId', 'name shortCode').populate('tags', 'name facet');
  if (!work) throw AppError.notFound('Work not found.');
  return work;
}
