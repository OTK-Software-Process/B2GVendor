import { Types } from 'mongoose';
import { Tag, ITag, TagFacet } from '../models/tag.model';
import { Work } from '../models/work.model';
import { Follow } from '../models/follow.model';
import { AppError } from '../utils/AppError';
import { cleanAliases, compareTagKeys, tagKey, TermMatchKind } from '../utils/tagText';
import type { ProcurementMethodDef } from '../utils/procurementFacts';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_ALIASES = 30;

export interface ListTagsFilter {
  facet?: TagFacet;
  includeRetired?: boolean;
}

export async function listTags(filter: ListTagsFilter = {}): Promise<ITag[]> {
  const query: Record<string, unknown> = {};
  if (filter.facet) query.facet = filter.facet;
  if (!filter.includeRetired) query.retired = false;
  return Tag.find(query).sort({ facet: 1, name: 1 });
}

// --- Admin listing (with usage counts) ---------------------------------------

export interface AdminTagView {
  _id: string;
  name: string;
  facet: TagFacet;
  aliases: string[];
  siteId?: string;
  retired: boolean;
  includeInIngestionFilter: boolean;
  worksCount: number;
  followerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListAdminTagsFilter {
  facet?: TagFacet;
  includeRetired?: boolean;
  search?: string;
}

// Usage counts come from two grouped aggregates over the whole collection
// rather than a query per tag, so the page costs the same for 10 tags or 1000.
export async function listAdminTags(filter: ListAdminTagsFilter = {}): Promise<AdminTagView[]> {
  const query: Record<string, unknown> = {};
  if (filter.facet) query.facet = filter.facet;
  if (!filter.includeRetired) query.retired = { $ne: true };
  if (filter.search) {
    const pattern = new RegExp(escapeRegex(filter.search.trim()), 'i');
    query.$or = [{ name: pattern }, { aliases: pattern }];
  }

  const [tags, workCounts, followCounts] = await Promise.all([
    Tag.find(query).sort({ facet: 1, name: 1 }).lean(),
    Work.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', n: { $sum: 1 } } }
    ]),
    Follow.aggregate<{ _id: Types.ObjectId; n: number }>([{ $group: { _id: '$tagId', n: { $sum: 1 } } }])
  ]);

  const works = new Map(workCounts.map(w => [w._id.toString(), w.n]));
  const follows = new Map(followCounts.map(f => [f._id.toString(), f.n]));

  return tags.map(t => ({
    _id: t._id.toString(),
    name: t.name,
    facet: t.facet,
    aliases: t.aliases ?? [],
    siteId: t.siteId?.toString(),
    retired: !!t.retired,
    includeInIngestionFilter: !!t.includeInIngestionFilter,
    worksCount: works.get(t._id.toString()) ?? 0,
    followerCount: follows.get(t._id.toString()) ?? 0,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  }));
}

// --- Duplicate / near-duplicate detection ------------------------------------
// Governance rule (SRS 5.5): a redundant tag is RETIRED, never merged. So the
// system never combines two tags -- it only tells the admin that one already
// exists (exact: blocked) or looks like one that does (similar: warned).

export interface TagMatch {
  tagId: string;
  name: string;
  facet: TagFacet;
  retired: boolean;
  /** The term of the tag being created/edited that collided. */
  candidateTerm: string;
  /** The existing tag's name or alias it collided with. */
  existingTerm: string;
  similarity: number;
}

export interface TagConflicts {
  exact: TagMatch[];
  similar: TagMatch[];
}

export interface ConflictInput {
  name: string;
  aliases?: string[];
  /** Only used to also catch a same-name tag that was retired (unique index). */
  facet?: TagFacet;
  /** The tag being edited -- never conflicts with itself. */
  excludeId?: string;
}

export async function findTagConflicts(input: ConflictInput): Promise<TagConflicts> {
  const candidateTerms = [input.name, ...cleanAliases(input.name, input.aliases)]
    .map(term => ({ term, key: tagKey(term) }))
    .filter(t => t.key);

  const others = await Tag.find(input.excludeId ? { _id: { $ne: input.excludeId } } : {})
    .select('name facet aliases retired')
    .lean();

  const exact: TagMatch[] = [];
  const similar: TagMatch[] = [];
  const nameKey = tagKey(input.name);

  for (const other of others) {
    // A retired tag is out of the live vocabulary, so it only matters when it
    // would clash with the {name, facet} unique index (same name, same facet).
    if (other.retired) {
      if (input.facet && other.facet === input.facet && tagKey(other.name) === nameKey) {
        exact.push({
          tagId: other._id.toString(),
          name: other.name,
          facet: other.facet,
          retired: true,
          candidateTerm: input.name,
          existingTerm: other.name,
          similarity: 1
        });
      }
      continue;
    }

    let best: { kind: TermMatchKind; similarity: number; candidateTerm: string; existingTerm: string } | null = null;
    for (const existingTerm of [other.name, ...(other.aliases ?? [])]) {
      const existingKey = tagKey(existingTerm);
      for (const candidate of candidateTerms) {
        const match = compareTagKeys(candidate.key, existingKey);
        if (!match) continue;
        const better =
          !best ||
          (match.kind === 'exact' && best.kind !== 'exact') ||
          (match.kind === best.kind && match.similarity > best.similarity);
        if (better) best = { ...match, candidateTerm: candidate.term, existingTerm };
      }
    }

    if (best) {
      const entry: TagMatch = {
        tagId: other._id.toString(),
        name: other.name,
        facet: other.facet,
        retired: false,
        candidateTerm: best.candidateTerm,
        existingTerm: best.existingTerm,
        similarity: Number(best.similarity.toFixed(2))
      };
      (best.kind === 'exact' ? exact : similar).push(entry);
    }
  }

  similar.sort((a, b) => b.similarity - a.similarity);
  return { exact, similar };
}

async function assertNoConflicts(input: ConflictInput, opts: { confirmNearDuplicate?: boolean; blockNear?: boolean }) {
  const { exact, similar } = await findTagConflicts(input);

  if (exact.length > 0) {
    const first = exact[0];
    const message = first.retired
      ? `A retired tag named "${first.name}" already exists. Reactivate it instead of creating a duplicate.`
      : `"${first.candidateTerm}" is already used by the tag "${first.name}". Use that tag, or retire it first.`;
    throw new AppError(409, 'DUPLICATE_TAG', message, undefined, { matches: exact });
  }

  if (opts.blockNear !== false && similar.length > 0 && !opts.confirmNearDuplicate) {
    throw new AppError(
      409,
      'NEAR_DUPLICATE_TAG',
      `This looks like an existing tag ("${similar[0].name}"). Retire the redundant one instead of keeping both, or confirm to continue.`,
      undefined,
      { matches: similar }
    );
  }
}

// --- Admin mutations ------------------------------------------------------------

export interface CreateTagOptions {
  aliases?: string[];
  includeInIngestionFilter?: boolean;
  confirmNearDuplicate?: boolean;
}

export async function createTag(name: string, facet: TagFacet, opts: CreateTagOptions = {}): Promise<ITag> {
  if (facet === 'site') {
    throw AppError.badRequest('Site tags are created automatically when a government site is added.');
  }
  const cleanName = name.trim();
  const aliases = cleanAliases(cleanName, opts.aliases);
  if (aliases.length > MAX_ALIASES) throw AppError.badRequest(`A tag can have at most ${MAX_ALIASES} aliases.`);

  await assertNoConflicts({ name: cleanName, aliases, facet }, opts);

  try {
    return await Tag.create({
      name: cleanName,
      facet,
      aliases,
      includeInIngestionFilter: opts.includeInIngestionFilter ?? false
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, 'DUPLICATE_TAG', `A tag named "${cleanName}" already exists in this group.`);
    }
    throw err;
  }
}

export interface UpdateTagInput {
  name?: string;
  aliases?: string[];
  confirmNearDuplicate?: boolean;
}

// Renames a tag and/or replaces its alias (synonym) list. The tag keeps its id,
// so works and followers stay attached. Facet never changes.
export async function updateTag(id: string, input: UpdateTagInput): Promise<ITag> {
  const tag = await Tag.findById(id);
  if (!tag) throw AppError.notFound('Tag not found.');
  if (tag.retired) throw AppError.badRequest('This tag is retired. Reactivate it before editing.');

  const nextName = input.name !== undefined ? input.name.trim() : tag.name;
  if (tag.facet === 'site' && nextName !== tag.name) {
    throw AppError.badRequest('A site tag is named after its government site. Rename the site in Source Configuration.');
  }
  const nextAliases = cleanAliases(nextName, input.aliases ?? tag.aliases);
  if (nextAliases.length > MAX_ALIASES) throw AppError.badRequest(`A tag can have at most ${MAX_ALIASES} aliases.`);

  await assertNoConflicts(
    { name: nextName, aliases: nextAliases, facet: tag.facet, excludeId: id },
    { confirmNearDuplicate: input.confirmNearDuplicate }
  );

  tag.name = nextName;
  tag.aliases = nextAliases;
  try {
    await tag.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, 'DUPLICATE_TAG', `A tag named "${nextName}" already exists in this group.`);
    }
    throw err;
  }
  return tag;
}

export async function retireTag(id: string): Promise<ITag> {
  const existing = await Tag.findById(id);
  if (!existing) throw AppError.notFound('Tag not found.');
  if (existing.facet === 'site') {
    throw AppError.badRequest('A site tag follows its government site. Disable the site in Source Configuration instead.');
  }
  existing.retired = true;
  await existing.save();
  return existing;
}

// Retiring is reversible (nothing is deleted). Reactivating re-checks for
// exact collisions, since a same-named tag may have been created meanwhile.
export async function reactivateTag(id: string): Promise<ITag> {
  const tag = await Tag.findById(id);
  if (!tag) throw AppError.notFound('Tag not found.');
  if (!tag.retired) return tag;

  await assertNoConflicts({ name: tag.name, aliases: tag.aliases, excludeId: id }, { blockNear: false });
  tag.retired = false;
  await tag.save();
  return tag;
}

// Called from the AI tagging pipeline (integrations/ai) when a document
// doesn't match any existing candidate tag -- lets the vocabulary grow from
// real documents instead of staying frozen at whatever an admin seeded.
// Matching is by normalized name OR alias (regardless of which facet the AI
// guessed this time), so the same real-world concept can't end up duplicated
// as both a 'category' and a 'keyword' tag, or re-created under one of its
// own synonyms -- an existing tag's facet always wins over a fresh guess.
export async function findOrCreateAiTag(rawName: string, facet: Exclude<TagFacet, 'site'>): Promise<ITag> {
  const name = rawName.trim().slice(0, 200);
  if (!name) throw new Error('findOrCreateAiTag: empty tag name');

  const key = tagKey(name);
  const active = await Tag.find({ retired: false, facet: { $ne: 'site' } });
  const byTerm = active.find(t => [t.name, ...(t.aliases ?? [])].some(term => tagKey(term) === key));
  if (byTerm) return byTerm;

  const pattern = new RegExp(`^${escapeRegex(name)}$`, 'i');
  try {
    return await Tag.create({ name, facet, aliases: [] });
  } catch (err) {
    // Two polls (different sites, same run of the scheduler) proposing the
    // identical new tag at the same time would otherwise race on the
    // {name, facet} unique index -- fall back to whichever write won rather
    // than failing the whole ingestion item over it.
    if (isDuplicateKeyError(err)) {
      const winner = await Tag.findOne({ name: pattern });
      if (winner) return winner;
    }
    throw err;
  }
}

// The 'method' (วิธีการจัดซื้อจัดจ้าง) tag for a procurement method read from a
// title/document (utils/procurementFacts.ts). Unlike an AI-proposed tag this
// is a fixed, known vocabulary, so a missing tag is simply created -- a fresh
// database needs no seeding for filtering by method to work. Two cases keep
// admin curation intact:
//   - an admin may have RENAMED the tag, so it is matched by name OR alias
//     (same normalised key as findOrCreateAiTag) before a new one is created;
//   - an admin may have RETIRED it, which means "stop using this" -- null, and
//     nothing is created in its place.
export async function findOrCreateMethodTag(def: ProcurementMethodDef, opts: { dryRun?: boolean } = {}): Promise<ITag | null> {
  const keys = new Set([def.tagName, ...def.aliases].map(tagKey));
  const methodTags = await Tag.find({ facet: 'method' });
  const existing = methodTags.find(t => [t.name, ...(t.aliases ?? [])].some(term => keys.has(tagKey(term))));
  if (existing) return existing.retired ? null : existing;

  const fields = { name: def.tagName, facet: 'method' as const, aliases: cleanAliases(def.tagName, def.aliases) };
  // A preview (the backfill's --dry-run) must not write: hand back a tag that
  // exists only in memory.
  if (opts.dryRun) return new Tag(fields);

  try {
    return await Tag.create(fields);
  } catch (err) {
    // Two works resolving the same new method at once race on the {name, facet} index.
    if (isDuplicateKeyError(err)) {
      const winner = await Tag.findOne({ name: def.tagName, facet: 'method' });
      return winner && !winner.retired ? winner : null;
    }
    throw err;
  }
}

// Toggles whether this tag counts as an ingestion topic filter -- see the
// ITag.includeInIngestionFilter doc comment. Site tags can't be flagged
// (they're per-site identity, not a topic).
export async function setIngestionFilter(id: string, value: boolean): Promise<ITag> {
  const tag = await Tag.findById(id);
  if (!tag) throw AppError.notFound('Tag not found.');
  if (tag.facet === 'site') {
    throw AppError.badRequest('A site tag cannot be used as an ingestion topic filter.');
  }
  tag.includeInIngestionFilter = value;
  await tag.save();
  return tag;
}
