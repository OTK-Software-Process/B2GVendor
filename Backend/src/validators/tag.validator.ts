import { z } from 'zod';

export const createTagSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    facet: z.enum(['agency', 'method', 'category', 'keyword']),
    aliases: z.array(z.string().trim().min(1)).optional()
  })
  .strict();

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const listTagsQuerySchema = z
  .object({
    facet: z.enum(['site', 'agency', 'method', 'category', 'keyword']).optional(),
    includeRetired: z
      .enum(['true', 'false'])
      .optional()
      .transform(v => v === 'true')
  })
  .strict();
