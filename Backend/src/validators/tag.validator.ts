import { z } from 'zod';

const aliasesSchema = z.array(z.string().trim().min(1).max(200)).max(30, 'A tag can have at most 30 aliases');

export const createTagSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    facet: z.enum(['agency', 'method', 'category', 'keyword']),
    aliases: aliasesSchema.optional(),
    includeInIngestionFilter: z.boolean().optional(),
    // The admin saw the "looks like an existing tag" warning and wants to keep both.
    confirmNearDuplicate: z.boolean().optional()
  })
  .strict();

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200).optional(),
    aliases: aliasesSchema.optional(),
    confirmNearDuplicate: z.boolean().optional()
  })
  .strict()
  .refine(v => v.name !== undefined || v.aliases !== undefined, { message: 'Nothing to update', path: ['name'] });

export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// Live "is this a duplicate?" check while the admin is still typing.
export const checkDuplicatesSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    aliases: aliasesSchema.optional(),
    facet: z.enum(['site', 'agency', 'method', 'category', 'keyword']).optional(),
    excludeId: z.string().trim().min(1).optional()
  })
  .strict();

export type CheckDuplicatesInput = z.infer<typeof checkDuplicatesSchema>;

export const setIngestionFilterSchema = z.object({ value: z.boolean() }).strict();

const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform(v => v === 'true');

export const listTagsQuerySchema = z
  .object({
    facet: z.enum(['site', 'agency', 'method', 'category', 'keyword']).optional(),
    includeRetired: booleanQuery
  })
  .strict();

export const listAdminTagsQuerySchema = z
  .object({
    facet: z.enum(['site', 'agency', 'method', 'category', 'keyword']).optional(),
    includeRetired: booleanQuery,
    search: z.string().trim().max(200).optional()
  })
  .strict();
