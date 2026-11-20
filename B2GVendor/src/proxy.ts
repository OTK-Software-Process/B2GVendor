import { NextResponse, type NextRequest } from 'next/server';

// The Content-Security-Policy for every page, built per request with a fresh
// nonce (ASVS V3.4.3). Next.js reads the nonce from this request header while
// it renders and puts it on its own <script> tags; a script without it -- one
// an attacker managed to inject into the HTML -- does not run. 'strict-dynamic'
// lets those trusted scripts load the rest of the app's chunks.
// See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
//
// Every page is rendered per request for this (the root layout awaits
// connection()); the public pages already were.

const isDev = process.env.NODE_ENV === 'development';

// The browser talks to exactly one other origin: the Backend API. Same value
// lib/api.ts and lib/backend.ts use; NEXT_PUBLIC_API_URL is fixed at build time.
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').origin;

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only for React's dev tooling, never in a build.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes (React style={...}) cannot carry a nonce; styles
    // cannot run code, so they stay allowed.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // 'self' covers Next's own RSC/prefetch requests and the dev HMR socket.
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    // No <base> element may change where relative URLs point.
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Where violations are reported (ASVS V3.4.7): report-to for current
    // browsers (endpoint named in the Reporting-Endpoints header, next.config.ts),
    // report-uri for the ones that only know the older form.
    'report-uri /csp-report',
    'report-to csp-endpoint',
    // Only when the API is served over HTTPS -- on a plain-http stack (docker
    // compose on localhost) it would rewrite the API calls to https and break them.
    ...(apiOrigin.startsWith('https:') ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: not the build's static files, images, the favicon, or the
    // CSP report endpoint itself -- and not next/link prefetches.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|csp-report).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
