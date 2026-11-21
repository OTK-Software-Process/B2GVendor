import { Request, Response } from 'express';
import { registerAccount, loginWithPassword, verifyEmailAddress, verifyMfaChallenge } from '../services/auth.service';
import { MFA_CHALLENGE_TTL_MS, revokeSessionByRawToken } from '../services/session.service';
import { created, ok } from '../utils/apiResponse';
import { SESSION_COOKIE_NAME, sessionCookieOptions, clearSessionCookieOptions } from '../config/cookie';
import { RegisterInput, LoginInput } from '../validators/auth.validator';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { IAccount } from '../models/account.model';

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;

  await registerAccount(
    {
      name: input.name,
      email: input.email,
      password: input.password,
      type: input.type,
      businessProfile: input.businessProfile
    }
  );

  created(res, { emailVerificationRequired: true });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  await verifyEmailAddress(req.body.token as string);
  ok(res, { emailVerified: true });
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;

  const { account, rawToken, mfaRequired } = await loginWithPassword(input, req);

  // ASVS V7.2.4: signing in always starts a NEW session -- and the one this
  // browser already held (same account or another) is ended on the server, so
  // an old token copied before the sign-in is worthless afterwards.
  const previous = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof previous === 'string' && previous.length > 0 && (await revokeSessionByRawToken(previous))) {
    logger.security('info', 'auth.session.revoked', { reason: 'new_sign_in', accountId: String(account._id) });
  }

  if (mfaRequired) {
    // Right password, second factor still owed: a short-lived challenge, not a sign-in.
    // The cookie lives as long as the challenge does; the account is NOT returned.
    res.cookie(SESSION_COOKIE_NAME, rawToken, { ...sessionCookieOptions, maxAge: MFA_CHALLENGE_TTL_MS });
    ok(res, { mfaRequired: true });
    return;
  }

  res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions);
  ok(res, account.toJSON());
}

/** POST /auth/mfa/verify -- the answer to the second-factor challenge; on success the person is signed in. */
export async function verifyMfa(req: Request, res: Response): Promise<void> {
  if (!req.account || !req.authSession) throw AppError.notAuthenticated();
  const { account, rawToken, method, recoveryCodesRemaining } = await verifyMfaChallenge(req.account, req.authSession, req.body.code as string, req);

  // A NEW session token: the one that existed while only the password was known is ended.
  res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions);
  ok(res, { ...account.toJSON(), mfa: { method, ...(recoveryCodesRemaining !== undefined ? { recoveryCodesRemaining } : {}) } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];

  if (typeof rawToken === 'string' && rawToken.length > 0) {
    await revokeSessionByRawToken(rawToken);
  }
  logger.security('info', 'auth.logout', {});

  res.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions);
  // Tell the browser to drop anything it kept for this origin (ASVS V14.3.1).
  // Not "cookies": that would clear every cookie of the whole site, and the
  // session cookie is already cleared just above.
  res.set('Clear-Site-Data', '"cache", "storage"');
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  ok(res, (req.account as IAccount).toJSON());
}
