import { z } from 'zod';

const announceTypeSchema = z.enum(['P0', '15', 'B0', 'D0', 'W0', 'D1', 'W1', 'D2', 'W2']);

export const createGovSiteSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    nameEn: z.string().trim().max(200).optional(),
    shortCode: z.string().trim().min(1).max(20),
    deptId: z.string().trim().min(1, 'deptId is required'),
    announceTypes: z.array(announceTypeSchema).optional(),
    dataGoThOrgSlug: z.string().trim().optional(),
    dataGoThResourceId: z.string().trim().optional(),
    requestsPerMinute: z.coerce.number().int().min(1).max(600).optional(),
    pollIntervalMinutes: z.coerce.number().int().min(1).optional()
  })
  .strict();

export type CreateGovSiteInput = z.infer<typeof createGovSiteSchema>;

export const updateGovSiteSchema = createGovSiteSchema.partial().extend({
  enabled: z.boolean().optional()
});

export type UpdateGovSiteInput = z.infer<typeof updateGovSiteSchema>;

export const pollSiteSchema = z
  .object({
    source: z.enum(['rss', 'data_go_th', 'both']).default('both')
  })
  .strict();
