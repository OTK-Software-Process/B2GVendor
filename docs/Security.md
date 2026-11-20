# Security

How B2G Vendor protects its data: what it talks to, what cryptography and secrets it holds, who may
read or change which field, how each class of data is protected and how long it is kept, and which
parts of the system are costly or dangerous. Each section names the OWASP ASVS 5.0 requirement it
answers. The plan and its status live in `OWASP_ASVS_5.0_B2GVendor_Plan.xlsx` at the repository root.

✅ means in place in the code on `main`; ⬜ means planned and not built yet.

## Contents

1. [External connections](#1-external-connections) — V13.1.1
2. [Cryptography inventory](#2-cryptography-inventory) — V11.1.2
3. [Keys and secrets](#3-keys-and-secrets) — V11.1.1
4. [Sessions](#4-sessions) — V7.1.1, V7.1.2
5. [Field-level access rules](#5-field-level-access-rules) — V8.1.2
6. [Data classification](#6-data-classification) — V14.1.1
7. [Protection requirements per class](#7-protection-requirements-per-class) — V14.1.2, V14.2.4
8. [Retention schedule](#8-retention-schedule) — V14.2.7
9. [Costly functionality](#9-costly-functionality) — V15.1.3
10. [Dangerous functionality](#10-dangerous-functionality) — V15.1.5
11. [Dependencies](#11-dependencies) — V15.1.1, V15.1.2, V15.1.4, V15.2.1
12. [Password policy](#12-password-policy) — V6.1.2, V6.2.5, V6.2.9, V6.2.11, V6.3.7

---

## 1. External connections

Every connection the application makes or accepts (ASVS V13.1.1). "API" is the Express backend,
"worker" the ingestion worker, "website" the Next.js server.

| From → to | Address | Protocol | Why | What is sent | Credential | Limits |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Browser → website | the site's host | HTTPS in production | Pages | Requests, nothing secret in URLs (§7) | — | — |
| Browser → API | `NEXT_PUBLIC_API_URL` | HTTPS in production, CORS from `CORS_ORIGIN` only | JSON API, TOR downloads | Session cookie, JSON bodies | Session cookie | Rate limits (API.md §2) |
| Website → API | `API_INTERNAL_URL` | HTTP on the internal network | Public data for server-rendered pages | Public queries, the visitor's address in `X-Forwarded-For` | None (public reads only, no cookies) | 1.5 s per request |
| Browser → website | `/csp-report` | HTTPS in production | Content-Security-Policy violation reports | The report (page URL, blocked URL, directive) | — | 64 KB per request, 300 log lines a minute |
| Worker → e-GP RSS feed | `process3.gprocurement.go.th` (`EGP_RSS_BASE_URL`) | HTTPS | New and changed announcements | A department code and announcement type | — | 30 s per request (`INGESTION_REQUEST_TIMEOUT_MS`) |
| Worker → e-GP announcement pages | `*.gprocurement.go.th` only | HTTPS (an `http://` link is upgraded) | The price on a winner announcement | GET of the exact URL the feed gave | — | Host allow-list on every redirect, 5 redirects, 2 MB, 1 request a second |
| Worker → TOR document links | whatever the feed links to ⬜ allow-list (V1.3.6) | HTTPS (e-GP links upgraded) | Download TOR PDFs / ZIPs | GET | — | 100 MB, 120 s, ZIP limits (§9) |
| Worker / API → data.go.th | `data.go.th` (`DATA_GO_TH_BASE_URL`) | HTTPS | Contract datasets, the department directory | CKAN queries | Optional `DATA_GO_TH_API_KEY` | 30 s per request |
| API → Have I Been Pwned | `api.pwnedpasswords.com` | HTTPS | Breached-password check at sign-up, change and reset | The first 5 hex characters of the password's SHA-1, nothing else | — | Refuses the password change if unreachable |
| Worker → AI provider | `openrouter.ai` or Google Vertex AI (`asia-southeast1`) | HTTPS | Tags, summary and price of a TOR document | The title, at most 8,000 characters of TOR text, the tag list | `OPENROUTER_API_KEY` or a Google service account | Off unless `AI_TAGGING_ENABLED=true` |
| API / worker → SMTP | `SMTP_HOST:SMTP_PORT` | SMTP with STARTTLS (587) or TLS (465) ⬜ TLS required (V12.3.1) | Verification, reset, notification emails | Recipient, the email | `SMTP_USER` / `SMTP_PASS` | `EMAIL_SEND_CONCURRENCY` (5) |
| API / worker → MongoDB | `MONGODB_URI` | MongoDB wire protocol on the internal network ⬜ authentication and TLS (V13.2.1, V12.3.1) | All application data | Everything | ⬜ none yet | — |

Nothing else is called. The application loads no third-party scripts, fonts or trackers in the browser
(fonts are self-hosted at build time; the CSP allows `'self'` and the API origin only).

## 2. Cryptography inventory

Every cryptographic algorithm in use (ASVS V11.1.2). All of it comes from Node's `crypto` module and
`bcryptjs`; the application implements no cryptography of its own.

| What | Algorithm | Where | Notes |
| :--- | :--- | :--- | :--- |
| Passwords | HMAC-SHA256 pre-hash keyed by the bcrypt salt, then bcrypt cost `BCRYPT_ROUNDS` (12); stored as `bcrypt-sha256$` + the bcrypt hash | `utils/passwordHasher.ts` | The pre-hash turns any password into 44 characters, so length is not cut at bcrypt's 72 bytes; keying it with the salt stops "hash shucking". Hashing runs in a worker-thread pool |
| Old password hashes | plain bcrypt (before 2026-11-20) | `utils/passwordHasher.ts`, `services/auth.service.ts` | Still verify (never past 72 bytes), and are replaced by the current scheme at the next successful sign-in, as is any hash whose cost differs from `BCRYPT_ROUNDS` |
| Unknown-email sign-ins | bcrypt against a random dummy hash | `services/auth.service.ts` | Makes an unknown email cost the same time as a real one |
| Session tokens | 32 random bytes (`crypto.randomBytes`), stored as SHA-256 | `models/session.model.ts` | The cookie holds the raw token; the database only its hash |
| Email links (verify, reset, unsubscribe) | 32 random bytes, stored as SHA-256 | `models/token.model.ts` | Single-use (verify, reset); sent after the `#` of the link |
| TOR file identity | SHA-256, full 256-bit digest | `services/fileStorage.service.ts` | Also the de-duplication key. Files stored before 2026-11-20 used 96 bits; `npm run backfill:tor-file-keys` renames them |
| Failed sign-ins for unknown emails | SHA-256 of the lower-cased address | `models/loginFailure.model.ts` | The address itself is never stored |
| Breached-password lookup | SHA-1 | `integrations/haveIBeenPwned.client.ts` | Required by the service's k-anonymity range API; only a 5-character prefix leaves the server. Not used for any protection |
| CSP nonces | `crypto.randomUUID()` per page request | `B2GVendor/src/proxy.ts` | 122 random bits |
| Transport | TLS 1.2 / 1.3 ⬜ (V12.1.1) | Reverse proxy in production | Outbound calls to e-GP, data.go.th, HIBP and the AI provider already use HTTPS |

Not used: encryption at rest inside the application (the MongoDB volume relies on the host's disk
encryption), JWTs or any signed token, custom random number generation (`Math.random` is never used
for anything security-related).

## 3. Keys and secrets

Every secret the system holds, where it lives, who can reach it and how it is replaced (ASVS V11.1.1).

| Secret | Used by | Stored in | Rotation |
| :--- | :--- | :--- | :--- |
| `SMTP_PASS` | API, worker | `Backend/.env` on the host ⬜ secret store (V13.3.1) | Yearly, when a person with access leaves, or at once if leaked |
| `OPENROUTER_API_KEY` | Worker | `Backend/.env` | Same; revoke the old key in the provider's console after the switch |
| Google service-account key (`GOOGLE_APPLICATION_CREDENTIALS`) | Worker | A JSON file on the host, outside the repository | Same; delete the old key in Google Cloud IAM |
| `DATA_GO_TH_API_KEY` | Worker, API | `Backend/.env` | Same |
| MongoDB credentials ⬜ (V13.2.1) | API, worker | `MONGODB_URI` in `Backend/.env` | Same, once authentication is turned on |
| TLS private key and certificate ⬜ (V12.2.2) | Reverse proxy | The proxy host | Let's Encrypt renews every 90 days automatically |
| First Super Admin's password | `npm run seed:superadmin` | Given once to the seeding command (argument or `SEED_SUPERADMIN_PASSWORD`); stored only as its bcrypt hash | The Super Admin should change it after the first sign-in |

Rules:

- `.env` files are never committed (`.gitignore` keeps everything but `.env.example`), never baked into
  an image (`env_file:` in `docker-compose.yml` passes them at run time) and never logged. The
  website receives no backend secret at all.
- A secret is replaced by putting the new value in the environment and restarting the container;
  nothing is cached elsewhere. After a suspected leak, rotate first, then look for misuse.
- Session and link tokens are not keys: they are random, stored only as hashes, and ended by
  revoking them (logout, password change, reset, "sign out everywhere") rather than by rotation.
- Raising `BCRYPT_ROUNDS` applies to every password hashed from then on, and each existing password
  is re-hashed at its owner's next successful sign-in (V11.2.2). The same mechanism moved every
  account off plain bcrypt onto the pre-hashed scheme (§2), without anyone resetting a password.

## 4. Sessions

(ASVS V7.1.1, V7.1.2, V7.2.4, V7.3.1, V7.4.4, V7.4.5, V7.5.2)

- **How many at once:** unlimited per account. Each sign-in on a browser or device creates its own
  session; signing in on a phone does not sign out the laptop.
- **Absolute lifetime:** `SESSION_TTL_DAYS`, 7 days from sign-in, then the session is refused and
  deleted by a TTL index. Re-authentication is needed after that, whatever the activity.
- **Inactivity timeout:** a session that makes no request for `SESSION_IDLE_MINUTES_STAFF` (30
  minutes) for Admin and Super Admin accounts, or `SESSION_IDLE_MINUTES_VENDOR` (24 hours) for vendors,
  is revoked on the server and the next request answers `401` "Your session ended after a period of
  inactivity". Staff time out sooner because they change configuration and other people's accounts;
  a vendor only manages their own follows and profile. The admin screens' background "is a poll
  running?" check (`GET /admin/ingestion/status`) does not count as activity, so an admin tab left
  open still times out.
- **Signing in:** always issues a new token, and ends the session the same browser already held.
- **Ending sessions:**

  | Event | Sessions ended |
  | :--- | :--- |
  | Sign out | This one |
  | Change password | Every other session of the account (the current one stays) |
  | Reset password by email | Every session of the account |
  | Signing in again in the same browser | The session that browser held before |
  | Inactivity past the timeout | That session |
  | "Sign out" on one device in the account page (password asked again) | That device's session |
  | "Sign out all other devices" in the account page (password asked again) | Every other session of the account |
  | Super Admin "Sign out everywhere" on an admin | Every session of that admin |
  | Any Admin "Sign out everywhere" on a vendor | Every session of that vendor |
  | Suspension | All of them are refused on their next request |
  | Account deleted | All of them are deleted |

- **What the user sees:** the account page lists every signed-in device (`GET /account/sessions`:
  browser, OS, masked IP address, last active, which one is this) with a sign-out button for each and
  one for all the others. Ending a session asks for the password again, and wrong passwords count
  toward the account's sign-in lock, so a stolen session cannot throw the owner out.
- **Signing out:** a "Sign out" button on every public page (navbar) and in the admin console's
  sidebar, which also shows who is signed in.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Secure` and named `__Host-b2g_session` in production (the
  prefix forbids a `Domain` attribute and requires `Secure` and `Path=/`). Logging out also sends
  `Clear-Site-Data: "cache", "storage"`.

## 5. Field-level access rules

Who may read and who may change which fields (ASVS V8.1.2). The server enforces every rule; the
admin screens only hide what a role cannot use. "Owner" is the signed-in account itself.

| Model · field | Read | Write |
| :--- | :--- | :--- |
| Account · `passwordHash` | Nobody (never selected, never returned) | Owner, through change / reset password only |
| Account · `failedLoginCount`, `lockedUntil`, `lastFailedLoginAt`, `passwordChangedAt` | Nobody | The server only |
| Account · `email`, `type` | Owner, any Admin | Set at sign-up / creation; never changed afterwards |
| Account · `name`, `phone`, `businessProfile` | Owner, any Admin | Owner (`PATCH /account/profile`, strict schema); any Admin for a vendor, Super Admin for an admin |
| Account · `role`, `permissions` | Owner, any Admin | Super Admin only (`/admin/staff`); never the owner |
| Account · `status` (suspend) | Owner, any Admin | Any Admin for vendors; Super Admin for admins |
| Account · notification settings, follows | Owner | Owner |
| Session · `tokenHash` | Nobody | The server |
| Session · `ipAddress`, `userAgent` | Owner, as browser / OS and a **masked** IP address | The server |
| Token (email links) | Nobody | The server |
| Work · `status`, `statusHistory`, `announceType` | Everyone | The ingestion worker only (from e-GP); no route accepts them |
| Work · `tags` | Everyone | Tag Admin, Poll and Tag Admin, Super Admin |
| Work · `excludedTags` | Never in a public response (left out of every `/works` query); used by the admin tag editor | The same tag roles, through the tag editor |
| Work · `ingestionRelevance` | Admins; a `not-related` work is never shown publicly at all | The worker; the tag editor recomputes it |
| GovSite · every field | Everyone (public directory) | Super Admin only |
| Tag · vocabulary | Everyone | Tag roles; a site tag only through its site |
| AuditLog · every field | Any Admin; `phone` values are redacted at write time | Nobody: append-only |
| LoginFailure | Nobody | The server |

## 6. Data classification

Every kind of data the application holds, in four protection levels (ASVS V14.1.1).

| Level | Data |
| :--- | :--- |
| **Secret** | Passwords and their hashes; session tokens; email-link tokens (verify, reset, unsubscribe); API keys, SMTP and database credentials; TLS private keys |
| **Confidential — personal data (PDPA)** | Name, email address, phone number, company name, 13-digit tax ID, the IP address and browser of each session, failed-sign-in hashes |
| **Internal** | Followed tags, notification settings and history, the audit log, poll runs and jobs, source configuration, admin roles |
| **Public** | Works (procurement announcements), their status history, TOR documents, prices, government sites, the tag vocabulary |

## 7. Protection requirements per class

The rules for each level (ASVS V14.1.2), and whether the code meets them (ASVS V14.2.4).

| Requirement | Secret | Confidential (personal) | Internal | Public |
| :--- | :--- | :--- | :--- | :--- |
| **Stored as** | Hash only (bcrypt or SHA-256) ✅; keys only in the environment ✅ (⬜ secret store) | Plain, in MongoDB ✅ | Plain ✅ | Plain ✅ |
| **In transit** | TLS ⬜ (production proxy, V12) | TLS ⬜ (V12) | TLS ⬜ (V12) | TLS ⬜ (V12) |
| **In URLs** | Never: tokens go in the `#` fragment or a body ✅ (V14.2.1) | Never ✅ | — | Allowed |
| **In logs** | Never ✅ | Only masked: emails as `s***@example.com` ✅; phone numbers redacted in the audit log ✅ | Allowed | Allowed |
| **Returned by the API** | Never ✅ | To the owner and Admins only ✅ (§5) | To the owner and the roles in §5 ✅ | To everyone ✅ |
| **Browser caching** | `Cache-Control: no-store` ✅ | `no-store` ✅ | `no-store` ✅ | May be cached |
| **Integrity** | — | Strict schemas on every write ✅ | Every admin change audited ✅ | Status only from e-GP; files identified by full SHA-256 ✅ |
| **Retention** | Expires (§8) ✅ | Until the account is deleted; unverified accounts removed after 7 days ✅ | §8 ✅ | Kept |

Still open for V14.2.4: TLS for every connection and MongoDB authentication (the deployment items,
V12 and V13.2). Everything the application itself can enforce is in place.

## 8. Retention schedule

How long each kind of data is kept, and what removes it (ASVS V14.2.7).

| Data | Kept for | Removed by |
| :--- | :--- | :--- |
| Session | 7 days from sign-in, or until ended (§4) | MongoDB TTL index on `expiresAt` |
| Email-verification link | 24 hours | TTL index on `expiresAt` |
| Password-reset / set-up link | 1 hour | TTL index |
| Unsubscribe link | 10 years (it must keep working in old emails) | TTL index; deleted with the account |
| Failed sign-ins of an unknown email | 25 hours after the last failure | TTL index on `lastFailedLoginAt` |
| Failed sign-ins of an account | Forgotten after 24 hours; cleared by a correct sign-in or a reset | `loginLockout.service.ts` |
| Self-registered account never verified | 7 days | Worker, daily at 03:15 (`retention.service.ts`), recorded in the audit log as the `retention` system actor |
| Account, its follows, notifications, sessions and tokens | Until the owner asks for deletion | An Admin deletes it in the admin console (`DELETE /admin/accounts/:id`, `DELETE /admin/staff/:id`); everything that belongs to it goes with it |
| Audit log | For the life of the system: it is the accountability record of admin actions | Nobody (append-only) |
| Works, TOR files, gov sites, tags | Kept: public procurement records | Never deleted; sites and tags are disabled or retired |
| Logs (stdout) | As long as the container platform keeps them ⬜ (V16.4) | The host |

**A deletion request under PDPA:** the person emails the operator; an Admin confirms the request comes
from the account's email address, then deletes the account in Admin › Vendor accounts. The audit log
keeps a record that the account was deleted (its email as the label), which is the evidence the
request was carried out.

## 9. Costly functionality

The functions that take noticeable time, CPU, memory, money or external quota, and what keeps each one
in check (ASVS V15.1.3).

| Function | Cost | Controls |
| :--- | :--- | :--- |
| Password hashing (sign-in, sign-up, change, reset) | ~200 ms of CPU per call (bcrypt cost 12) | Worker-thread pool so the API stays responsive; 10 sign-ins per address per 15 min; per-account lockout; 5 sign-ups and 5 resets per address per hour |
| Public search (`GET /works`) | A regex scan of the works collection; typo-tolerant patterns grow with query length | 200 characters and 8 words at most; pattern size capped (exact match beyond); 120 searches per address per minute; 5 s MongoDB time limit (503 beyond); page size ≤ 50 |
| Polling e-GP and data.go.th | Many outbound requests per site | One poll at a time (lock); Poll Now 10 a minute per admin; 30 s per request; whole poll stopped after 2 hours; per-site requests-per-minute setting; runs in the worker, not the API |
| TOR download | Up to 100 MB per file | 100 MB cap while streaming, 120 s timeout |
| ZIP extraction | Decompression (ZIP bombs) | 200 entries, 50 PDFs, 50 MB per entry, 200 MB in total, checked against declared sizes before inflating |
| PDF text extraction | CPU and memory per document | Only real PDFs (`%PDF-` signature); text cut to 8,000 characters for the AI |
| e-GP HTML page reading | One request per winner announcement | e-GP hosts only, 1 request a second, 2 MB per page |
| AI tagging | A paid API call per new TOR document | Off by default; only for new documents; prompt input capped (500-character title, 8,000 characters of text, 4,000 of price hints); answer validated (§10) |
| Email | SMTP quota | 5 messages at a time; daily digest instead of instant for those who choose it |
| CSP reports | Log volume | 64 KB per request, 10 reports per request, 300 log lines a minute |

## 10. Dangerous functionality

Places where the application handles untrusted input in a way that could hurt it if a control failed
(ASVS V15.1.5). Each one is a priority for review and testing.

| Function | Danger | Controls |
| :--- | :--- | :--- |
| Fetching URLs found in the e-GP feed | Server-side request forgery into the internal network or cloud metadata | HTML pages: `*.gprocurement.go.th` only, every redirect checked. ⬜ TOR downloads: allow-list and redirect checks (V1.3.6, V15.3.2) |
| Parsing PDF and ZIP files from the feed (`pdf-parse`, `adm-zip`) | Parser bugs, ZIP bombs, path tricks in entry names | Size and entry limits (§9), files stored only as `<sha256>.pdf`, never by their own name |
| Serving downloaded files to users | A disguised HTML or script file running in the browser | Only files with a real PDF signature are served, as `application/pdf`, `attachment`, `nosniff` |
| Reading e-GP HTML pages | Script or markup in third-party HTML | Converted to plain text on the server; never rendered |
| Sending TOR text to the AI | Prompt injection: a document that tells the model to add tags, write a misleading summary or invent a price | Text fenced as untrusted data and capped; the system prompt forbids following it; the answer is validated: only known tag ids (at most 5), description cut to 2,000 characters with control characters removed, price between 0 and 1 trillion baht, a proposed tag checked against existing names. Tested in `tests/unit/ai-prompt-injection.check.ts` |
| Building emails with names, titles and tags | HTML injection into email | Every value escaped (`escapeHtml`) |
| Regular expressions from search text | ReDoS | Input escaped, length-capped, linear patterns (no nested repetition) |
| Request bodies merged into objects | Prototype pollution, NoSQL operator injection | `$`-prefixed, dotted, `__proto__`, `constructor` and `prototype` keys dropped before validation; strict schemas |
| Log lines with request data | Format-string and log injection | Request text is passed as an argument to a fixed `%s` format; CSP reports logged as JSON |

## 11. Dependencies

Third-party components: how quickly a known vulnerability must be fixed, how we know what we ship,
and which components need extra care (ASVS V15.1.1, V15.1.2, V15.1.4, V15.2.1).

### Fix windows

A published advisory for a dependency we ship is fixed, by upgrading or replacing it, within:

| Severity (npm audit / GHSA) | Fixed within | How it is enforced |
| :--- | :--- | :--- |
| Critical | 7 days | CI fails on any pull request or push to `main` while it is present |
| High | 30 days | CI fails, as for critical |
| Moderate | 90 days | Reported by CI; tracked as an issue |
| Low | Next planned release | Reported by CI |

CI (`.github/workflows/ci.yml`, job *Dependencies*) runs `npm audit --audit-level=high` for both apps
on every pull request, every push to `main`, and every Monday, so an advisory published for code we
already ship is noticed even when nobody is working on it. When no fixed version exists, the
dependency is pinned to a safe version with an npm `overrides` entry (as for `uuid` under
Google's `gaxios` in `Backend/package.json`) or replaced.

**State on 2026-11-20:** `npm audit` reports 0 vulnerabilities in both apps, after upgrading next
16.4.6 (critical RCE), express 4.22.3, mongoose 8.24.10, morgan 1.12.1, zod 4, nodemailer 10,
node-cron 4 and fast-xml-parser 5, and pinning `uuid` 11.1.1 under gaxios.

### Software bill of materials

Every CI run produces a CycloneDX 1.5 SBOM of each app as installed from its lockfile
(`npm sbom --sbom-format cyclonedx`), kept as the build artifacts `sbom-Backend` and `sbom-B2GVendor`
for 90 days; every push to `main` is a release. Dependencies come only from the public npm registry,
pinned with integrity hashes in `package-lock.json` and installed with `npm ci`.

### Risky components

Components that parse untrusted input, have a history of serious advisories, or are poorly
maintained. They are upgraded first and reviewed whenever they change.

| Component | Why it is risky | How we contain it |
| :--- | :--- | :--- |
| `pdf-parse` 1.1.1 | Parses untrusted PDFs with a bundled pdf.js from 2017-2018; the 1.x line is no longer developed | Runs only in the ingestion worker, never the API; only files with a real `%PDF-` signature, at most 100 MB; text only. Replace with pdf-parse 2 or `pdfjs-dist` in a sandboxed process when possible |
| `adm-zip` | Unpacks untrusted ZIPs; seven advisories in 0.6.0 alone | Entry, PDF-count and size limits checked against declared sizes before inflating; nothing is written to disk under an entry's own name |
| `fast-xml-parser` | Parses the untrusted e-GP feed; repeated advisories (prototype pollution, ReDoS, entity expansion, quadratic CPU) | Attributes ignored, only the e-GP feed host, request time limit |
| `nodemailer` | Builds SMTP traffic; header- and command-injection advisories | Fixed templates; recipients only from our own database; every value HTML-escaped |
| `next` | Large attack surface on the public internet; critical advisories in 2026 | Patched within the 7-day window; CI blocks releases with known high/critical issues |
| `@google-cloud/vertexai`, OpenRouter (via `fetch`) | Send untrusted TOR text to a third party; pulls an older Google auth stack | Off unless `AI_TAGGING_ENABLED=true`; input capped and fenced, output validated (§10) |
| `express` 4 | The 4.x line is in maintenance (5.x is current) | Kept on the latest 4.x patch; moving to 5.x is the next major upgrade |

## 12. Password policy

(ASVS V6.1.2, V6.2.5, V6.2.9, V6.2.11, V6.3.7; code in `Backend/src/utils/passwordPolicy.ts`)

- **Length:** 8 to 128 characters, counted as Unicode characters, so 64 Thai characters (192 bytes)
  are fine. No composition rule: letters, digits, spaces, symbols and Thai are all allowed, and none
  is required. Long passphrases are encouraged.
- **Breached passwords:** refused, using the Have I Been Pwned range API (§1).
- **Context-specific words:** a password is refused when, after taking out every word below that it
  contains, fewer than 8 characters of its own are left. So `B2GVendor2026!` or `Somchai1234` (for
  Somchai) are refused, while a long phrase that happens to contain "vendor" is fine. The words:
  - the product and its subject: `b2gvendor`, `b2g`, `vendor`, `egp`, `gprocurement`,
    `procurement`, `datagoth`, `tor`, `จัดซื้อจัดจ้าง`, `จัดซื้อ`, `จัดจ้าง`, `ภาครัฐ`, `ราชการ`,
    `ประกวดราคา`;
  - role and generic words: `admin`, `superadmin`, `administrator`, `password`, `รหัสผ่าน`;
  - the person's own details: the email address's name and domain label, each part of their name,
    their company name and tax ID.

  Words are compared case-insensitively after Unicode NFKC normalisation, ignoring spaces and
  symbols. The same check runs at sign-up, password change, password reset and admin seeding.
- **Notice:** every password change and reset emails the owner (time, how it was changed, and a
  link to reset it if it was not them). Re-hashing at sign-in (§2) is not a change and sends nothing.
- **Hashing:** see §2. A password is never logged, returned or stored in a replayable form.
