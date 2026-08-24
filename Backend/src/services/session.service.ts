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

export async function createSession(
  accountId: Types.ObjectId,
  context: SessionContext = {}
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
    expiresAt: new Date(Date.now() + SESSION_TTL_MS)
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
    expiresAt: { $gt: new Date() }
  }).sort({ lastActiveAt: -1 });

  return sessions.map(session => toSessionView(session, currentSessionId));
}
