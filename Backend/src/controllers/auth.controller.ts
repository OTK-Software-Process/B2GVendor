import { Request, Response } from 'express';
import { registerAccount, loginWithPassword, verifyEmailAddress } from '../services/auth.service';
import { revokeSessionByRawToken } from '../services/session.service';
import { created, ok } from '../utils/apiResponse';
import { SESSION_COOKIE_NAME, sessionCookieOptions, clearSessionCookieOptions } from '../config/cookie';
import { RegisterInput, LoginInput } from '../validators/auth.validator';
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

  const { account, rawToken } = await loginWithPassword(input, req);

  // ASVS V7.2.4: signing in always starts a NEW session -- and the one this
  // browser already held (same account or another) is ended on the server, so
  // an old token copied before the sign-in is worthless afterwards.
  const previous = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof previous === 'string' && previous.length > 0 && (await revokeSessionByRawToken(previous))) {
    logger.security('info', 'auth.session.revoked', { reason: 'new_sign_in', accountId: String(account._id) });
  }

  res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions);
  ok(res, account.toJSON());
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
