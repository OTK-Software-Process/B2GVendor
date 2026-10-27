import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

// CSRF protection for a cookie-authenticated JSON API.
//
// The attack: a page on another site makes the victim's browser send a request
// to this API, and the browser attaches the victim's session cookie. SameSite=Lax
// stops that for most cases, but not all (a same-site sibling domain, and it is
// gone entirely with COOKIE_SAMESITE=none), so every request that CHANGES data
// must pass two independent checks:
//
//   1. WHO sent it. Browsers add `Origin` (and `Sec-Fetch-Site`) to requests, and
//      page script cannot forge either. A request is accepted only if
//        - Origin is present and is one of the allowed frontend origins
//          (the same list as CORS, i.e. CORS_ORIGIN), or
//        - Origin is absent and Sec-Fetch-Site says same-origin / none, or
//        - NEITHER header exists: not a browser (curl, a script, a server-to-
//          server call, the test-suite), so there is no victim's browser to abuse.
//      Anything else (another origin, "Origin: null", a cross-site/same-site
//      request with no Origin) is refused with 403.
//   2. WHAT it is. The body must be declared application/json. Forms and
//      text/plain are the "simple" requests a hostile page can send without a CORS
//      preflight, so refusing them (415) forces every cross-site attempt through
//      a preflight, which CORS already denies to unlisted origins. This applies
//      even when there is no body: a body-less cross-site POST has no
//      Content-Type at all, and is exactly such a simple request.
//
// Reads (GET/HEAD) and CORS preflights (OPTIONS) change nothing and pass.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_CONTENT_TYPE = /^application\/json\s*(;.*)?$/i;

export interface CsrfInput {
  method: string;
  origin?: string;
  secFetchSite?: string;
  contentType?: string;
}

export type CsrfVerdict =
  | { allowed: true }
  | { allowed: false; error: 'CSRF_BLOCKED' | 'UNSUPPORTED_MEDIA_TYPE'; reason: string };

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/** The whole decision, as a pure function (so every combination can be tested). */
export function evaluateCsrf(input: CsrfInput, allowedOrigins: readonly string[]): CsrfVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { allowed: true };

  // 1. who sent it
  if (input.origin !== undefined) {
    const allowed = allowedOrigins.some(entry => normalizeOrigin(entry) === normalizeOrigin(input.origin as string));
    if (!allowed) return { allowed: false, error: 'CSRF_BLOCKED', reason: `Origin "${input.origin}" is not an allowed origin` };
  } else if (input.secFetchSite !== undefined) {
    const site = input.secFetchSite.toLowerCase();
    if (site !== 'same-origin' && site !== 'none') {
      return { allowed: false, error: 'CSRF_BLOCKED', reason: `Sec-Fetch-Site is "${site}" and there is no Origin to check` };
    }
  }

  // 2. what it is
  if (!input.contentType || !JSON_CONTENT_TYPE.test(input.contentType.trim())) {
    return { allowed: false, error: 'UNSUPPORTED_MEDIA_TYPE', reason: `Content-Type is "${input.contentType ?? '(none)'}", not application/json` };
  }

  return { allowed: true };
}

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export function csrfProtection(allowedOrigins: readonly string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const verdict = evaluateCsrf(
      {
        method: req.method,
        origin: single(req.headers.origin),
        secFetchSite: single(req.headers['sec-fetch-site']),
        contentType: single(req.headers['content-type'])
      },
      allowedOrigins
    );

    if (verdict.allowed) {
      next();
      return;
    }

    // Worth knowing about: either a misconfigured frontend origin, or an attack.
    logger.warn('csrf', `${req.method} ${req.originalUrl.split('?')[0]} refused: ${verdict.reason}`);
    next(verdict.error === 'CSRF_BLOCKED' ? AppError.csrfBlocked() : AppError.unsupportedMediaType());
  };
}
