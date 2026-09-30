import { z } from 'zod';
import { MIN_POLL_INTERVAL_MINUTES, MAX_POLL_INTERVAL_MINUTES } from '../config/polling';

// Sent in MINUTES; the admin UI converts from the hours the admin types.
export const updateIngestionSettingsSchema = z
  .object({
    pollIntervalMinutes: z
      .number({ invalid_type_error: 'Polling interval must be a number of minutes.' })
      .int('Polling interval must be a whole number of minutes.')
      .min(MIN_POLL_INTERVAL_MINUTES, 'Polling interval cannot be lower than 2 hours.')
      .max(MAX_POLL_INTERVAL_MINUTES, 'Polling interval cannot be longer than 30 days.')
      .optional(),
    scheduleEnabled: z.boolean({ invalid_type_error: 'scheduleEnabled must be true or false.' }).optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export type UpdateIngestionSettingsBody = z.infer<typeof updateIngestionSettingsSchema>;
