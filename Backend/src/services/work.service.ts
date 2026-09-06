import { Work, IWork, WorkStatus } from '../models/work.model';
import { AppError } from '../utils/AppError';

// Intentionally minimal (Mongo query + text index, paginated) -- this exists
// so ingested data is actually checkable end-to-end without the frontend.
// The full N4 faceted search engine (Thai tokenization, typo tolerance,
// dedicated search index) is a separate, larger piece, not built here.

export interface ListWorksFilter {
  siteId?: string;
  status?: WorkStatus;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ListWorksResult {
  items: IWork[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listWorks(filter: ListWorksFilter = {}): Promise<ListWorksResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = {};
  if (filter.siteId) query.siteId = filter.siteId;
  if (filter.status) query.status = filter.status;
  if (filter.tag) query.tags = filter.tag;
  if (filter.q) query.$text = { $search: filter.q };

  const [items, total] = await Promise.all([
    Work.find(query)
      .sort(filter.q ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
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
