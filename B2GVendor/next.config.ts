import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// The Content-Security-Policy is NOT here: it carries a fresh nonce on every
// request, so it is set per request in src/proxy.ts.
const securityHeaders = [
  // Links out to e-GP carry our origin only, never the page path/query.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these browser features; no embedded page may either.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()",
  },
  // frame-ancestors in the CSP for current browsers; X-Frame-Options for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A page opened from ours (or one that opened ours) gets no handle on this
  // window (ASVS V3.4.8). The app opens no pop-ups that need one.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The endpoint the CSP's report-to directive names (src/app/csp-report/route.ts).
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/csp-report"' },
  // HTTPS only, for a year (ASVS V3.4.1). Sent by production builds only; a
  // browser ignores it on a plain-http response (docker compose on localhost),
  // so it only takes effect once the site is really served over HTTPS.
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
