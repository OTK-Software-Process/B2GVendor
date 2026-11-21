import { Types } from 'mongoose';
import { Session, ISession, issueSessionToken, hashSessionToken } from '../models/session.model';
import { SESSION_TTL_MS } from '../config/cookie';
import { parseUserAgent, maskIpAddress } from '../utils/userAgent';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
  location?: string;
}

export interface SessionView {
  id: string;
  browser: string;
  os: string;
  ipAddress?: string;
  location?: string;
  lastActiveAt: Date;
  isCurrent: boolean;
}

/** How long the answer to a second-factor challenge may take. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface SessionOptions {
  /** A challenge session: valid only for answering the second factor, for MFA_CHALLENGE_TTL_MS. */
  mfaPending?: boolean;
  /** A full session whose second factor has just been checked. */
  mfaVerified?: boolean;
}

export async function createSession(
  accountId: Types.ObjectId,
  context: SessionContext = {},
  options: SessionOptions = {}
): Promise<{ session: ISession; rawToken: string }> {
  const { raw, tokenHash } = issueSessionToken();
  const { browser, os } = parseUserAgent(context.userAgent);

  const session = await Session.create({
    accountId,
    tokenHash,
    userAgent: context.userAgent,
    browser,
    os,
    ipAddress: context.ipAddress,
    location: context.location,
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + (options.mfaPending ? MFA_CHALLENGE_TTL_MS : SESSION_TTL_MS)),
    ...(options.mfaPending ? { mfaPending: true } : {}),
    ...(options.mfaVerified ? { mfaVerifiedAt: new Date() } : {})
  });

  return { session, rawToken: raw };
}

export async function revokeSessionById(sessionId: Types.ObjectId | string): Promise<boolean> {
  const result = await Session.updateOne(
    { _id: sessionId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
  return result.modifiedCount > 0;
}

export async function revokeSessionByRawToken(rawToken: string): Promise<boolean> {
  const result = await Session.updateOne(
    { tokenHash: hashSessionToken(rawToken), revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
  return result.modifiedCount > 0;
}

export async function revokeAllSessions(accountId: Types.ObjectId | string): Promise<number> {
  const result = await Session.updateMany(
    { accountId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
  return result.modifiedCount;
}

export async function revokeOtherSessions(
  accountId: Types.ObjectId | string,
  keepSessionId: Types.ObjectId | string
): Promise<number> {
  const result = await Session.updateMany(
    { accountId, _id: { $ne: keepSessionId }, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
  return result.modifiedCount;
}

export async function findSessionForAccount(
  accountId: Types.ObjectId | string,
  sessionId: Types.ObjectId | string
): Promise<ISession | null> {
  return Session.findOne({ _id: sessionId, accountId, revokedAt: { $exists: false } });
}

export function toSessionView(session: ISession, currentSessionId?: string): SessionView {
  return {
    id: String(session._id),
    browser: session.browser ?? 'Unknown',
    os: session.os ?? 'Unknown',
    ipAddress: maskIpAddress(session.ipAddress),
    location: session.location,
    lastActiveAt: session.lastActiveAt,
    isCurrent: currentSessionId !== undefined && String(session._id) === currentSessionId
  };
}

export async function listActiveSessions(
  accountId: Types.ObjectId | string,
  currentSessionId?: string
): Promise<SessionView[]> {
  const sessions = await Session.find({
    accountId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    mfaPending: { $ne: true } // a challenge awaiting its second factor is not a signed-in device
  }).sort({ lastActiveAt: -1 });

  return sessions.map(session => toSessionView(session, currentSessionId));
}
