import { z } from 'zod';

export const listRunsQuerySchema = z
  .object({
    siteId: z.string().trim().optional(),
    source: z.enum(['rss', 'data_go_th']).optional(),
    status: z.enum(['running', 'success', 'partial', 'failed']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();
