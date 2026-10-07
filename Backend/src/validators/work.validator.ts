import { z } from 'zod';

export const listWorksQuerySchema = z
  .object({
    siteId: z.string().trim().optional(),
    status: z.enum(['PLANNED', 'DRAFT_TOR', 'BIDDING', 'CANCELLED', 'AMENDED', 'AWARDED']).optional(),
    tag: z.string().trim().optional(),
    q: z.string().trim().optional(),
    budgetMax: z.coerce.number().min(0).optional(),
    // ปีงบประมาณ in the Buddhist Era (2569), not the Christian year.
    fiscalYear: z.coerce.number().int().min(2500).max(2700).optional(),
    sort: z.enum(['date', 'budget-asc', 'budget-desc', 'deadline']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();
