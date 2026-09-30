import { Types } from 'mongoose';
import { IngestionSettings, IIngestionSettings, INGESTION_SETTINGS_KEY } from '../models/ingestionSettings.model';
import { GovSite, IGovSite } from '../models/govSite.model';
import {
  DEFAULT_POLL_INTERVAL_MINUTES,
  MIN_POLL_INTERVAL_MINUTES,
  MAX_POLL_INTERVAL_MINUTES,
  effectivePollIntervalMinutes
} from '../config/polling';

export interface UpdateIngestionSettingsInput {
  pollIntervalMinutes?: number;
  scheduleEnabled?: boolean;
}

// What admin > Data Ingestion > Automatic Schedule renders.
export interface ScheduleOverview {
  pollIntervalMinutes: number;
  scheduleEnabled: boolean;
  // The bounds, so the UI validates against exactly what the API enforces
  // instead of hard-coding its own copy of them.
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  defaultIntervalMinutes: number;
  // When the automatic schedule will next start a poll. null while the
  // schedule is paused or no site is enabled.
  nextRunAt: Date | null;
  updatedAt: Date;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

// Creates the singleton on first use with the 24-hour default. The API and the
// worker can both hit that very first read at the same moment; the unique
// index on `key` makes the loser's insert fail, and by then the document
// exists, so it just reads it.
export async function getIngestionSettings(): Promise<IIngestionSettings> {
  const existing = await IngestionSettings.findOne({ key: INGESTION_SETTINGS_KEY });
  if (existing) return existing;

  try {
    return await IngestionSettings.create({ key: INGESTION_SETTINGS_KEY });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await IngestionSettings.findOne({ key: INGESTION_SETTINGS_KEY });
      if (raced) return raced;
    }
    throw err;
  }
}

/**
 * When a site will next be polled by the schedule. A site that was never
 * scheduled is due right now; and if the interval was shortened since
 * `nextPollAt` was written (a 24-hour timer left over from before the admin
 * chose 2 hours), it is pulled in to the new interval rather than waiting out
 * the old one. The scheduler and the admin UI both go through this so they can
 * never disagree about "next run".
 */
export function effectiveNextPollAt(
  site: Pick<IGovSite, 'nextPollAt' | 'pollIntervalMinutes'>,
  globalIntervalMinutes: number,
  now: Date = new Date()
): Date {
  if (!site.nextPollAt) return now;
  const intervalMs = effectivePollIntervalMinutes(site.pollIntervalMinutes, globalIntervalMinutes) * 60_000;
  const latestAllowed = new Date(now.getTime() + intervalMs);
  return site.nextPollAt > latestAllowed ? latestAllowed : site.nextPollAt;
}

export async function getScheduleOverview(): Promise<ScheduleOverview> {
  const settings = await getIngestionSettings();

  let nextRunAt: Date | null = null;
  if (settings.scheduleEnabled) {
    const now = new Date();
    const sites = await GovSite.find({ enabled: true }).select('nextPollAt pollIntervalMinutes');
    for (const site of sites) {
      const at = effectiveNextPollAt(site, settings.pollIntervalMinutes, now);
      if (!nextRunAt || at < nextRunAt) nextRunAt = at;
    }
  }

  return {
    pollIntervalMinutes: settings.pollIntervalMinutes,
    scheduleEnabled: settings.scheduleEnabled,
    minIntervalMinutes: MIN_POLL_INTERVAL_MINUTES,
    maxIntervalMinutes: MAX_POLL_INTERVAL_MINUTES,
    defaultIntervalMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
    nextRunAt,
    updatedAt: settings.updatedAt
  };
}

export async function updateIngestionSettings(
  input: UpdateIngestionSettingsInput,
  updatedBy: Types.ObjectId
): Promise<ScheduleOverview> {
  const settings = await getIngestionSettings();

  if (input.pollIntervalMinutes !== undefined) settings.pollIntervalMinutes = input.pollIntervalMinutes;
  if (input.scheduleEnabled !== undefined) settings.scheduleEnabled = input.scheduleEnabled;
  settings.updatedBy = updatedBy;

  // The model's own min/max validators run here too, so the 2-hour floor holds
  // even if a future caller skips the request validator.
  await settings.save();

  return getScheduleOverview();
}
