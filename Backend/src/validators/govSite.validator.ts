import { z } from 'zod';
import { MIN_POLL_INTERVAL_MINUTES, MAX_POLL_INTERVAL_MINUTES } from '../config/polling';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// /gov-sites/:id (public detail), /admin/gov-sites/:id (edit) and
// /admin/gov-sites/:id/poll. A malformed id is a mistake in the request (400); a
// well-formed id that belongs to no site is a 404.
export const govSiteParamsSchema = z
  .object({
    id: z.string().regex(OBJECT_ID, 'id must be a government site id')
  })
  .strict();

const announceTypeSchema = z.enum(['P0', '15', 'B0', 'D0', 'W0', 'D1', 'W1', 'D2', 'W2']);

// A site has to poll at least one announcement type (an empty list would save
// a site that silently fetches nothing), each listed once.
const hasNoRepeats = (list: readonly string[]) => new Set(list).size === list.length;
const announceTypesSchema = z.array(announceTypeSchema).min(1, 'Pick at least one announcement type').refine(hasNoRepeats, 'List each announcement type only once');

// Names are shown on the website, in tags and in logs: no control characters or
// line breaks.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const noControlCharacters = (value: string) => !CONTROL_CHARACTERS.test(value);
const printable = 'must not contain control characters or line breaks';

// Numbers may arrive as JSON numbers or as plain digit strings (older clients),
// never as `true`, a blank, `null` or "12abc" -- `z.coerce.number()` would read
// each of those as some number.
const digitsToNumber = (value: unknown) => (typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value);

// A site's own override of the global schedule -- same 2-hour floor.
const pollIntervalMinutesSchema = z.preprocess(
  digitsToNumber,
  z
    .number({ invalid_type_error: 'Polling interval must be a whole number of minutes.' })
    .int('Polling interval must be a whole number of minutes.')
    .min(MIN_POLL_INTERVAL_MINUTES, 'Polling interval cannot be lower than 2 hours.')
    .max(MAX_POLL_INTERVAL_MINUTES, 'Polling interval cannot be longer than 30 days.')
);

const requestsPerMinuteSchema = z.preprocess(
  digitsToNumber,
  z
    .number({ invalid_type_error: 'requestsPerMinute must be a whole number' })
    .int('requestsPerMinute must be a whole number')
    .min(1, 'requestsPerMinute must be at least 1')
    .max(600, 'requestsPerMinute can be at most 600')
);

// The e-GP department code: digits only (2102, 0806, and the 7-digit 4520101).
// It is sent to the e-GP feed as a query parameter, and anything else can only
// ever return an empty feed.
const deptIdSchema = z
  .string()
  .trim()
  .min(1, 'deptId is required')
  .regex(/^\d{1,10}$/, 'deptId must be the e-GP department code: 1 to 10 digits, such as 2102');

// Short codes are shown beside the name and used as the site tag's alias.
const shortCodeSchema = z
  .string()
  .trim()
  .min(1, 'shortCode is required')
  .max(20, 'shortCode can be at most 20 characters')
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*$/u, 'shortCode can use letters, digits, dot, dash and underscore, and must start with a letter or digit');

// CKAN names and ids (organization slug, package and resource ids): letters,
// digits, dot, dash, underscore.
const dataGoThIdentifier = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} cannot be empty (send null to clear it)`)
    .max(100, `${what} can be at most 100 characters`)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, `${what} can use letters, digits, dot, dash and underscore only`);

// A raw CKAN package_search query (e.g. 'organization:cgd title:สัญญา').
const dataGoThSearchQuerySchema = z
  .string()
  .trim()
  .min(1, 'dataGoThSearchQuery cannot be empty (send null to clear it)')
  .max(200, 'dataGoThSearchQuery can be at most 200 characters')
  .refine(noControlCharacters, `dataGoThSearchQuery ${printable}`);

export const createGovSiteSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200, 'Name can be at most 200 characters').refine(noControlCharacters, `Name ${printable}`),
    nameEn: z.string().trim().max(200, 'nameEn can be at most 200 characters').refine(noControlCharacters, `nameEn ${printable}`).optional(),
    shortCode: shortCodeSchema,
    deptId: deptIdSchema,
    announceTypes: announceTypesSchema.optional(),
    dataGoThOrgSlug: dataGoThIdentifier('dataGoThOrgSlug').optional(),
    dataGoThResourceId: dataGoThIdentifier('dataGoThResourceId').optional(),
    dataGoThPackageId: dataGoThIdentifier('dataGoThPackageId').optional(),
    dataGoThSearchQuery: dataGoThSearchQuerySchema.optional(),
    requestsPerMinute: requestsPerMinuteSchema.optional(),
    pollIntervalMinutes: pollIntervalMinutesSchema.optional()
  })
  .strict();

export type CreateGovSiteInput = z.infer<typeof createGovSiteSchema>;

export const updateGovSiteSchema = createGovSiteSchema
  .partial()
  .extend({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    // null = drop the override and follow the global schedule again.
    pollIntervalMinutes: pollIntervalMinutesSchema.nullable().optional(),
    // null = stop using this data.go.th setting.
    dataGoThOrgSlug: dataGoThIdentifier('dataGoThOrgSlug').nullable().optional(),
    dataGoThResourceId: dataGoThIdentifier('dataGoThResourceId').nullable().optional(),
    dataGoThPackageId: dataGoThIdentifier('dataGoThPackageId').nullable().optional(),
    dataGoThSearchQuery: dataGoThSearchQuerySchema.nullable().optional()
  })
  .refine(update => Object.keys(update).length > 0, 'Send at least one field to change.');

export type UpdateGovSiteInput = z.infer<typeof updateGovSiteSchema>;

export const pollSiteSchema = z
  .object({
    source: z.enum(['rss', 'data_go_th', 'both']).default('both')
  })
  .strict();

// Live probe of a candidate deptId against the real e-GP RSS feed, BEFORE a
// new site is saved -- there is no published deptId directory anywhere (see
// seedGovSites.ts's header comment), so "does this code actually return real
// announcements?" has always had to be checked by hand, one admin, one
// request, outside the app. This just brings that same check into the Add
// Government Site form.
export const verifyDeptIdSchema = z
  .object({
    deptId: deptIdSchema,
    announceTypes: z.array(announceTypeSchema).min(1, 'Pick at least one announcement type').max(3, 'Check at most three announcement types at a time').refine(hasNoRepeats, 'List each announcement type only once').optional()
  })
  .strict();

export type VerifyDeptIdInput = z.infer<typeof verifyDeptIdSchema>;

// Autocomplete for the deptId field: what the admin has typed so far (a code
// such as "21", or part of an agency name in Thai or English).
export const suggestDeptIdQuerySchema = z
  .object({
    q: z.string().trim().min(1, 'Type part of an agency name or code.').max(100),
    limit: z.coerce.number().int().min(1).max(20).optional()
  })
  .strict();

export type SuggestDeptIdQuery = z.infer<typeof suggestDeptIdQuerySchema>;
