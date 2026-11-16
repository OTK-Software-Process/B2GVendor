import { AnnounceType } from '../models/govSite.model';
import { STATUS_BY_ANNOUNCE_TYPE, WorkStatus } from '../models/work.model';

// A work's status is the status of its LATEST e-GP announcement (SRS FR-4.3),
// and its history lists the announcements in the order they happened (FR-5.4).
//
// "Latest" is decided by when an announcement was published, never by when this
// system happened to read it. The poll reads each announcement type's feed in
// turn, and a feed keeps listing old announcements for a while, so an older one
// (a draft TOR from three weeks ago) is seen again on every poll, or for the
// first time after a type is switched on, or after a newer type's feed has
// stopped listing the work. If the status simply followed whichever item was
// read last, an awarded work would slide back to "draft TOR" (and the history
// would grow by a row every poll).
export interface StatusEvent {
  status: WorkStatus;
  announceType: AnnounceType;
  changedAt: Date;
  note?: string;
}

export interface AppliedAnnouncement {
  // The whole history, oldest first.
  history: StatusEvent[];
  // Status and announce type of the latest event: what the work is NOW.
  status: WorkStatus;
  announceType: AnnounceType;
  // True when this announcement was new and has been added to the history.
  recorded: boolean;
}

// The usual order of a project's life. It only breaks a tie between two
// announcements published at the same moment.
const LIFECYCLE_RANK: Record<AnnounceType, number> = {
  P0: 0,
  '15': 1,
  B0: 2,
  D0: 3,
  D2: 4,
  D1: 5,
  W0: 6,
  W2: 7,
  W1: 8
};

function compareEvents(a: StatusEvent, b: StatusEvent): number {
  return a.changedAt.getTime() - b.changedAt.getTime() || LIFECYCLE_RANK[a.announceType] - LIFECYCLE_RANK[b.announceType];
}

/**
 * Takes one announcement read from a feed and returns the work's history with it
 * accounted for, and the status the work should now have.
 *
 * An announcement is already known when the history holds one of the same type
 * published at the same time (or, for an item with no publish date, of the same
 * type). A known announcement changes nothing. A new one is added in its place in
 * time, so a late-arriving old announcement is filed before the newer ones and
 * does not change the current status. A newer announcement of the same type (a
 * second amendment, or a fresh invitation after a cancellation) is a new event.
 *
 * The status is always taken from the latest event of the history as it now
 * stands, so a work whose status was damaged by an older version of the poll
 * repairs itself the next time one of its announcements is read.
 */
export function applyAnnouncement(
  history: readonly StatusEvent[],
  announceType: AnnounceType,
  publishedAt: Date | null,
  now: Date = new Date()
): AppliedAnnouncement {
  const known = history.some(
    event => event.announceType === announceType && (publishedAt === null || event.changedAt.getTime() === publishedAt.getTime())
  );

  let events = [...history];
  if (!known) {
    events.push({ status: STATUS_BY_ANNOUNCE_TYPE[announceType], announceType, changedAt: publishedAt ?? now });
    events = events.sort(compareEvents);
  }

  const latest = events.reduce((a, b) => (compareEvents(b, a) >= 0 ? b : a));
  return { history: events, status: latest.status, announceType: latest.announceType, recorded: !known };
}

/** True when the history is already in order, oldest first. */
export function isChronological(history: readonly StatusEvent[]): boolean {
  return history.every((event, i) => i === 0 || compareEvents(history[i - 1], event) <= 0);
}

/**
 * A history put right: each announcement once (same type, same moment), oldest
 * first. For works whose history was written by the older poll, which added an
 * entry every time an old announcement was read again.
 */
export function repairHistory(history: readonly StatusEvent[]): StatusEvent[] {
  const seen = new Set<string>();
  const unique: StatusEvent[] = [];
  for (const event of history) {
    const key = `${event.announceType}@${event.changedAt.getTime()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(event);
    }
  }
  return unique.sort(compareEvents);
}
