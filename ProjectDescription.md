# B2G Vendor — Requirements Specification (Side Project) — Revised

**System:** Multi-agency Thai government procurement disclosure portal — a **read-only disclosure + notification portal**. Launch sites: **BMA** (Bangkok Metropolitan Administration), **Department of Highways**, **PEA** (Provincial Electricity Authority), **EGAT** (Electricity Generating Authority of Thailand), **สำนักงานปลัดกระทรวงสาธารณสุข** (Office of the Permanent Secretary, Ministry of Public Health), **depa** (Digital Economy Promotion Agency), and **DGA** (Digital Government Agency) — with more sites addable later without a redeploy.
**Nature of system:** It does **not** run bidding, deals, or announcement publishing. It **polls** procurement/TOR data from each connected government site via **two official sources — no scraping of either**: the **e-GP RSS feed** (`process3.gprocurement.go.th`) for **live** new/updated TOR announcements, and the **`data.go.th`** open-data catalog for **historical/batch** contract-level enrichment (budget, winner) once a project is awarded. The system stores what it ingests, shows **status**, **notifies** users about relevant new work, and provides **better search** across every connected site in one place.
**Target users:** Vendors & contractors, businesses/SMEs, public users (all served by the unified account model in N2), plus government agencies as the publishing side of the data.
**Ordering:** New features first, existing features second, global NFS last.

## Data flow (mental model)
```
Government sites (BMA, Dept. of Highways, PEA, EGAT, MOPH, depa, DGA, …)
        │
        ├─ e-GP RSS feed (process3.gprocurement.go.th)  ── live: new/updated TOR announcements
        │      per site (deptId) × per announce type (draft TOR, invitation, cancel, amend, winner)
        │
        └─ data.go.th open-data catalog                  ── batch: contract/budget/winner, agency lookup
               admin-controlled: manual or scheduled poll, per site, per source
        ▼
   Ingestion pipeline  ──► normalize + upsert ──► Local data store (works, TOR, status)
        │                                               │
        │ change detection                              ├─► Search index (better search)
        ▼                                               ├─► Status display (search + detail)
  Notification engine ──► users with matching interests └─► Document store (TOR files)
```
The **poll is the heartbeat**: it drives status updates, "new work" notifications, and search freshness — for every connected government site. The **RSS feed is what makes a work exist and updates it live**; `data.go.th` only ever enriches an already-ingested work after the fact — it cannot itself discover a new TOR.

**Actors**
- **Public visitor** — browses/searches disclosure data across all connected sites, no login.
- **Registered user** — account holder who sets interest topics (including specific government sites) and receives notifications.
- **Admin** — triggers/schedules polling, monitors runs, manages the tag vocabulary, manages vendor accounts, reviews the audit log.
- **Super Admin** — everything Admin can do, plus **source configuration**: which government sites are polled (add a new site, enable/disable one, point it at its e-GP department code (`deptId`) for the live RSS feed and, where available, its `data.go.th` organization for enrichment), and each site's scope/request-rate. Split out as its own tier because a bad source-config change can affect data integrity for everyone, not just the person making it.
- **System** — pollers (e-GP RSS live feed **and** `data.go.th` batch enrichment, per government site), scheduler, change-detector, notification engine, search indexer.

---

# PART A — NEW FEATURES

---

## N1. Admin-controlled TOR data ingestion (dual-source polling across multiple government sites)

> The site has no native data of its own; TOR and project data are pulled from **each connected government site** (BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA, and any future site an admin adds) via **two official sources — no scraping of either**:
> - The **e-GP RSS feed** (`process3.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml?deptId={id}&anounceType={code}`) — a **live**, no-API-key-required feed of announcements per site (`deptId`) and per type: draft TOR (`B0`), invitation to bid (`D0`), cancellation (`D1`), amendment (`D2`), winner (`W0`), reference price (`15`), procurement plan (`P0`). This is the **essential** source — it is what makes a work exist in the system at all and what drives "new work" detection.
> - The **`data.go.th`** open-data catalog (CKAN-based) — a **historical/batch** source of contract-level records (budget, contract number/dates, winner) published periodically per fiscal period, used only to **enrich** an already-ingested work after award, plus an agency/e-GP-participation lookup dataset. It cannot discover a new TOR on its own.
>
> An admin can **poll on demand** or **schedule interval polling**, per site, per source.

### User Stories
- **US-N1.1** — As an admin, I want to **trigger a data pull manually ("Poll now")** for one or all sites, so that I can refresh TOR/project data immediately when needed.
- **US-N1.2** — As an admin, I want to **set a recurring poll interval** (e.g. every 30 min / hourly / daily), so that data stays current without manual work.
- **US-N1.3** — As an admin, I want to **see the result of each poll run, broken down by government site** (new items, updated items, errors, duration), so that I can trust the data and catch failures at any one source.
- **US-N1.4** — As an admin, I want to **manage which government sites are polled** (add a new site, enable/disable one, adjust its scope — categories / date range), so that I control what's ingested and the list can grow as new organizations come online.
- **US-N1.5** — As an admin, I want a **failed poll to retry and alert me**, so that an outage or change at any one government site doesn't silently break the rest of the portal.

### Functional Specs
- **FR-N1.1** **Manual poll:** an admin action immediately runs an ingestion job — against one site or all enabled sites — and reports results.
- **FR-N1.2** **Scheduled poll:** admin-configurable interval (cron-style or presets), per site. Scheduler runs jobs automatically; can be paused/resumed.
- **FR-N1.3** **e-GP RSS client (primary/live):** for each configured site's `deptId`, polls the e-GP RSS feed across its enabled announce types and extracts, per item, a title, a project identifier, an announce-type label, a publish date, and a link — the link is **either a direct TOR/announcement PDF or an HTML detail page**, and the system must handle both (a direct PDF is stored immediately; an HTML-page link is recorded as a reference, not auto-fetched, to avoid scraping).
- **FR-N1.3a** **`data.go.th` enrichment client (secondary/batch):** periodically fetches each configured site's contract-level dataset (where available) — budget, contract number/dates, winner — and the agency/e-GP-participation lookup dataset, and attaches these facts to the matching already-ingested work by its project identifier. Never creates a new work by itself.
- **FR-N1.4** **Normalize + upsert:** records from every configured site and source are mapped to one common local schema and **upserted by a stable key** (the project identifier, scoped per site) so re-polling updates rather than duplicates, and so a `data.go.th` enrichment record correlates to the same work an earlier RSS item already created.
- **FR-N1.5** **Change detection:** the pipeline flags (a) brand-new works and (b) changed fields (esp. **status**), for any connected site. New/changed items emit events consumed by notifications (N3) and search (N4).
- **FR-N1.6** **TOR file handling:** direct-PDF links from the RSS feed (FR-N1.3) are downloaded, deduplicated (hash), stored, and linked to the work; existing files aren't re-downloaded unnecessarily. HTML-detail-page links are stored as a reference URL only — the document itself is not auto-fetched from an HTML page.
- **FR-N1.7** **Run history/log:** each poll records, per government site, start/end time, counts (fetched / new / updated / skipped / failed), and errors. Viewable in the admin panel, filterable by site.
- **FR-N1.8** **Resilience:** retries with backoff on transient failures; a run failure is logged and alerted; a failure isolated to one government site doesn't corrupt already-ingested data or block polling of the others.
- **FR-N1.9** **Source config:** **Super Admin** manages the list of government sites to poll — each entry has a name, its e-GP department code (`deptId`) for the RSS feed, optionally its `data.go.th` organization identifier for enrichment, scope filters (which announce types to poll), an enabled/disabled toggle, and a request-rate limit. New sites can be added without code changes; regular Admins can see which sites exist but can't add, remove, or repoint one. Concurrency is a fixed internal safety limit, not exposed as a setting to anyone.
- **FR-N1.10** **Concurrency guard:** a manual poll and a scheduled poll for the same site cannot run destructively at the same time (locking / queueing).
- **FR-N1.11** **Link resolution:** each RSS item's link is classified as a direct-PDF or an HTML-detail-page reference before storage, so downstream features (TOR download, admin review) know which works have an immediately-available document versus one that still needs a manual/future resolution step.

### NFS
- **NFR-N1.1 (API etiquette / compliance)** Respect rate limits and terms of use for **both** sources — the e-GP RSS feed (no key required, but still throttled per site) and `data.go.th` (works without a key in testing, but an API key should still be registered and used per its terms). Access only public disclosure data from either.
- **NFR-N1.2 (Robustness to source changes)** Each government site's response mapping is isolated in its own adapter **per source** (RSS's XML/Windows-874-encoded feed vs. `data.go.th`'s JSON CKAN API are structurally different and must not share a parser); on a mapping failure, skip + log the item rather than crash the whole run.
- **NFR-N1.3 (Idempotency)** Re-running a poll over the same source state produces no duplicates and no duplicate notifications, for either source.
- **NFR-N1.4 (Observability)** Metrics + alerting on run success/failure, item counts, and latency, tagged by source; admin notified on repeated failures.
- **NFR-N1.5 (Performance)** Incremental polling (only new/changed since last run where possible) to keep runs fast and light.
- **NFR-N1.6 (Data integrity)** Ingestion is transactional per item; a crashed run resumes cleanly without half-written records.
- **NFR-N1.7 (Correct encoding)** The e-GP RSS feed is Windows-874 (Thai codepage) encoded despite superficially looking like standard XML; the client must decode it explicitly as Windows-874, not assume UTF-8, or every Thai character in the feed is corrupted.

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
- **FR-N3.2** **AI-assisted auto-tagging:** during ingestion, each work is **assigned 1..N tags** (`work_tag`) — system-derived from its **government site** and agency/method (structured fields), plus **AI-based classification/keyword extraction over the Thai-language title and TOR text** for category and keyword tags, optionally admin-curated/overridden afterward.
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
- **NFR-N3.7 (Tagging quality)** AI-assisted tagging (planned: Vertex AI) runs as a best-effort classification step, not a blocking dependency — a model failure or low-confidence result skips AI tags for that item (structured/site/agency tags still apply) rather than failing ingestion; admin-curated tags always take precedence over AI-suggested ones.

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
- **FR-N4.4** Status values are derived **from the e-GP RSS announce-type signal** (e.g. draft TOR → Draft TOR, invitation → Open for bidding, cancellation → Cancelled, winner → Awarded-Closed) — no manual editing, no announce action. `data.go.th` enrichment records carry no status field at all, so they never override a work's status, only its budget/winner facts.
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
- **Source dependency (resolved, verified live — two sources, not one):** the system pulls from **both** sources confirmed live during testing, not `data.go.th` alone.
  - **e-GP RSS feed** (`process3.gprocurement.go.th`) — confirmed live, no API key needed; `deptId` genuinely filters to one agency; announce-type codes (`B0`/`D0`/`D1`/`D2`/`W0`/`15`/`P0`) confirmed live; each item's link resolves to **either a direct PDF (confirmed via a real `HEAD` request: `content-type: application/pdf`) or an HTML detail page — mixed even within the same announce type and agency**, so the ingestion client must classify each link rather than assume one shape.
  - **`data.go.th`** open data catalog (CKAN-based; confirmed live, public reads work without an API key) hosts **620 government organizations publishing 42,853 datasets in total**; **75 of those organizations publish procurement/TOR-related data** (288 datasets combined); **all 7 launch sites — BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA — are confirmed present** among those 75, each resolvable to an exact organization identifier. Its procurement datasets are **periodic batch drops** (one per month/fiscal year), not a live filterable endpoint, and carry **no status field and no TOR/PDF link** — only budget, contract dates, and winner, once awarded. It therefore can only enrich a work the RSS feed already created; it cannot discover a new TOR.
  - Each site still needs its exact `deptId` (RSS) and, where used, `data.go.th` organization/resource ID confirmed before onboarding, since coverage and schema vary by organization.
- **Open risk — no `deptId` master list:** there is no published master list mapping every government agency to its e-GP `deptId`. For the 7-site launch scope this is manageable (collect the 7 IDs manually); if scope later grows toward national coverage, building that list is real, unscoped effort — not part of the API integration work itself.
- **Status vocabulary:** status labels in FR-N4.4 are a baseline derived from RSS announce types; map them to the exact values each site's feed exposes — they may not be identical across government sites.
- **Legality/compliance:** accessing public procurement disclosure data via either source still requires respecting each source's rate limits and terms of use (NFR-N1.1); the RSS feed needs no registration, `data.go.th` should still be used with a registered API key even though public reads worked without one in testing.
- **Existing features (Part B)** are inferred from the portal's stated scope; confirm against the live site.
- **Scope changes (previous revision):** account migration (N2) and tag merging (N3) were dropped — there's no legacy system to migrate from, and duplicate tags are handled by retiring the redundant one rather than merging two into one. In their place, admins get ongoing CRUD over vendor accounts and tags directly. Source configuration (N1) is gated behind a **Super Admin** tier, separate from regular Admin, since it controls where the system pulls data from.
- **Scope changes (previous revision):** the system moved from single-source scraping (BMA only, via egp2) to **multi-site API polling** via `data.go.th`, covering 7 government sites at launch (BMA, Department of Highways, PEA, EGAT, สำนักงานปลัดกระทรวงสาธารณสุข, depa, DGA) with more addable later. The site list itself is now Super Admin-managed data, not hardcoded. **Government site** was added as a first-class tag facet (N3) and search filter (N4), sitting alongside agency/method/category/keyword — so a user can follow or filter by an entire organization, not just its sub-departments.
- **Scope changes (previous revision):** aligned the spec with the pitch deck and live testing — corrected the polling host from the earlier placeholder `api.data.go.th` to the actual working host, **`data.go.th`** (`api.data.go.th` is only the sign-up portal page, not a callable API); added the verified organization/dataset counts as evidence for the source-dependency assumption; and made **AI-assisted auto-tagging** (planned: Vertex AI) an explicit part of N3's ingestion tagging step (FR-N3.2, NFR-N3.7) rather than an unnamed "keyword extraction," matching its weight as a standalone cost/effort line item.
- **Scope changes (this revision):** corrected an over-simplification from the previous revision — ingestion is **not** `data.go.th` alone. Added the **e-GP RSS feed** (`process3.gprocurement.go.th`) as the primary, live source of new/updated TOR data (N1: FR-N1.3, FR-N1.3a, FR-N1.11, NFR-N1.7), with `data.go.th` correctly repositioned as a secondary, batch source used only for post-award enrichment. Updated FR-N4.4 to reflect that status comes from the RSS announce-type signal, not from `data.go.th` (which has no status field at all). Added the RSS feed's mixed direct-PDF/HTML-page link behavior and the missing `deptId` master list as newly-identified, real open risks.
