import { z } from 'zod';
import { MIN_POLL_INTERVAL_MINUTES, MAX_POLL_INTERVAL_MINUTES } from '../config/polling';

const announceTypeSchema = z.enum(['P0', '15', 'B0', 'D0', 'W0', 'D1', 'W1', 'D2', 'W2']);

// A site's own override of the global schedule -- same 2-hour floor.
const pollIntervalMinutesSchema = z.coerce
  .number()
  .int('Polling interval must be a whole number of minutes.')
  .min(MIN_POLL_INTERVAL_MINUTES, 'Polling interval cannot be lower than 2 hours.')
  .max(MAX_POLL_INTERVAL_MINUTES, 'Polling interval cannot be longer than 30 days.');

export const createGovSiteSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    nameEn: z.string().trim().max(200).optional(),
    shortCode: z.string().trim().min(1).max(20),
    deptId: z.string().trim().min(1, 'deptId is required'),
    announceTypes: z.array(announceTypeSchema).optional(),
    dataGoThOrgSlug: z.string().trim().optional(),
    dataGoThResourceId: z.string().trim().optional(),
    dataGoThPackageId: z.string().trim().optional(),
    dataGoThSearchQuery: z.string().trim().optional(),
    requestsPerMinute: z.coerce.number().int().min(1).max(600).optional(),
    pollIntervalMinutes: pollIntervalMinutesSchema.optional()
  })
  .strict();

export type CreateGovSiteInput = z.infer<typeof createGovSiteSchema>;

export const updateGovSiteSchema = createGovSiteSchema.partial().extend({
  enabled: z.boolean().optional(),
  // null = drop the override and follow the global schedule again.
  pollIntervalMinutes: pollIntervalMinutesSchema.nullable().optional()
});

export type UpdateGovSiteInput = z.infer<typeof updateGovSiteSchema>;

export const pollSiteSchema = z
  .object({
    source: z.enum(['rss', 'data_go_th', 'both']).default('both')
  })
  .strict();
