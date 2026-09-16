import { Tag, ITag, TagFacet } from '../models/tag.model';
import { AppError } from '../utils/AppError';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

export async function createTag(
  name: string,
  facet: TagFacet,
  aliases: string[] = [],
  includeInIngestionFilter = false
): Promise<ITag> {
  if (facet === 'site') {
    throw AppError.badRequest('Site tags are created automatically when a government site is added.');
  }
  return Tag.create({ name, facet, aliases, includeInIngestionFilter });
}

// Called from the AI tagging pipeline (integrations/ai) when a document
// doesn't match any existing candidate tag -- lets the vocabulary grow from
// real documents instead of staying frozen at whatever an admin seeded.
// Case-insensitive lookup FIRST (regardless of which facet the AI guessed
// this time) so the same real-world concept can't end up duplicated as both
// a 'category' and a 'keyword' tag just because the model was inconsistent
// across calls -- an existing tag's facet always wins over a fresh guess.
export async function findOrCreateAiTag(rawName: string, facet: Exclude<TagFacet, 'site'>): Promise<ITag> {
  const name = rawName.trim().slice(0, 200);
  if (!name) throw new Error('findOrCreateAiTag: empty tag name');

  const pattern = new RegExp(`^${escapeRegex(name)}$`, 'i');
  const existing = await Tag.findOne({ name: pattern, retired: false });
  if (existing) return existing;

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

export async function retireTag(id: string): Promise<ITag> {
  const tag = await Tag.findByIdAndUpdate(id, { retired: true }, { new: true });
  if (!tag) throw AppError.notFound('Tag not found.');
  return tag;
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
