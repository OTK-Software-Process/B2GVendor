import { Request, Response } from 'express';
import { registerAccount, loginWithPassword } from '../services/auth.service';
import { revokeSessionByRawToken } from '../services/session.service';
import { created, ok } from '../utils/apiResponse';
import { SESSION_COOKIE_NAME, sessionCookieOptions, clearSessionCookieOptions } from '../config/cookie';
import { RegisterInput, LoginInput } from '../validators/auth.validator';
import { IAccount } from '../models/account.model';

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;

  const { account, rawToken } = await registerAccount(
    {
      name: input.name,
      email: input.email,
      password: input.password,
      type: input.type,
      businessProfile: input.businessProfile
    },
    req
  );

  res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions);
  created(res, account.toJSON());
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;

  const { account, rawToken } = await loginWithPassword(input, req);

  res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions);
  ok(res, account.toJSON());
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];

  if (typeof rawToken === 'string' && rawToken.length > 0) {
    await revokeSessionByRawToken(rawToken);
  }

  res.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions);
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  ok(res, (req.account as IAccount).toJSON());
}
