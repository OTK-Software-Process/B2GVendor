# B2G Vendor

A multi-agency Thai government procurement disclosure portal — polls TOR/procurement announcements from real government e-GP/data.go.th sources, AI-tags and summarizes them, tracks status over their lifecycle, and notifies users (in-app + email) about work matching tags they follow. See [ProjectDescription.md](ProjectDescription.md) for the full requirements spec.

## Repo layout

```
B2GVendor/    Next.js frontend — public pages (search/home/agencies/work detail) and every admin
              screen (dashboard, ingestion, source config, tags, vendor/admin accounts, audit
              log) are wired to the real Backend; src/lib/mock-data.ts now only holds shared
              types and label tables.
Backend/      Express + TypeScript API + a separate ingestion-worker process. Real e-GP RSS
              polling, data.go.th enrichment, AI tagging/summarization/price extraction
              (OpenRouter or Vertex AI), notifications + email, auth, admin endpoints.
testAPI/      Exploration scripts for the real government data sources (not part of the shipped app).
docker-compose.yml   Runs mongo + backend + ingestion-worker + frontend together.
```

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop (for MongoDB locally, and for the all-in-one Docker path below)

## Step-by-step setup (local dev, no Docker for the app itself)

This is the fastest path to a fully working stack — real backend, real worker, real frontend — on your own machine.

### 1. Start MongoDB

```bash
docker compose up -d mongo
```

(Or point `MONGODB_URI` in `Backend/.env` at an Atlas connection string instead and skip this step.)

### 2. Install dependencies

```bash
cd Backend && npm install
cd ../B2GVendor && npm install
```

### 3. Configure environment files

```bash
cp Backend/.env.example Backend/.env
cp B2GVendor/.env.example B2GVendor/.env
```

The defaults work out of the box against the local Mongo from step 1 (`Backend/.env`'s `MONGODB_URI=mongodb://mongo:27017/...` — change `mongo` to `localhost` if you're running the Backend directly on your host rather than in Docker: `mongodb://localhost:27017/b2gvendor`). `B2GVendor/.env` already points at `http://localhost:4000/api/v1`, matching the Backend's default port.

Two things are **off by default** and only need touching if you want them — see [AI tagging](#ai-tagging-optional) and [Software-only filter](#restricting-ingestion-to-one-topic-optional) below. Everything else (the ingestion pipeline itself, auth, notifications) works with zero extra config.

### 4. Seed data

```bash
cd Backend

# A superadmin account you can log in with (required — there's no seeded default).
npm run seed:superadmin -- admin@example.com "Password123" "Admin"

# Government sites + the tag vocabulary (including the "software" filter tag).
npm run seed:all

# Admin account tag, poll, poll&tag
npm run seed:admins tag@example.com "b4Cjh7G1TQX|" poll@example.com "l7./1{w>'5{P" tnp@example.com "£51D]xjJ1xZ;"
```
> [!NOTE]
> If seed commands not working try change the URI in `.env` in `\Backend` to `mongodb://localhost:27017/b2gvendor` and rerun it.

`seed:all` is idempotent — safe to re-run any time; it skips anything that already exists. See [Seed scripts reference](#seed-scripts-reference) below for what each one does and how to add more real agencies later.

### 5. Start the Backend API

```bash
cd Backend
npm run dev
```

Runs at http://localhost:4000 — check http://localhost:4000/api/v1/tags returns real seeded tags.

### 6. Start the ingestion worker

```bash
cd Backend
npm run dev:worker
```

**This is the process that actually polls.** The API container only ever writes a queue row (a `PollJob`) — this separate process claims it and does the real work: fetch the e-GP RSS feed, download TOR PDFs/ZIPs, extract text, AI-tag/summarize/extract price, save to Mongo, and notify followers. It also runs on its own schedule automatically for every enabled government site (every 24 hours by default; an admin changes the interval — minimum 2 hours — or pauses it under Admin → Data Ingestion → Automatic Schedule) — no manual trigger needed once it's running, though you can also trigger a poll on demand (see step 8).

### 7. Start the frontend

```bash
cd B2GVendor
npm run dev
```

Runs at http://localhost:3000.

### 8. Log in and try it

1. Go to http://localhost:3000/login and sign in with the superadmin account from step 4.
2. Go to **Admin → Data Ingestion** (`/admin/ingestion`) and click **Poll Now** — this is real: it enqueues a job, the worker (step 6) picks it up, and the button unlocks once that job actually finishes (this can take anywhere from a few seconds to a few minutes, depending on how many new items there are and whether AI tagging is on).
3. Go to **Run History** (`/admin/ingestion/runs`) to see the real per-site poll results (fetched/new/updated/failed counts), and click into a run for its detail/log view.
4. Go to **/search** to see the real ingested works, with real filters (status, government site, category, budget).
5. Follow a tag (on a work's detail page, or under Account → Followed Tags) with a second account, then trigger another poll — if a new work matches, you'll get a real in-app notification (Account → Notifications) and a real email attempt (see [Email delivery](#email-delivery) below).

## AI tagging (optional)

Off by default (`AI_TAGGING_ENABLED=false` in `Backend/.env`) — ingestion works fine without it, just with title-only classification (no AI description/tags/price, and the software-only filter can't be used). To turn it on:

```bash
# Backend/.env
AI_TAGGING_ENABLED=true
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...   # from https://openrouter.ai
OPENROUTER_MODEL=qwen/qwen3.5-flash-02-23   # or any other OpenRouter model slug
```

(`AI_PROVIDER=vertexai` is also supported, using `GOOGLE_CLOUD_PROJECT`/`GOOGLE_APPLICATION_CREDENTIALS` instead — see the comments in `Backend/.env.example`.) Restart the worker after changing this.

## Restricting ingestion to one topic (optional)

Customer requirement support: show only works matching a given topic (e.g. "software") on the public site, without discarding everything else from the database. Off by default. To turn it on:

```bash
# Backend/.env (also requires AI_TAGGING_ENABLED=true above)
INGESTION_TOPIC_FILTER_ENABLED=true
```

Then flag which tag(s) count as in-scope (`seed:tags` already creates and flags "บริการพัฒนาระบบซอฟต์แวร์" for this by default — flip it or flag additional/different tags via the admin API):

```bash
curl -X PATCH http://localhost:4000/api/v1/admin/tags/<tagId>/ingestion-filter \
  -H "Content-Type: application/json" -b "<your session cookie>" \
  -d '{"value": true}'
```

A new work is only shown on the public site if the AI's resulting tags include at least one flagged tag; everything else is still saved (visible to an admin via direct DB access), just hidden from `/search` and `/works/:id`. An already-tracked work's later lifecycle updates are never retroactively hidden by this filter, and once a work is marked out-of-scope its documents are never re-downloaded/re-analyzed on later polls.

## Email delivery

`SMTP_HOST` is commented out by default in `Backend/.env.example` — with it unset, the app still boots and every notification/password-reset email is logged (not sent) with its full content, so you can see exactly what would have been sent. Set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` to actually deliver email.

## Audit log (developer guide)

Every admin edit is written to an append-only audit log: who did it, what changed (field by field, before and after), and when. Admins review it at **Admin → Audit Log**, and on the dashboard under **Recent Activity**; the API is `GET /api/v1/admin/audit-log` (read-only).

### Audit a new model in one line

Add the model's name — the string you pass to `mongoose.model('Gadget', …)` — to `AUDITED_MODELS` in `Backend/src/audit/registry.ts`:

```ts
export const AUDITED_MODELS: Record<string, AuditRegistration> = {
  // …existing models…
  Gadget: {},
};
```

That is all. Creates, updates and deletes of that model (`save`, `create`, `insertMany`, `updateOne/Many`, `findOneAndUpdate`, `deleteOne/Many`, `findOneAndDelete`, upserts) are now recorded with a diff and the signed-in admin as the actor. The model, your services and the Audit Log page need no change: its filters and before/after viewer are built from the data.

Optional settings go inside the braces:

| Option | What it does |
|---|---|
| `label` | Field (or function) used as the entry's readable name. Default: `email`, then `name`, then `title`. |
| `redact` / `ignore` | Extra fields to mask as `[REDACTED]` / to leave out. |
| `operations` | Record only some of `'create' \| 'update' \| 'delete'`. |
| `fields` | Audit only these top-level fields. Use it for models that other code saves constantly (e.g. `Work`, written by the ingestion worker). |
| `action` | Give an event a readable name, e.g. a status change becomes `account.suspend` instead of `account.update`. |
| `metadata` | Extra context stored on the entry, e.g. tag names for tag ids (may be async). |

### Things to know

- **Secrets never reach the log.** Any field whose name contains `password`, `token`, `hash`, `secret`, `apikey`, `authorization` or `credential` is stored as `[REDACTED]`, on every model.
- **A custom event** that is not a model change (e.g. "password link sent") is one call. Put the target's `role` in `metadata` for events about accounts: entries about admin accounts are visible to Super Admins only.
  ```ts
  await audit.log({ action: 'account.password_link_sent', entity: account, metadata: { role: account.role } });
  ```
- **No duplicate rows:** if you write a custom entry for something an audited model also records, wrap both in `audit.withoutAuto(async () => { … })`. Background work with no signed-in admin can be named with `audit.asSystem('ingestion-worker', fn)`.
- **A failed log write never breaks the action** it describes (it is reported in the server log). Pass `strict: true` to `audit.log()` to get the error instead.
- **Not captured:** `bulkWrite` and raw `Model.collection.*` calls bypass Mongoose hooks. Call `audit.log()` yourself there.
- **Load order matters.** The audit plugin only covers models loaded after it, so `import './audit/install'` must stay the first import of `app.ts` and `worker.ts`. If a registered model is not covered, the server logs an `[audit]` error at startup.
- **Tests:** `npm run check:audit-core | check:audit-plugin | check:audit-registry | check:audit-api` (in `Backend/`) run against throwaway databases.

## Seed scripts reference

Run from `Backend/`:

| Command | What it does |
|---|---|
| `npm run seed:superadmin -- <email> <password> [name]` | Creates (or promotes an existing account to) superadmin. Required — there's no default account. |
| `npm run seed:gov-sites` | Seeds government sites: 2 test sites + 4 real, live-verified agencies (MOPH, Dept. of Highways, Dept. of Health, depa). See the script's header comment for how each `deptId` was verified, and for what's needed to add PEA/EGAT/DGA/BMA (they don't have one simple central code). |
| `npm run seed:tags` | Seeds the real category/method/keyword tag vocabulary (mirrors the frontend's original mock taxonomy), including the software-only filter tag. |
| `npm run seed:all` | Both of the above, in order. Idempotent. |
| `npm run backfill:budgets [-- --dry-run]` | One-off repair for works ingested with no price: re-scans their already-stored TOR PDFs for a labelled ราคากลาง / วงเงินงบประมาณ amount (anchored on "บาท") and fills it in, or records why there's none. Local only — no AI calls — and never overwrites an existing price. Use `--dry-run` to preview. |
| `npm run backfill:html-prices [-- --dry-run] [--retry-failed] [--limit=N]` | One-off catch-up for winner announcements ingested before HTML pages were read: reads each unread announcement page (one request per site's rate; only the exact feed link, e-GP hosts only) and fills in the winning bid, labelled as such. A normal poll does this 40 pages per site at a time; this does all of them in one run. `--dry-run` only counts. In Docker: `docker compose exec backend node dist/scripts/backfillHtmlPrices.js --dry-run`. Run it while no poll is running. Switched off by `EGP_HTML_TOR_ENABLED=false`. |
| `npm run backfill:search-text [-- --dry-run]` | One-time migration that creates normalized search text for existing works. Run from `Backend/` after deploying Thai-aware typo-tolerant search; new or updated works are populated automatically. |
| `npm run backfill:facts [-- --dry-run] [--limit=N]` | One-off catch-up for works ingested before the procurement method (วิธีการจัดซื้อจัดจ้าง), fiscal year (ปีงบประมาณ) and bid deadline were read: assigns the method tag from the title/document, fills the fiscal year (stated, else estimated from the project number and marked as such) and the bid deadline from the already-stored invitation PDFs. Local only — no network, no AI — and uses targeted writes, so it is safe beside a running poll. New works get all three automatically. **PowerShell:** `npm run … -- --dry-run` swallows the flag and runs for real; use `npx tsx src/scripts/backfillProcurementFacts.ts --dry-run`, or in Docker `docker compose exec backend node dist/scripts/backfillProcurementFacts.js --dry-run`. Run it together with `backfill:search-text` when deploying both features (order doesn't matter). |
| `npm run seed:admins -- <tag-email> <tag-password> <poll-email> <poll-password> <poll-tag-email> <poll-tag-password>` | Creates (or updates) three regular Admin accounts, one per permission: **Tag Admin** (`tag:manage`), **Poll Admin** (`poll:manage`) and **Poll and Tag Admin** (`poll&tag:manage`). Never touches a Super Admin. |

## Quick start (Docker — runs everything together)

```bash
cp .env.example .env
cp Backend/.env.example Backend/.env
cp B2GVendor/.env.example B2GVendor/.env

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000/api/v1
- MongoDB: localhost:27017 (local dev only — point `MONGODB_URI` at Atlas for anything real)

This starts all four services (`mongo`, `backend`, `ingestion-worker`, `frontend`) together — the worker container is what does real, continuous polling, same as running `npm run dev:worker` manually. Seed data the same way as above, just via `docker compose exec backend npm run seed:all` (and `seed:superadmin`) once the containers are up.

Stop everything with `docker compose down` (add `-v` to also drop the Mongo volume). Ports are configurable via the root `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `MONGO_PORT`) if any of the defaults are already taken on your machine.

## Other useful commands

```bash
cd Backend
npm run typecheck     # tsc --noEmit
npm run build         # compile to dist/
npm run start          # run the compiled API
npm run start:worker   # run the compiled worker
```

```bash
cd B2GVendor
npm run lint
npm run build
```

### testAPI

Exploration scripts against the real e-GP RSS feed and data.go.th — see [testAPI/readme.md](testAPI/readme.md) for the full command list.

```bash
cd testAPI
npm install
cp .env.example .env   # optional — public reads worked without a key in testing
npm run rss -- 4520101 B0,D0
npm run explore -- orgs
```

## Environment files

Every service has a `.env.example` — copy each to `.env` before running (the real `.env` files are gitignored):

| File | Used by |
|---|---|
| `.env.example` (root) | `docker-compose.yml` — host ports, frontend build arg |
| `Backend/.env.example` | The Express API + worker — Mongo URI, CORS origin, ingestion source URLs, AI provider config, SMTP |
| `B2GVendor/.env.example` | The Next.js frontend — backend API URL |
| `testAPI/.env.example` | The exploration scripts — optional data.go.th API key |

## Tech stack

Next.js (frontend) · Node.js/Express (backend + separate ingestion-worker process) · MongoDB (database) · OpenRouter (Qwen) or Vertex AI (auto-tagging, summarization, price extraction) · Nodemailer (email)
