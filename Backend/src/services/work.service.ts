import { Types } from 'mongoose';
import { Work, IWork, WorkStatus } from '../models/work.model';
import { Tag } from '../models/tag.model';
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
  // One or more Tag ObjectIds, comma-separated. Tags of the SAME facet (two
  // categories) match any of them; tags of DIFFERENT facets (a method AND a
  // category) must all be matched -- see tagConditions.
  tag?: string;
  q?: string; // free-text query over title + description (name search)
  budgetMax?: number;
  fiscalYear?: number; // ปีงบประมาณ, Buddhist Era (e.g. 2569)
  sort?: 'date' | 'budget-asc' | 'budget-desc' | 'deadline';
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
  'budget-asc': { budget: 1 },
  deadline: { deadlineAt: 1 }
};

const POPULATE_SITE = { path: 'siteId', select: 'name shortCode' };
const POPULATE_TAGS = { path: 'tags', select: 'name facet' };

interface SortGroup {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

// Some sorts must put one kind of work first and push the rest to the end
// (works with no price; works with no deadline). A single find() can't sort
// "these, then those" -- Mongo sorts a missing field lowest -- so the page
// window is split across two queries: `first` is paged through, then `rest`
// takes over where it runs out.
async function listWorksInTwoGroups(
  query: Record<string, unknown>,
  first: SortGroup,
  rest: SortGroup,
  page: number,
  pageSize: number
): Promise<ListWorksResult> {
  // $and (not a spread): a group's own $or / $and must sit NEXT TO the caller's
  // (the free-text search is an $or, the tag filter an $and), never replace it.
  const firstQuery = { $and: [query, first.filter] };
  const restQuery = { $and: [query, rest.filter] };
  const [firstTotal, restTotal] = await Promise.all([Work.countDocuments(firstQuery), Work.countDocuments(restQuery)]);

  const skip = (page - 1) * pageSize;
  const items: IWork[] = [];

  if (skip < firstTotal) {
    items.push(
      ...(await Work.find(firstQuery)
        .sort(first.sort)
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
      ...(await Work.find(restQuery)
        .sort(rest.sort)
        .skip(Math.max(0, skip - firstTotal))
        .limit(remaining)
        .select('-excludedTags')
        .populate(POPULATE_SITE)
        .populate(POPULATE_TAGS))
    );
  }

  return { items, total: firstTotal + restTotal, page, pageSize };
}

// "Budget: low to high" must not start with the works that have NO price --
// they'd float to the top looking like the cheapest. Priced works first
// (ascending), then the unpriced ones (newest first).
function listWorksPricedFirst(query: Record<string, unknown>, page: number, pageSize: number): Promise<ListWorksResult> {
  return listWorksInTwoGroups(
    query,
    { filter: { budget: { $gt: 0 } }, sort: { budget: 1, _id: 1 } },
    { filter: { budget: { $not: { $gt: 0 } } }, sort: SORTS.date },
    page,
    pageSize
  );
}

// Works can still be bid on are listed first, the one closing soonest at the
// top; everything else -- no deadline stated, or already closed -- follows,
// newest first. A cancelled or awarded work is never "upcoming" even if the
// date it once had is still ahead (unless the user filtered to that status).
function listWorksByDeadline(query: Record<string, unknown>, page: number, pageSize: number): Promise<ListWorksResult> {
  const now = new Date();
  const stillOpen = query.status ? {} : { status: { $nin: ['CANCELLED', 'AWARDED'] } };
  return listWorksInTwoGroups(
    query,
    { filter: { deadlineAt: { $gte: now }, ...stillOpen }, sort: { deadlineAt: 1, _id: 1 } },
    // $not/$gte also matches a missing deadline, and an open-date one that is excluded above.
    { filter: { $or: [{ deadlineAt: { $not: { $gte: now } } }, ...(query.status ? [] : [{ status: { $in: ['CANCELLED', 'AWARDED'] } }])] }, sort: SORTS.date },
    page,
    pageSize
  );
}

// The tag filter is a faceted one: choosing two categories means "either",
// choosing a method AND a category means "both". (A single $in over every id
// would make adding a second facet WIDEN the results instead of narrowing them,
// which is how a method filter used next to a category filter looked broken.)
// Ids that aren't a real tag match nothing, as they always did.
async function tagConditions(rawIds: string[]): Promise<Record<string, unknown>[]> {
  const validIds = rawIds.filter(id => Types.ObjectId.isValid(id));
  const tags = validIds.length > 0 ? await Tag.find({ _id: { $in: validIds } }, 'facet') : [];

  const byFacet = new Map<string, string[]>();
  const known = new Set<string>();
  for (const tag of tags) {
    known.add(tag._id.toString());
    byFacet.set(tag.facet, [...(byFacet.get(tag.facet) ?? []), tag._id.toString()]);
  }

  const conditions = [...byFacet.values()].map(ids => ({ tags: { $in: ids } }));
  if (rawIds.some(id => !known.has(id))) conditions.push({ tags: { $in: [] } });
  return conditions;
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
  if (filter.fiscalYear !== undefined) query.fiscalYear = filter.fiscalYear;

  if (filter.tag) {
    const tagIds = filter.tag
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (tagIds.length > 0) query.$and = await tagConditions(tagIds);
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

  // With a budgetMax filter every match already has a price, so the plain
  // sort below is correct; without one, unpriced works must be pushed last.
  if (filter.sort === 'budget-asc' && filter.budgetMax === undefined) {
    return listWorksPricedFirst(query, page, pageSize);
  }
  if (filter.sort === 'deadline') {
    return listWorksByDeadline(query, page, pageSize);
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

export interface FiscalYearOption {
  year: number;
  count: number;
}

// The fiscal years that actually have works, newest first -- what the website's
// ปีงบประมาณ filter offers (no empty choices).
export async function listFiscalYears(): Promise<FiscalYearOption[]> {
  const rows = await Work.aggregate<{ _id: number; count: number }>([
    { $match: { ingestionRelevance: { $ne: 'not-related' }, fiscalYear: { $exists: true, $ne: null } } },
    { $group: { _id: '$fiscalYear', count: { $sum: 1 } } },
    { $sort: { _id: -1 } }
  ]);
  return rows.map(row => ({ year: row._id, count: row.count }));
}

export async function getWorkById(id: string): Promise<IWork> {
  const work = await Work.findOne({ _id: id, ingestionRelevance: { $ne: 'not-related' } })
    .select('-excludedTags')
    .populate(POPULATE_SITE)
    .populate(POPULATE_TAGS);
  if (!work) throw AppError.notFound('Work not found.');
  return work;
}
