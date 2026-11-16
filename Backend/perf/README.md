# Performance and load tests

Targets (SRS / ProjectDescription NFR-N4.2, NFR-G2, Notification Timeliness):

| Requirement | How it is measured | Command |
|---|---|---|
| Search p95 ≤ 1.5 s | k6 `perf/k6/search.js`: the search page's typical query mix (Thai free text incl. typos, text + site, site + status, a tag; sorted by date / budget / deadline; pages 1–5), 5 searches/s for 60 s | `npm run perf -- search` |
| Concurrent Poll Now behaves correctly | k6 `perf/k6/poll-now.js`: 30 admins press Poll Now at the same instant → exactly one 201, 29 × 409, nothing else; afterwards exactly one PollJob row | `npm run perf -- poll` |
| Logins (bcrypt, 12 rounds) don't slow other requests to a crawl | k6 `perf/k6/login-load.js`: 20 browse requests/s alone, then the same while 10 sign-ins/s arrive (each from its own client address); browse p95 must stay < 1 s and sign-ins must succeed | `npm run perf -- login` |
| Instant notifications within ~5 min of the poll | `tests/integration/notification-latency.check.ts` (part of `npm test`): a real poll brings 10 new works to a site 150 vendors follow → 1,500 emails to an SMTP server that takes 60 ms per message; the last must be accepted ≤ 5 min after Poll Now | `npm run check:notify-latency` |
| Public pages interactive ≤ 2.5 s on a mid-range phone over 4G | Lighthouse 12.8 mobile defaults (emulated Moto G Power class phone, 4× CPU slowdown, Slow 4G 150 ms RTT / 1.6 Mbps), median Time to Interactive of 3 runs for `/`, `/search`, `/search?q=…`, `/agencies`, `/works/:id` — simulated (Lighthouse's model) or with the throttling really applied, over the local HTTP/1.1 server or HTTPS/HTTP/2 as in production | `npm run perf:lighthouse` |

## Running

`npm run perf` does everything for the k6 tests in one go:

1. starts a throwaway MongoDB (a `mongo:7` container on a random port, data in RAM, removed afterwards; or `PERF_MONGODB_URI`);
2. seeds a realistic data set (`perf/seed.ts`): the 7 launch sites, ~70 tags, **20,000 works** (`PERF_WORKS`) with Thai titles/descriptions, statuses, budgets, deadlines, TOR entries, 300 vendors with follows, 30 Poll Admins with sessions;
3. starts the API in **production mode** on port 4100 (`PERF_PORT`), never touching the dev stack on 4000, with SMTP off, AI off and the government feeds unreachable — a fresh API process per script, and queries a previous script left running in MongoDB are killed first;
4. runs k6 (a local `k6` binary if installed, otherwise the `grafana/k6:0.54.0` image) and exits non-zero if a threshold fails.

Knobs: `PERF_RATE` (searches/s, default 5), `PERF_DURATION` (default 60s), `PERF_LOGIN_RATE` (default 10), `PERF_BROWSE_RATE` (default 20).

Lighthouse needs the frontend running against seeded data:

```bash
npm run perf -- --serve                     # seeded API on :4100, keeps running
# in B2GVendor/: build against it and start the production server on :3100
NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1 npm run build
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
PORT=3100 node .next/standalone/server.js
npm run perf:lighthouse                     # simulated, local HTTP/1.1 (strictest)
PERF_LIGHTHOUSE_THROTTLING=devtools npm run perf:lighthouse   # phone/4G limits really applied
npm run perf:h2-proxy                       # HTTPS + HTTP/2 on :3443 in front of :3100 (like production)
PERF_WEB_URL=https://localhost:3443 PERF_LIGHTHOUSE_INSECURE=1 npm run perf:lighthouse
```

Why three: Lighthouse's default *simulation* estimates the phone/4G timings from an unthrottled load, and it charges every request that started before the first paint to that paint. Locally the JavaScript arrives instantly and runs before the first paint, so the whole ~180 KB bundle (10 requests, queued on 6 HTTP/1.1 connections) lands in the estimate even when the browser actually painted the server-rendered page at once. *DevTools* throttling measures what a throttled browser really does. Production is served over HTTPS, where reverse proxies and CDNs speak HTTP/2 (one multiplexed connection); the local Next.js server only speaks HTTP/1.1, hence `perf/h2-proxy.ts` (self-signed certificate, local testing only).

Results (k6 summaries, Lighthouse JSON, API log) go to `perf/.state/results/` (git-ignored).

## Results — 2026-11-16, 12-core Windows 11 dev machine, Docker Desktop

| Test | Result | Verdict |
|---|---|---|
| Search, 5/s, typical mix, 20,000 works | p95 **582 ms**, p99 632 ms, 0 errors | PASS |
| 30 simultaneous Poll Now | 1 × 201, 29 × 409, 0 other, p95 175 ms, 1 PollJob | PASS |
| 10 sign-ins/s while browsing | browse p95 **42 ms → 43 ms** during sign-ins, 100 % sign-ins OK | PASS |
| Instant notifications | 1,500 emails, last one **30.7 s** after Poll Now (worst case incl. 5 s claim wait) | PASS |
| Pages interactive on mid-range phone / 4G — HTTPS/HTTP/2 as in production, simulated | all 5 pages **2.11 s** (scores 98–99) | PASS |
| … with the phone/4G limits really applied (DevTools), local HTTP/1.1 | `/` 2.42 s, `/search` 2.46 s, `/search?q=` 2.45 s, `/agencies` 2.46 s, `/works/:id` 2.44 s | PASS (thin margin) |
| … simulated, local HTTP/1.1 (strictest) | `/` 2.50 s, `/search` 2.59 s, `/search?q=` 2.64 s, `/agencies` 2.72 s, `/works/:id` 2.72 s (was 3.3–3.6 s) | 1 of 5 |

What these tests found and what was changed:

- **Logins blocked the whole API.** bcryptjs is pure JavaScript; each 12-round compare is ~200 ms of CPU on Node's one main thread. Same load (10 sign-ins/s + 20 browse/s), measured directly: browse p95 **23.9 s** and sign-in p95 35 s before → **40 ms** and 263 ms after. Fix: `src/utils/passwordHasher.ts` runs hashing/comparing in a small worker-thread pool (same algorithm, cost and hash format; `PASSWORD_HASH_WORKERS` sets the pool size, `0` = old behaviour).
- **Typo-tolerant search was slow.** The search regex had ~3 variants per letter, many starting with a wildcard, so MongoDB tried every variant at every character of every work, twice per request. Now only the variants that can match something extra are kept, merged into a prefix tree: a Thai query went from ~1.6 s to ~0.17 s per scan, a Latin one from ~0.85 s to ~0.03 s, **identical matches** (checked on all 20,000 seeded works). Single-request "คอมพิวเตอร์" went from 1.8 s to well under 0.5 s.
- **Two admins clicking Poll Now at the same instant could both get a job.** Reproduced: on a warm connection pool 12 simultaneous enqueues created **12 jobs**. A unique "manual lock" on PollJob now guarantees exactly one (`check:ingestion` and `poll-now.js` cover it).
- **Instant emails were sent one at a time** inside the poll; they now go out a few at a time (`EMAIL_SEND_CONCURRENCY`, default 5): 71.6 → 17.1 ms per email at 60 ms SMTP latency, i.e. ~17,500 follower × new-work pairs fit in 5 minutes.
- **Pages:** `favicon.ico` was the 1980 × 1980 logo (889 KB) and was downloaded at high priority, pushing every page to ~7.8 s; it is now a 5.8 KB 16/32/48 px icon (~7.8 s → ~3.4 s). GET requests no longer send a `Content-Type` header, which had made every API call wait for a CORS preflight round trip.
- **Pages showed their content only after ~180 KB of JavaScript and then an API call.** `/`, `/search`, `/agencies` and `/works/:id` now fetch their first data on the server (`B2GVendor/src/lib/serverApi.ts`, 1.5 s timeout, falls back to loading in the browser) — the works, results, sites and work detail are in the HTML, which also helps search engines (NFR-N4.5). Search uses one URL → query mapping on both sides (`lib/searchQuery.ts`), so the client only fetches when the URL asks for something new. Also: the navbar no longer requests `/account/profile` for visitors (a guaranteed 401), the tag list and site list are loaded once the browser is idle, the mono font is the system one (no 23 KB download), and both logos share one image request. In Docker the frontend reaches the API at `API_INTERNAL_URL` (`http://backend:4000/api/v1`, set in docker-compose).

Known limits / follow-ups:

- **Page load margin.** Over HTTP/2 (production) the pages have ~0.4 s to spare; with real throttling over HTTP/1.1 only ~0.05 s, and Lighthouse's strict simulation over HTTP/1.1 still puts 4 of 5 pages at 2.6–2.7 s. What is left is the framework's own JavaScript (React + Next.js runtime ≈ 116 KB of the 180 KB); trimming app code further or serving the site without HTTP/2 would move these numbers. API responses are not gzip-compressed yet (only small client-side calls remain after first paint).
- **Search capacity.** Search is a regex scan of every work (two scans per request, up to four for budget/deadline sorts). On this machine the typical mix holds p95 < 0.7 s up to ~8 searches/s; at 10–20/s MongoDB's 12 cores saturate and latency runs away. Beyond that it needs a real search index (NFR-N4.1 already asks for a search engine with Thai tokenization).
- With k6 in Docker Desktop, roughly 1 % of new connections to `host.docker.internal` time out before reaching the API (`dial: i/o timeout`). Those requests are re-sent and counted as `connection_retries`, not as server errors; a local k6 binary avoids it.
