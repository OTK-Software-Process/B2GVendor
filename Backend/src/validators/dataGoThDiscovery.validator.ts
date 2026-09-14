import { z } from 'zod';

export const packageShowParamsSchema = z
  .object({
    packageId: z.string().trim().min(1)
  })
  .strict();

export const datastoreSearchParamsSchema = z
  .object({
    resourceId: z.string().trim().min(1)
  })
  .strict();

export const packageSearchQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    rows: z.coerce.number().int().min(1).max(50).optional(),
    sort: z.string().trim().optional()
  })
  .strict();

export const datastoreSearchQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    // JSON-encoded {field: value} -- parsed (and validated as an object) in
    // the controller, since zod's query schema only sees it as a raw string.
    filters: z.string().trim().optional()
  })
  .strict();
