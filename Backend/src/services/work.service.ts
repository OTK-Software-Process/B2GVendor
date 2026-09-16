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

  // Customer requirement: a work explicitly marked 'not-related' by the
  // ingestion topic filter never appears on the public site. Anything else
  // (an explicit 'shown', or unset -- the filter was off, or this work
  // predates the feature) shows normally, so this never affects a
  // deployment that doesn't use the filter (see Work.ingestionRelevance).
  const query: Record<string, unknown> = { ingestionRelevance: { $ne: 'not-related' } };
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
  const work = await Work.findOne({ _id: id, ingestionRelevance: { $ne: 'not-related' } })
    .populate('siteId', 'name shortCode')
    .populate('tags', 'name facet');
  if (!work) throw AppError.notFound('Work not found.');
  return work;
}
