// Rules for the scheduled-poll interval (Admin > Data Ingestion > Automatic
// Schedule). Kept in ONE place so the API validators, the Mongoose models and
// the scheduler can never disagree about what's allowed.

// Hard floor: a site is never scheduled more often than once per 2 hours,
// whatever the API/DB says (see effectivePollIntervalMinutes below).
export const MIN_POLL_INTERVAL_MINUTES = 2 * 60;

// What the schedule uses until an admin picks something else.
export const DEFAULT_POLL_INTERVAL_MINUTES = 24 * 60;

// Sanity cap (30 days) so a typo can't schedule the next poll into the next
// decade -- not a business rule.
export const MAX_POLL_INTERVAL_MINUTES = 30 * 24 * 60;

// The interval actually used to schedule a site: its own override if it has
// one, otherwise the global setting -- always clamped into the allowed range,
// so a legacy/hand-edited value below the 2-hour floor (e.g. a site override
// saved before the floor existed) can never make the scheduler poll faster
// than allowed.
export function effectivePollIntervalMinutes(
  siteOverride: number | null | undefined,
  globalMinutes: number
): number {
  const raw = siteOverride ?? globalMinutes;
  if (!Number.isFinite(raw)) return DEFAULT_POLL_INTERVAL_MINUTES;
  return Math.min(MAX_POLL_INTERVAL_MINUTES, Math.max(MIN_POLL_INTERVAL_MINUTES, raw));
}
