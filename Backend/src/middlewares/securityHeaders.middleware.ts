import { RequestHandler } from 'express';
import helmet from 'helmet';

// One year (ASVS V3.4.1), the value browsers' preload lists also expect.
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/**
 * Security headers for every response of this API (it never serves a web page:
 * only JSON and TOR file downloads).
 *
 *   X-Content-Type-Options: nosniff              a browser may not guess a different type
 *                                                for a JSON/PDF response and run it as script
 *   Content-Security-Policy: frame-ancestors 'none'
 *   X-Frame-Options: DENY                        nothing may embed this API in a frame
 *                                                (the legacy twin of the line above)
 *   Strict-Transport-Security                    PRODUCTION ONLY -- see below
 *   X-Powered-By                                 removed (also disabled on the app itself)
 *
 * Helmet's other defaults stay on (Referrer-Policy: no-referrer, Cross-Origin-
 * Resource-Policy / Opener-Policy: same-origin, X-DNS-Prefetch-Control: off,
 * X-Permitted-Cross-Domain-Policies: none, ...). The frontend only reaches this
 * API with CORS-mode fetch() and plain links, which none of them affect.
 *
 * The Content-Security-Policy is deliberately JUST frame-ancestors. A fuller CSP
 * (default-src, object-src ...) protects HTML pages, which this API does not
 * serve, and `object-src 'none'` is known to stop a browser's built-in viewer
 * from opening a downloaded PDF.
 *
 * HSTS tells browsers "only ever use HTTPS for this host". It is sent in
 * production only: in local development the API runs over plain http, and a
 * pinned HSTS entry for localhost would break other local projects.
 */
export function securityHeaders(production: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        // Helmet insists on a default-src unless told this is intentional. It is: see
        // the note above. (frame-ancestors never falls back to default-src anyway.)
        defaultSrc: helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        frameAncestors: ["'none'"]
      }
    },
    frameguard: { action: 'deny' },
    strictTransportSecurity: production ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true } : false
  });
}

// Read-only public data: the same for every visitor, nothing personal in it.
const PUBLIC_READ_PREFIXES = ['/works', '/tags', '/gov-sites'];

/**
 * `Cache-Control: no-store` on every API response except the public reads
 * (ASVS V14.3.2), so a signed-in answer -- an account, a session, an admin list,
 * a sign-in error -- is never kept by the browser cache or a shared proxy, where
 * the next user of the same computer could read it back. Mounted on /api/v1, so
 * `req.path` is relative to it.
 */
export function noStoreExceptPublicReads(): RequestHandler {
  return (req, res, next) => {
    const publicRead =
      (req.method === 'GET' || req.method === 'HEAD') &&
      PUBLIC_READ_PREFIXES.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`));
    if (!publicRead) res.set('Cache-Control', 'no-store');
    next();
  };
}
