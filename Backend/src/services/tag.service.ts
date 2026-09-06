import { Tag, ITag, TagFacet } from '../models/tag.model';
import { AppError } from '../utils/AppError';

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

export async function createTag(name: string, facet: TagFacet, aliases: string[] = []): Promise<ITag> {
  if (facet === 'site') {
    throw AppError.badRequest('Site tags are created automatically when a government site is added.');
  }
  return Tag.create({ name, facet, aliases });
}

export async function retireTag(id: string): Promise<ITag> {
  const tag = await Tag.findByIdAndUpdate(id, { retired: true }, { new: true });
  if (!tag) throw AppError.notFound('Tag not found.');
  return tag;
}
