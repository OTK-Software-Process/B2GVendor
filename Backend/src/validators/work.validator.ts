import { z } from 'zod';

export const listWorksQuerySchema = z
  .object({
    siteId: z.string().trim().optional(),
    status: z.enum(['PLANNED', 'DRAFT_TOR', 'BIDDING', 'CANCELLED', 'AMENDED', 'AWARDED']).optional(),
    tag: z.string().trim().optional(),
    q: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();
