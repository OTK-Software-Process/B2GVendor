import { Types } from 'mongoose';
import { env } from '../config/env';
import { Tag } from '../models/tag.model';
import { Work } from '../models/work.model';
import { AppError } from '../utils/AppError';

// Admin-side view of works. Unlike the public work.service.ts this INCLUDES
// works hidden by the ingestion topic filter -- an admin must be able to find
// a "not-related" work to correct its tags.

export interface AdminWorkListFilter {
  q?: string;
  siteId?: string;
  tag?: string;
  visibility?: 'visible' | 'hidden';
  page?: number;
  pageSize?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LIST_FIELDS = 'title projectId status announceType pubDate siteId tags ingestionRelevance updatedAt';

export async function listAdminWorks(filter: AdminWorkListFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = {};
  if (filter.siteId) query.siteId = filter.siteId;
  if (filter.tag) query.tags = filter.tag;
  if (filter.visibility === 'hidden') query.ingestionRelevance = 'not-related';
  if (filter.visibility === 'visible') query.ingestionRelevance = { $ne: 'not-related' };
  if (filter.q) {
    const pattern = new RegExp(escapeRegExp(filter.q), 'i');
    query.$or = [{ title: pattern }, { projectId: pattern }];
  }

  const [items, total] = await Promise.all([
    Work.find(query)
      .select(LIST_FIELDS)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('siteId', 'name shortCode')
      .populate('tags', 'name facet retired'),
    Work.countDocuments(query)
  ]);

  return { items, total, page, pageSize };
}

// The ids of tags that make a work count as "in scope" for the public site --
// null when the topic-filter feature is off (relevance is then never touched).
async function getInScopeTagIds(): Promise<Set<string> | null> {
  if (!env.INGESTION_TOPIC_FILTER_ENABLED) return null;
  const tags = await Tag.find({ includeInIngestionFilter: true, retired: false }, '_id');
  return new Set(tags.map(t => t._id.toString()));
}

export async function getAdminWork(id: string) {
  const work = await Work.findById(id)
    .populate('siteId', 'name shortCode')
    .populate('tags', 'name facet retired');
  if (!work) throw AppError.notFound('Work not found.');

  const inScope = await getInScopeTagIds();
  return {
    work,
    // Lets the UI warn BEFORE a save that would hide/unhide the work.
    ingestionFilter: { active: inScope !== null, inScopeTagIds: inScope ? [...inScope] : [] }
  };
}

export interface SetWorkTagsResult {
  work: Awaited<ReturnType<typeof getAdminWork>>['work'];
  added: { id: string; name: string }[];
  removed: { id: string; name: string }[];
  relevance: { from: 'shown' | 'not-related' | null; to: 'shown' | 'not-related' | null };
}

// Replaces the work's tag set with `tagIds` (the manual override).
//   - Site tags are fixed: a work always keeps the tag of its own site, and
//     no other site tag can be added.
//   - Only ACTIVE tags can be newly added; a retired tag already on the work
//     may stay (retiring never strips existing links).
//   - Tags taken off are remembered in excludedTags so a later poll does not
//     re-add them; tags put back are removed from that list.
//   - Followers are NOT notified. Notifications belong to the "new work"
//     event (FR-3.3); a manual correction is not one, and re-notifying would
//     break the one-notification-per-work rule (FR-3.6).
export async function setWorkTags(id: string, requestedIds: string[]): Promise<SetWorkTagsResult> {
  const existing = await Work.findById(id).select('tags excludedTags ingestionRelevance');
  if (!existing) throw AppError.notFound('Work not found.');

  const requested = [...new Set(requestedIds.map(v => v.toLowerCase()))];
  const currentIds = new Set(existing.tags.map(t => t.toString()));

  const relevantIds = [...new Set([...requested, ...currentIds])];
  const tagDocs = await Tag.find({ _id: { $in: relevantIds } });
  const byId = new Map(tagDocs.map(t => [t._id.toString(), t]));

  const unknown = requested.filter(v => !byId.has(v));
  if (unknown.length > 0) {
    throw AppError.validation({ tagIds: `Unknown tag: ${unknown[0]}` });
  }

  const finalIds: string[] = [];
  // 1. site tags already on the work are always kept
  for (const cid of currentIds) if (byId.get(cid)?.facet === 'site') finalIds.push(cid);
  // 2. requested non-site tags
  for (const rid of requested) {
    const tag = byId.get(rid)!;
    if (tag.facet === 'site') {
      if (!currentIds.has(rid)) {
        throw AppError.validation({ tagIds: `"${tag.name}" is a site tag and is set by the work's government site.` });
      }
      continue; // already kept above
    }
    if (tag.retired && !currentIds.has(rid)) {
      throw AppError.validation({ tagIds: `"${tag.name}" is retired and cannot be added to a work.` });
    }
    finalIds.push(rid);
  }

  const finalSet = new Set(finalIds);
  const addedIds = finalIds.filter(v => !currentIds.has(v));
  const removedIds = [...currentIds].filter(v => !finalSet.has(v));

  const excluded = new Set(existing.excludedTags.map(t => t.toString()));
  for (const rid of removedIds) excluded.add(rid);
  for (const aid of addedIds) excluded.delete(aid);

  // Keep the topic-filter classification in step with the new tag set. Only
  // when the feature is on -- otherwise relevance stays unset/untouched.
  const inScope = await getInScopeTagIds();
  const relevanceFrom = existing.ingestionRelevance ?? null;
  let relevanceTo = relevanceFrom;
  const update: Record<string, unknown> = {
    tags: finalIds.map(v => new Types.ObjectId(v)),
    excludedTags: [...excluded].map(v => new Types.ObjectId(v))
  };
  if (inScope) {
    relevanceTo = finalIds.some(v => inScope.has(v)) ? 'shown' : 'not-related';
    update.ingestionRelevance = relevanceTo;
  }

  await Work.updateOne({ _id: id }, { $set: update });

  const { work } = await getAdminWork(id);
  const named = (ids: string[]) => ids.map(v => ({ id: v, name: byId.get(v)!.name }));
  return {
    work,
    added: named(addedIds),
    removed: named(removedIds),
    relevance: { from: relevanceFrom, to: relevanceTo }
  };
}
