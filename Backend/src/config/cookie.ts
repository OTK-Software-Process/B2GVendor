import { CookieOptions } from 'express';
import { env, isProduction } from './env';

export const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME;

export const SESSION_TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/'
};

export const sessionCookieOptions: CookieOptions = {
  ...baseCookieOptions,
  maxAge: SESSION_TTL_MS
};

export const clearSessionCookieOptions: CookieOptions = { ...baseCookieOptions };
