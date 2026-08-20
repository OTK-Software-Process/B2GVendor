# B2G Vendor — Requirements Specification (Side Project) — Revised

**System:** Multi-agency Thai government procurement disclosure portal — a **read-only disclosure + notification portal**. Launch sites: **BMA** (Bangkok Metropolitan Administration), **Department of Highways**, **PEA** (Provincial Electricity Authority), **EGAT** (Electricity Generating Authority of Thailand), **สำนักงานปลัดกระทรวงสาธารณสุข** (Office of the Permanent Secretary, Ministry of Public Health), **depa** (Digital Economy Promotion Agency), and **DGA** (Digital Government Agency) — with more sites addable later without a redeploy.
**Nature of system:** It does **not** run bidding, deals, or announcement publishing. It **ingests** procurement/TOR data from each connected government site via the official open-data API (**`api.data.go.th`**) — no scraping — stores it, shows **status**, **notifies** users about relevant new work, and provides **better search** across every connected site in one place.
**Ordering:** New features first, existing features second, global NFS last.

## Data flow (mental model)
```
Government sites (BMA, Dept. of Highways, PEA, EGAT, MOPH, depa, DGA, …)
        │  via api.data.go.th — admin-controlled: manual or scheduled poll, per site
        ▼
   Ingestion pipeline  ──► normalize + upsert ──► Local data store (works, TOR, status)
        │                                               │
        │ change detection                              ├─► Search index (better search)
        ▼                                               ├─► Status display (search + detail)
  Notification engine ──► users with matching interests └─► Document store (TOR files)
```
The **poll is the heartbeat**: it drives status updates, "new work" notifications, and search freshness — for every connected government site.

**Actors**
- **Public visitor** — browses/searches disclosure data across all connected sites, no login.
- **Registered user** — account holder who sets interest topics (including specific government sites) and receives notifications.
- **Admin** — triggers/schedules polling, monitors runs, manages the tag vocabulary, manages vendor accounts, reviews the audit log.
- **Super Admin** — everything Admin can do, plus **source configuration**: which government sites are polled (add a new site, enable/disable one, point it at its `api.data.go.th` dataset), and each site's scope/request-rate. Split out as its own tier because a bad source-config change can affect data integrity for everyone, not just the person making it.
- **System** — API poller (per government site), scheduler, change-detector, notification engine, search indexer.

---

# PART A — NEW FEATURES

---

## N1. Admin-controlled TOR data ingestion (API polling across multiple government sites)

> The site has no native data of its own; TOR and project data are pulled from **each connected government site** (BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA, and any future site an admin adds) via the official **`api.data.go.th`** open-data API — **no scraping**. An admin can **poll on demand** or **schedule interval polling**, per site.

### User Stories
- **US-N1.1** — As an admin, I want to **trigger a data pull manually ("Poll now")** for one or all sites, so that I can refresh TOR/project data immediately when needed.
- **US-N1.2** — As an admin, I want to **set a recurring poll interval** (e.g. every 30 min / hourly / daily), so that data stays current without manual work.
- **US-N1.3** — As an admin, I want to **see the result of each poll run, broken down by government site** (new items, updated items, errors, duration), so that I can trust the data and catch failures at any one source.
- **US-N1.4** — As an admin, I want to **manage which government sites are polled** (add a new site, enable/disable one, adjust its scope — categories / date range), so that I control what's ingested and the list can grow as new organizations come online.
- **US-N1.5** — As an admin, I want a **failed poll to retry and alert me**, so that an outage or change at any one government site doesn't silently break the rest of the portal.

### Functional Specs
- **FR-N1.1** **Manual poll:** an admin action immediately runs an ingestion job — against one site or all enabled sites — and reports results.
- **FR-N1.2** **Scheduled poll:** admin-configurable interval (cron-style or presets), per site. Scheduler runs jobs automatically; can be paused/resumed.
- **FR-N1.3** **API client** fetches from each configured government site via `api.data.go.th`: work/project records + metadata (title, publishing government site, agency/department, method, budget, dates, **status**) and **TOR documents/attachments** where the dataset provides them.
- **FR-N1.4** **Normalize + upsert:** records from every configured site are mapped to one common local schema and **upserted by a stable key** (e.g. project/announcement ID, scoped per site) so re-polling updates rather than duplicates.
- **FR-N1.5** **Change detection:** the pipeline flags (a) brand-new works and (b) changed fields (esp. **status**), for any connected site. New/changed items emit events consumed by notifications (N3) and search (N4).
- **FR-N1.6** **TOR file handling:** documents are downloaded, deduplicated (hash), stored, and linked to the work; existing files aren't re-downloaded unnecessarily.
- **FR-N1.7** **Run history/log:** each poll records, per government site, start/end time, counts (fetched / new / updated / skipped / failed), and errors. Viewable in the admin panel, filterable by site.
- **FR-N1.8** **Resilience:** retries with backoff on transient failures; a run failure is logged and alerted; a failure isolated to one government site doesn't corrupt already-ingested data or block polling of the others.
- **FR-N1.9** **Source config:** **Super Admin** manages the list of government sites to poll — each entry has a name, its `api.data.go.th` dataset/endpoint ID, scope filters, an enabled/disabled toggle, and a request-rate limit. New sites can be added without code changes; regular Admins can see which sites exist but can't add, remove, or repoint one. Concurrency is a fixed internal safety limit, not exposed as a setting to anyone.
- **FR-N1.10** **Concurrency guard:** a manual poll and a scheduled poll for the same site cannot run destructively at the same time (locking / queueing).

### NFS
- **NFR-N1.1 (API etiquette / compliance)** Respect each government site's `api.data.go.th` rate limits, API key quota, and terms of use; throttle requests per site. Access only public disclosure datasets.
- **NFR-N1.2 (Robustness to source changes)** Each government site's response mapping is isolated in its own adapter, since dataset schemas differ by organization; on a mapping failure, skip + log the item rather than crash the whole run.
- **NFR-N1.3 (Idempotency)** Re-running a poll over the same source state produces no duplicates and no duplicate notifications.
- **NFR-N1.4 (Observability)** Metrics + alerting on run success/failure, item counts, and latency; admin notified on repeated failures.
- **NFR-N1.5 (Performance)** Incremental polling (only new/changed since last run where possible) to keep runs fast and light.
- **NFR-N1.6 (Data integrity)** Ingestion is transactional per item; a crashed run resumes cleanly without half-written records.

---

## N2. Unified account

> A single account type for everyone — individual and business alike — instead of separate Personal and SME/SSME logins. There is no prior system to carry over from; every account is created fresh into this model.

### User Stories
- **US-N2.1** — As a returning user, I want **one login** regardless of individual vs. business, so I don't track which type I used.
- **US-N2.2** — As a new user, I want to **register once and optionally add a business profile**, so my identity and company are linked.
- **US-N2.3** — As an admin, I want to **search, add, and suspend or remove vendor accounts**, so I can manage the account base on an ongoing basis, not just at a one-time cutover.

### Functional Specs
- **FR-N2.1** Single `Account` entity; account **type is an attribute** (`individual` / `business`), not a separate login flow.
- **FR-N2.2** Common fields at registration; business fields (tax ID, company name) captured in an **optional business profile** on the same account.
- **FR-N2.3** One unified login form authenticates everyone.
- **FR-N2.4** **Account management:** admins can search, add, suspend/reactivate, and delete vendor accounts directly from an account list. *(There is no legacy Personal/SME/SSME system to migrate from — every account is created directly into the unified model, so a one-time migration tool isn't part of this system.)*
- **FR-N2.5** Password reset, verification, and profile edit operate on the unified account.

### NFS
- **NFR-N2.1 (Security)** Passwords hashed with argon2/bcrypt; weak legacy hashes force a reset.
- **NFR-N2.2 (Compatibility)** Old login/bookmark URLs redirect, not 404.
- **NFR-N2.3 (Auditability)** Every account status change (suspend, reactivate, delete) is logged with actor and timestamp.

---

## N3. Interest topics + new-work notifications

> Users pick interest topics and get notified when the ingestion pipeline brings in matching new work.

### Data model — Interest tags
- A **`Tag`** is a canonical interest topic — a **government site** (e.g. EGAT, PEA), an agency/department within a site, a procurement method, a work category, or a keyword theme — belonging to a **tag group/facet** (`site` | `agency` | `method` | `category` | `keyword`). Tags come from a **controlled, admin-governed vocabulary**, with optional **aliases/synonyms** mapping to one canonical tag (needed because Thai terms fragment, e.g. "ก่อสร้าง" ≈ "งานก่อสร้าง").
- **User ⇄ Tag = many-to-many.** A user **holds 1..N tags**; each tag is followed by 0..N users. Realized as a `user_tag` join table. *(This is the "user can hold tags, 1-to-many" relation, from the user's side.)* A user can follow an entire government site (e.g. "everything from EGAT") the same way they follow a category or keyword.
- **Work ⇄ Tag = many-to-many.** An ingested work **carries 1..N tags**; each tag applies to 0..N works. Realized as a `work_tag` join table. Tags are assigned to works during ingestion — including its **government site** and agency/department — system-derived from source fields + keyword extraction, and/or curated by admin.
- **Notification match rule:** notify user *U* about work *W* when `tags(W) ∩ tags_followed(U) ≠ ∅` (set intersection).

Entities: `User`, `Tag(tag_group)`, `Work`, join tables `user_tag`, `work_tag`, plus `tag_alias` for synonyms.

### User Stories
- **US-N3.1** — As a registered user, I want to **follow multiple interest tags** (across government site, agency, method, category, keyword), so I hear about all the kinds of work I care about.
- **US-N3.2** — As a registered user, I want to be **notified when newly ingested work carries a tag I follow**, so I don't check manually.
- **US-N3.3** — As a user, I want to **add or remove tags anytime**, so I can tune what I'm subscribed to.
- **US-N3.4** — As a user, I want to **choose channel and frequency** (in-app, email; instant or daily digest), so I control volume.
- **US-N3.5** — As an admin, I want to **create and retire tags, and reassign a work's tags**, so the vocabulary stays clean and each work is correctly categorized.

### Functional Specs
- **FR-N3.1** Users follow interests by **selecting tags** from the controlled taxonomy (grouped by facet). A user may hold **many tags** (`user_tag`); tags addable/removable anytime.
- **FR-N3.2** During ingestion, each work is **assigned 1..N tags** (`work_tag`) — system-derived from its **government site**, agency/method/category, and keyword extraction, optionally admin-curated.
- **FR-N3.3** On the ingestion pipeline's **"new work" event** (from N1), the system computes `tags(W) ∩ tags_followed(U)` and queues notifications for matched users. *(Optionally also on meaningful status changes.)*
- **FR-N3.4** **Tag admin:** create/retire tags and reassign a work's tags. *(No tag-merge tool — duplicate/near-duplicate tags are prevented at creation time and handled by retiring the redundant one, not by merging two tags into one.)*
- **FR-N3.5** Channels: in-app notification center (required) + email (optional); extensible to LINE/SMS.
- **FR-N3.6** Frequency: instant or daily digest (batched).
- **FR-N3.7** Notification includes title, government site, agency, method, budget, status, ingested date, matched tag(s), and a deep link.
- **FR-N3.8** In-app read/unread state + unread badge.
- **FR-N3.9** Deduplication: at most one notification per work per user, even when several followed tags match or the work is re-polled.
- **FR-N3.10** Pause/edit/delete followed tags; email unsubscribe works without login.

### NFS
- **NFR-N3.1 (Timeliness)** Instant notifications dispatched within ~5 min of the poll that discovered the work.
- **NFR-N3.2 (Scalability)** Tag-intersection matching + fan-out run async on a queue; indexed join tables so matching is a fast set operation, not a per-user filter scan.
- **NFR-N3.3 (Taxonomy integrity)** Controlled vocabulary with aliases; no orphan/duplicate tags; retiring a tag is atomic and doesn't leave dangling `user_tag`/`work_tag` references.
- **NFR-N3.4 (Deliverability)** Authenticated email (SPF/DKIM/DMARC); bounce handling.
- **NFR-N3.5 (Privacy)** Per-channel opt-in; PDPA-compliant storage of contact + preferences + followed tags.
- **NFR-N3.6 (Idempotency)** Re-processing an ingestion event never double-sends.

---

## N4. Better search + status display

> Improve search substantially and show each work's **status** (derived from ingested data) in results and detail — no manual status management.

### User Stories
- **US-N4.1** — As a searcher, I want **fast, relevant search across titles, metadata, and TOR content**, so I can find work even by terms inside the TOR.
- **US-N4.2** — As a searcher, I want **faceted filters and sorting** (status, government site, agency, method, budget, date), so I can narrow results precisely — including to just one government organization.
- **US-N4.3** — As a searcher, I want to **see each work's status in the results list**, so I can tell open vs. closed/cancelled without opening each one.
- **US-N4.4** — As a searcher, I want **typo tolerance and correct Thai word matching**, so search works despite Thai having no word spacing.
- **US-N4.5** — As a user, I want clear loading / empty / error states, so the site never looks blank or broken.

### Functional Specs
- **FR-N4.1** Full-text search across **title, agency, metadata, and extracted TOR document text**.
- **FR-N4.2** Faceted filters: **status**, **government site**, agency/department, method, budget range, date range — the site/agency/method/category facets **reuse the same tag taxonomy as N3** (one vocabulary powers both search facets and interest follows). Sort by date, budget, closing date. Active-filter chips + result count.
- **FR-N4.2a** From a work or a search facet, a user can **"follow this tag"** in one click, linking search directly to the N3 interest model.
- **FR-N4.3** **Status badge per result row**, color-coded + text-labeled (Thai), reflecting the latest **ingested** status. Same source of truth on search and detail — they never disagree.
- **FR-N4.4** Status values come **from the source data** via the ingestion pipeline (e.g. Planned / Draft TOR / Open for bidding / Cancelled / Awarded-Closed) — no manual editing, no announce action.
- **FR-N4.5** Consistent empty state, loading skeletons, and retryable error state.
- **FR-N4.6** Responsive layout; search usable on mobile.

### NFS
- **NFR-N4.1 (Search quality)** Use a real search engine (Meilisearch / Elasticsearch / OpenSearch, or Postgres FTS) with **Thai tokenization/segmentation** and typo tolerance — critical because Thai has no spaces between words.
- **NFR-N4.2 (Performance)** Results (with status + facets) return in ≤ 1.5 s at p95 for typical queries.
- **NFR-N4.3 (Freshness)** Newly ingested/updated works appear in search within one indexing cycle of a poll.
- **NFR-N4.4 (Accessibility)** WCAG 2.1 AA; status not conveyed by color alone; keyboard + screen-reader support in Thai.
- **NFR-N4.5 (Rendering/SEO)** SSR/pre-render public search + detail pages (the current SPA returns an empty initial HTML), so content and status are indexable.

---

# PART B — EXISTING FEATURES

---

## E1. Browse / list works
- **US-E1.1** — As a visitor, I want to browse the list of disclosed works, so I can see what's available.
- **FR-E1.1** Paginated list of ingested works with basic metadata. *(Status badge + better search added in N4.)*
- **NFR-E1.1** Reasonable list latency; indexed queries.

## E2. View work detail + TOR
- **US-E2.1** — As a visitor, I want to open a work to see full details and its TOR, so I can evaluate it.
- **FR-E2.1** Detail page: title, agency, method, budget, dates, **current status**, and linked TOR/attachments (all from ingested data).
- **NFR-E2.1** Detail content indexable (ties to N4 SSR).

## E3. TOR / document download
- **US-E3.1** — As a visitor, I want to download the TOR and attachments, so I have the official documents.
- **FR-E3.1** Working, HTTPS download links to ingested files.
- **NFR-E3.1** Dead-link monitoring; files served securely.

## E4. Browse by government site / agency
- **US-E4.1** — As a visitor, I want to browse works by government site, then by department/agency within it, so I can follow a specific organization.
- **FR-E4.1** Government site directory (BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA, …) linking to each site's ingested works, drillable further into department/agency where the site has one.

## E5. Basic authentication *(pre-unification baseline — superseded by N2)*
- **US-E5.1** — As a user, I want to register and log in, so I can set interests and get notifications.
- **FR-E5.1** Registration + email verification, login/logout, password reset, sessions.
- **FR-E5.2** (Legacy) Separate Personal vs. SME/SSME paths — *replaced by N2.*
- **NFR-E5.1** Hashed credentials; secure sessions; brute-force protection.

---

# PART C — GLOBAL NON-FUNCTIONAL SPECS

- **NFR-G1 (Availability)** Target uptime ≥ 99.5%; maintenance announced in-app. Ingestion failures must not take the read-only site down.
- **NFR-G2 (Performance)** Core pages interactive in ≤ 2.5 s on mid-range mobile / 4G.
- **NFR-G3 (Security)** HTTPS + valid TLS; OWASP Top 10 protections (esp. injection on search); rate limiting on auth, search, and admin poll endpoints; admin panel behind strong auth + role checks — including an Admin vs. **Super Admin** split for higher-risk settings like source configuration.
- **NFR-G4 (Privacy)** PDPA-compliant handling of user + notification data.
- **NFR-G5 (Accessibility)** WCAG 2.1 AA; full Thai localization.
- **NFR-G6 (Discoverability/SEO)** SSR/pre-render for public content; sitemap + structured data.
- **NFR-G7 (Scalability)** Async workers for ingestion, notification matching, and indexing; horizontally scalable web tier.
- **NFR-G8 (Maintainability)** Per-site API response mapping isolated in its own adapter layer; config-driven site list + schedule; automated tests for ingestion, dedup, and notification matching.
- **NFR-G9 (Observability)** Logging/metrics/alerting across the poll → store → index → notify pipeline; admin-visible, searchable run history and audit log.
- **NFR-G10 (Data integrity)** Single source of truth for status shared by list, search, detail, and notifications; ingestion idempotent and transactional per item.

---

### Notes / assumptions
- **Source dependency (resolved):** the system polls each government site's dataset through the official `api.data.go.th` API rather than scraping HTML. Each site still needs its exact dataset/endpoint ID and field mapping confirmed with `api.data.go.th` before it's onboarded, since coverage and schema can vary by organization.
- **Status vocabulary:** status labels in FR-N4.4 are a baseline; map them to the exact values each site's dataset exposes — they may not be identical across government sites.
- **Legality/compliance:** accessing public procurement disclosure data via `api.data.go.th` still requires respecting each dataset's terms, API key quota, and rate limits (NFR-N1.1).
- **Existing features (Part B)** are inferred from the portal's stated scope; confirm against the live site.
- **Scope changes (previous revision):** account migration (N2) and tag merging (N3) were dropped — there's no legacy system to migrate from, and duplicate tags are handled by retiring the redundant one rather than merging two into one. In their place, admins get ongoing CRUD over vendor accounts and tags directly. Source configuration (N1) is gated behind a **Super Admin** tier, separate from regular Admin, since it controls where the system pulls data from.
- **Scope changes (this revision):** the system moved from single-source scraping (BMA only, via egp2) to **multi-site API polling** via `api.data.go.th`, covering 7 government sites at launch (BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA) with more addable later. The site list itself is now Super Admin-managed data, not hardcoded. **Government site** was added as a first-class tag facet (N3) and search filter (N4), sitting alongside agency/method/category/keyword — so a user can follow or filter by an entire organization, not just its sub-departments.
