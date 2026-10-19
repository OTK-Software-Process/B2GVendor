import { z } from 'zod';

// A date filter is either a full ISO timestamp ("2026-10-07T12:00:00+07:00") or a
// plain day ("2026-10-07"). A plain day means that whole day in UTC: "from"
// starts it, "to" ends it (inclusive). Clients that care about the local day
// should send exact timestamps.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string, edge: 'start' | 'end'): Date | null {
  const date = new Date(DAY_ONLY.test(value) ? `${value}${edge === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const csv = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform(v =>
      v
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    );

export const listAuditLogQuerySchema = z
  .object({
    /** Who did it: an account id, an email, a system label (e.g. "ingestion-worker") or "anonymous". */
    actor: z.string().trim().max(200).optional(),
    /** One or more actions, comma-separated: "account.suspend,account.delete". */
    action: csv(500).optional(),
    /** One or more entity types, comma-separated: "account,tag". */
    entityType: csv(300).optional(),
    entityId: z.string().trim().max(100).optional(),
    from: z.string().trim().max(40).optional(),
    to: z.string().trim().max(40).optional(),
    /** Free text over the entity label, entity id, actor name/email, action and entity type. */
    q: z.string().trim().max(200).optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
    page: z.coerce.number().int().min(1).max(100000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict()
  .transform((value, ctx) => {
    const from = value.from === undefined ? undefined : parseBoundary(value.from, 'start');
    const to = value.to === undefined ? undefined : parseBoundary(value.to, 'end');
    if (from === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'Invalid date' });
    if (to === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Invalid date' });
    if (from && to && from > to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: '"from" must not be after "to"' });
    return { ...value, from: from ?? undefined, to: to ?? undefined };
  });

export type ListAuditLogQuery = z.output<typeof listAuditLogQuerySchema>;
