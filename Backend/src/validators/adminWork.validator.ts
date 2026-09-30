import { z } from 'zod';

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const listAdminWorksQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    siteId: objectId.optional(),
    tag: objectId.optional(),
    // 'hidden' = filtered out of the public site by the ingestion topic filter.
    visibility: z.enum(['visible', 'hidden']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();

export const setWorkTagsSchema = z
  .object({
    tagIds: z.array(objectId).max(50, 'A work can have at most 50 tags')
  })
  .strict();

export type SetWorkTagsInput = z.infer<typeof setWorkTagsSchema>;
