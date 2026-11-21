import { CookieOptions } from 'express';
import { env, isProduction } from './env';

// In production the session cookie always carries the __Host- prefix (ASVS
// V3.3.1, V3.3.3). A browser then accepts it only if it is Secure, has Path=/
// and NO Domain attribute -- so it can never be set by, or sent to, a sibling
// subdomain, and never travels over plain http. The options below satisfy all
// three. In development (plain http) the bare name is kept: __Host- needs Secure.
export function sessionCookieName(configured: string, production: boolean): string {
  if (!production || configured.startsWith('__Host-')) return configured;
  return `__Host-${configured.replace(/^__Secure-/, '')}`;
}

export const SESSION_COOKIE_NAME = sessionCookieName(env.SESSION_COOKIE_NAME, isProduction);

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
