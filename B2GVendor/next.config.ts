import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// The browser talks to exactly one other origin: the Backend API. Same value
// lib/api.ts and lib/backend.ts use; NEXT_PUBLIC_API_URL is fixed at build
// time, which is also when these headers are built.
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").origin;

// No nonces: a nonce forces every page to render per request. Next.js's inline
// bootstrap scripts therefore need 'unsafe-inline'; everything else is locked to
// this origin (next/font self-hosts the Google fonts at build time). 'unsafe-eval'
// is only for React's dev tooling.
// See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 'self' covers Next's own RSC/prefetch requests and the dev HMR socket.
  `connect-src 'self' ${apiOrigin}`,
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Only when the API is served over HTTPS -- on a plain-http stack (docker
  // compose on localhost) it would rewrite the API calls to https and break them.
  ...(apiOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Links out to e-GP carry our origin only, never the page path/query.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these browser features; no embedded page may either.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()",
  },
  // frame-ancestors above for current browsers; X-Frame-Options for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
