import { z } from 'zod';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// Limits that keep one public request cheap: the longest search box, how many
// words and tags it may combine.
export const MAX_QUERY_LENGTH = 200;
export const MAX_SEARCH_TERMS = 8;
export const MAX_TAG_FILTERS = 30;
export const MAX_PAGE = 10_000;

// Numbers in a query string are plain digits. `z.coerce.number()` would read a
// blank value as 0 (an empty budget filter silently matched nothing), "0x10" as
// 16, "1e3" as 1000 and "Infinity" as a number; none of those is a real filter.
const wholeNumber = (min: number, max: number, what: string) =>
  z
    .string()
    .regex(/^\d{1,9}$/, `${what} must be a whole number`)
    .transform(Number)
    .pipe(z.number().min(min, `${what} must be at least ${min}`).max(max, `${what} must be at most ${max}`));

// Baht, with up to two decimals.
const baht = (what: string) =>
  z
    .string()
    .regex(/^\d{1,13}(\.\d{1,2})?$/, `${what} must be an amount in baht, such as 500000 or 1250.50`)
    .transform(Number);

// A calendar day, YYYY-MM-DD (the Bangkok day -- see listWorks).
const day = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${what} must be a date written YYYY-MM-DD`)
    .refine(value => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, `${what} is not a real date`);

const listWorksQueryShape = z
  .object({
    siteId: z.string().trim().regex(OBJECT_ID, 'siteId must be a government site id').optional(),
    status: z.enum(['PLANNED', 'DRAFT_TOR', 'BIDDING', 'CANCELLED', 'AMENDED', 'AWARDED']).optional(),
    // Comma-separated tag ids. A malformed id is a mistake, not "a tag that matches
    // nothing"; an id that is well formed but unknown still just matches nothing.
    tag: z
      .string()
      .trim()
      .max(MAX_TAG_FILTERS * 25)
      .refine(value => {
        const ids = value.split(',').map(id => id.trim()).filter(Boolean);
        return ids.length > 0 && ids.length <= MAX_TAG_FILTERS && ids.every(id => OBJECT_ID.test(id));
      }, `tag must be 1 to ${MAX_TAG_FILTERS} comma-separated tag ids`)
      .optional(),
    // Words are separated by spaces; every word must match (see listWorks).
    q: z
      .string()
      .trim()
      .max(MAX_QUERY_LENGTH, `Search text can be at most ${MAX_QUERY_LENGTH} characters`)
      // A null byte (or other control character) is never search text, and MongoDB
      // refuses a regular expression that contains one.
      .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), 'Search text contains characters that cannot be searched')
      .refine(value => value.split(/\s+/).filter(Boolean).length <= MAX_SEARCH_TERMS, `Search for at most ${MAX_SEARCH_TERMS} words at a time`)
      .optional(),
    budgetMin: baht('budgetMin').optional(),
    budgetMax: baht('budgetMax').optional(),
    // Publish date range, inclusive, in the Bangkok day.
    publishedFrom: day('publishedFrom').optional(),
    publishedTo: day('publishedTo').optional(),
    // ปีงบประมาณ in the Buddhist Era (2569), not the Christian year.
    fiscalYear: wholeNumber(2500, 2700, 'fiscalYear').optional(),
    sort: z.enum(['date', 'budget-asc', 'budget-desc', 'deadline', 'deadline-desc']).optional(),
    page: wholeNumber(1, MAX_PAGE, 'page').optional(),
    pageSize: wholeNumber(1, 50, 'pageSize').optional()
  })
  .strict();

export const listWorksQuerySchema = listWorksQueryShape
  .refine(query => query.budgetMin === undefined || query.budgetMax === undefined || query.budgetMin <= query.budgetMax, {
    message: 'budgetMin cannot be more than budgetMax',
    path: ['budgetMin']
  })
  .refine(query => query.publishedFrom === undefined || query.publishedTo === undefined || query.publishedFrom <= query.publishedTo, {
    message: 'publishedFrom cannot be after publishedTo',
    path: ['publishedFrom']
  });
