import { Types } from 'mongoose';
import { IWork } from '../models/work.model';
import { AnnounceType } from '../models/govSite.model';
import { Tag } from '../models/tag.model';
import {
  ProcurementFacts,
  SubmissionDeadline,
  detectFiscalYear,
  detectProcurementMethod,
  estimateFiscalYearFromProjectId,
  methodByKey
} from '../utils/procurementFacts';
import { findOrCreateMethodTag } from './tag.service';

/**
 * Applies the facts read from an announcement -- procurement method, fiscal
 * year, bid deadline (utils/procurementFacts.ts) -- to a Work. One function for
 * every place that learns something about a work (a new RSS item, a lifecycle
 * update, the retry sweep, the one-off backfill), so they all follow the same
 * rules:
 *   - method   -> the work gets the matching 'method' Tag, unless it already has
 *                 one or an admin removed that tag from this work by hand;
 *   - year     -> a year STATED in the title/document replaces an ESTIMATED one,
 *                 never the other way round;
 *   - deadline -> only from an invitation (D0) or its amendment (D2), the
 *                 newest one wins (an amendment can move the date), and a
 *                 document that states none leaves the old one alone.
 * Mutates `work` but does not save it -- the caller owns the save.
 */

// Announce types whose document is the one that states a bid deadline.
const DEADLINE_ANNOUNCE_TYPES: readonly AnnounceType[] = ['D0', 'D2'];

// A deadline far before the announcement, or years after it, is a misread
// (a stray date in the text), not a real closing time.
const DEADLINE_EARLIEST_BEFORE_ANNOUNCE_MS = 2 * 24 * 3600_000;
const DEADLINE_LATEST_AFTER_ANNOUNCE_MS = 730 * 24 * 3600_000;

export interface ApplyFactsInput {
  // The announcement title: states the method in every real title and the
  // fiscal year in some.
  title: string;
  // The announce type of the document(s) in `documents` -- decides whether a
  // deadline found there counts.
  announceType: AnnounceType;
  // Merged facts of the document(s) just read; absent when none was read.
  documents?: ProcurementFacts;
  // The announcement's date, to sanity-check a deadline against.
  reference?: Date | null;
  // Work out what WOULD change without creating any tag (the backfill's preview).
  dryRun?: boolean;
}

export interface ApplyFactsResult {
  changed: boolean;
  // Tags this call added to `work.tags` -- so the caller can notify the
  // followers of a method it has just learned (see notifyNewWorkMatches).
  addedTagIds: Types.ObjectId[];
}

// An admin removing a tag from a work by hand must stick -- see
// Work.excludedTags and ingestion.service.ts's isTagExcluded.
function isExcluded(work: Pick<IWork, 'excludedTags'>, tagId: Types.ObjectId): boolean {
  return !!work.excludedTags?.some(t => t.equals(tagId));
}

async function hasMethodTag(work: Pick<IWork, 'tags'>): Promise<boolean> {
  if (work.tags.length === 0) return false;
  return !!(await Tag.exists({ _id: { $in: work.tags }, facet: 'method' }));
}

function isPlausibleDeadline(deadline: SubmissionDeadline, reference: Date | null | undefined): boolean {
  if (!reference) return true;
  const gap = deadline.endAt.getTime() - reference.getTime();
  return gap >= -DEADLINE_EARLIEST_BEFORE_ANNOUNCE_MS && gap <= DEADLINE_LATEST_AFTER_ANNOUNCE_MS;
}

export async function applyWorkFacts(work: IWork, input: ApplyFactsInput): Promise<ApplyFactsResult> {
  let changed = false;
  const addedTagIds: Types.ObjectId[] = [];

  // --- method ---
  // The title is the announcement's own "ด้วยวิธี..." line; the document's
  // opening is the fallback for a title that doesn't carry it.
  const methodKey = detectProcurementMethod(input.title) ?? input.documents?.method;
  if (methodKey && !(await hasMethodTag(work))) {
    const tag = await findOrCreateMethodTag(methodByKey(methodKey), { dryRun: input.dryRun });
    if (tag && !isExcluded(work, tag._id) && !work.tags.some(t => t.equals(tag._id))) {
      work.tags.push(tag._id);
      addedTagIds.push(tag._id);
      changed = true;
    }
  }

  // --- fiscal year ---
  const stated = detectFiscalYear(input.title) ?? input.documents?.fiscalYear;
  if (stated) {
    if (work.fiscalYear !== stated || work.fiscalYearSource !== 'document') {
      work.fiscalYear = stated;
      work.fiscalYearSource = 'document';
      changed = true;
    }
  } else if (!work.fiscalYear) {
    const estimate = estimateFiscalYearFromProjectId(work.projectId);
    if (estimate) {
      work.fiscalYear = estimate;
      work.fiscalYearSource = 'estimated';
      changed = true;
    }
  }

  // --- deadline ---
  const deadline = input.documents?.deadline;
  if (deadline && DEADLINE_ANNOUNCE_TYPES.includes(input.announceType) && isPlausibleDeadline(deadline, input.reference ?? work.pubDate)) {
    const same =
      work.deadlineAt?.getTime() === deadline.endAt.getTime() &&
      work.deadlineStartAt?.getTime() === deadline.startAt?.getTime() &&
      work.deadlineHasTime === deadline.hasTime;
    if (!same) {
      work.deadlineAt = deadline.endAt;
      work.deadlineStartAt = deadline.startAt;
      work.deadlineHasTime = deadline.hasTime;
      changed = true;
    }
  }

  return { changed, addedTagIds };
}
