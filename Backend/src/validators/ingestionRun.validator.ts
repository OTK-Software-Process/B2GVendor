import { z } from 'zod';

export const listRunsQuerySchema = z
  .object({
    siteId: z.string().trim().optional(),
    source: z.enum(['rss', 'data_go_th']).optional(),
    status: z.enum(['running', 'success', 'partial', 'failed']).optional(),
    // Inclusive range over startedAt, as plain dates (YYYY-MM-DD) -- endDate
    // is extended to the end of that day in the service, so "same day" filters
    // make sense without the caller needing to know about time-of-day at all.
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional(),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD').optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();
