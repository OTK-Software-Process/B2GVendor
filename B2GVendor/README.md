# B2G Vendor — frontend

The Next.js 16 website for B2G Vendor: the public pages (home, search, agencies, work detail), the
account pages, and every admin screen. It has no data of its own: everything comes from the Backend
API. Setup for the whole stack (database, API, worker, seed data) is in the
[root README](../README.md).

## Run it

```bash
cp .env.example .env     # NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
npm install
npm run dev              # http://localhost:3000 (the Backend must be running)
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm run start` | Production build, then serve it |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Playwright browser tests in `tests/e2e/` (run `npx playwright install chromium` once first) |

## Environment

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API address the **browser** calls. Fixed at build time, and the only other origin the Content Security Policy allows. |
| `API_INTERNAL_URL` | Optional: the API address the **server** uses when it renders a page, where the browser's address does not work (inside Docker). Falls back to `NEXT_PUBLIC_API_URL`. |

## Where things are

| Path | What is there |
|---|---|
| `src/app/` | The routes. Public pages fetch their data on the server, so works and their status are in the HTML; account and admin pages call the API from the browser. `csp-report/` receives Content Security Policy violation reports. |
| `src/proxy.ts` | Builds the Content Security Policy for every request with a fresh nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`). |
| `next.config.ts` | The other security headers: Referrer-Policy, Permissions-Policy, X-Frame-Options, Cross-Origin-Opener-Policy, and HSTS in production. |
| `src/lib/` | API clients (`api.ts` in the browser, `serverApi.ts` on the server), mapping of API responses to view types (`backend.ts`), shared types and label tables (`mock-data.ts`; no mock data is served), and helpers. |
| `src/components/`, `src/context/` | UI components and the signed-in account state. |
| `tests/e2e/` | Playwright tests. |

How the pieces fit together is in [docs/Architecture.md](../docs/Architecture.md), and the security
headers and cookies in [docs/Security.md](../docs/Security.md).

> This Next.js version differs from older ones. Read the guides in `node_modules/next/dist/docs/`
> before changing framework-level code (see `AGENTS.md`).
