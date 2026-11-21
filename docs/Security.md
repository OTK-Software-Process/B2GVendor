# Security

How B2G Vendor protects its data: what it talks to, what cryptography and secrets it holds, who may
read or change which field, how each class of data is protected and how long it is kept, and which
parts of the system are costly or dangerous. Each section names the OWASP ASVS 5.0 requirement it
answers. The plan and its status live in `OWASP_ASVS_5.0_B2GVendor_Plan.xlsx` at the repository root.

✅ means in place in the code; ⬜ means planned and not built yet. The deployment controls (TLS, the MongoDB login,
the secret store, non-root containers) are in place as configuration, in `docker-compose.prod.yml`: how to
use it is [Deployment.md](Deployment.md), and `docker/verify-deployment.sh` proves it on a running stack.

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
13. [Logging](#13-logging) — V16.1.1, V16.2.3–V16.2.5, V16.3.1–V16.3.3, V16.4.1–V16.4.3
14. [Deployment](#14-deployment) — V3.5.4, V4.1.2, V12.1.1, V12.1.2, V12.2.1, V12.2.2, V12.3.1, V13.2.1–V13.2.3, V13.3.1, V13.3.2, V14.2.4
15. [Two-step sign-in](#15-two-step-sign-in) — V6.3.3, V6.4.4, V6.5.1–V6.5.6, V6.5.8

---

## 1. External connections

Every connection the application makes or accepts (ASVS V13.1.1). "API" is the Express backend,
"worker" the ingestion worker, "website" the Next.js server.

**How outbound calls are controlled (ASVS V13.2.4, V13.2.5, V1.3.6, V15.3.2).** Every HTTP call the
API and the worker make goes through `Backend/src/utils/outbound.ts`: each purpose (e-GP, data.go.th,
HIBP, AI) has its own allowed hosts, a URL on any other host is refused before it is requested, and
redirects are followed by hand, at most 5, each hop checked against the same list (a redirected POST
is refused). A refusal is logged as `outbound.blocked`. In Docker the API and the worker are also on
a network with **no route to the internet**: their only way out is the egress proxy (Squid,
`docker/proxy/`), which allows the hosts in `allowed-domains.txt` and refuses and logs the rest.

| From → to | Address | Protocol | Why | What is sent | Credential | Limits |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Browser → website | the site's host | HTTPS in production | Pages | Requests, nothing secret in URLs (§7) | — | — |
| Browser → API | `NEXT_PUBLIC_API_URL` | HTTPS in production, CORS from `CORS_ORIGIN` only | JSON API, TOR downloads | Session cookie, JSON bodies | Session cookie | Rate limits (API.md §2) |
| Website → API | `API_INTERNAL_URL` | HTTP on the internal network | Public data for server-rendered pages | Public queries, the visitor's address in `X-Forwarded-For` | None (public reads only, no cookies) | 1.5 s per request |
| Browser → website | `/csp-report` | HTTPS in production | Content-Security-Policy violation reports | The report (page URL, blocked URL, directive) | — | 64 KB per request, 300 log lines a minute |
| Worker → e-GP RSS feed | `process3.gprocurement.go.th` (`EGP_RSS_BASE_URL`) | HTTPS | New and changed announcements | A department code and announcement type | — | 30 s per request (`INGESTION_REQUEST_TIMEOUT_MS`) |
| Worker → e-GP announcement pages | `*.gprocurement.go.th` only | HTTPS (an `http://` link is upgraded) | The price on a winner announcement | GET of the exact URL the feed gave | — | Host allow-list on every redirect, 5 redirects, 2 MB, 1 request a second |
| Worker → TOR document links | `*.gprocurement.go.th` only (every real link is on `process5`) | HTTPS (e-GP links upgraded) | Download TOR PDFs / ZIPs | GET | — | Allow-list on every redirect, 100 MB, 120 s, antivirus scan, ZIP limits (§9) |
| Worker / API → data.go.th | `data.go.th` (`DATA_GO_TH_BASE_URL`) | HTTPS | Contract datasets, the department directory | CKAN queries | Optional `DATA_GO_TH_API_KEY` | 30 s per request |
| API → Have I Been Pwned | `api.pwnedpasswords.com` | HTTPS | Breached-password check at sign-up, change and reset | The first 5 hex characters of the password's SHA-1, nothing else | — | Refuses the password change if unreachable |
| Worker → AI provider | `openrouter.ai` or Google Vertex AI (`asia-southeast1`) | HTTPS | Tags, summary and price of a TOR document | The title, at most 8,000 characters of TOR text, the tag list | `OPENROUTER_API_KEY` or a Google service account | Off unless `AI_TAGGING_ENABLED=true` |
| API / worker → SMTP | `SMTP_HOST:SMTP_PORT` (in Docker through the egress proxy as a CONNECT tunnel) | TLS ✅ (V12.3.1): port 465 from the first byte, or STARTTLS on 587 that is **required** (never plain text), TLS 1.2 or newer, certificate and host name checked. Enforced when `REQUIRE_SECURE_BACKENDS` is on (production); a local mail catcher still works without it | Verification, reset, notification emails | Recipient, the email | `SMTP_USER` / `SMTP_PASS` (the secret file `smtp_pass`) | `EMAIL_SEND_CONCURRENCY` (5) |
| API / worker → egress proxy | `proxy:3128` (internal network) | HTTP CONNECT | The only way out of the internal network | The calls above | — | Hosts in `docker/proxy/allowed-domains.txt` |
| Browser → API gateway | `localhost:4000` → `backend:4000` (Squid in front of the API) | HTTP: the **local stack only**; in production the edge below replaces it and this port is not published | The API has no published port of its own | The API traffic; the caller's address appended to `X-Forwarded-For` | — | — |
| Browser → edge (website) | `https://APP_HOST` (443); port 80 redirects to it | HTTPS only ✅: TLS 1.2 and 1.3, Mozilla "intermediate" cipher suites, Let's Encrypt certificate (V12.1.1, V12.1.2, V12.2.1, V12.2.2) | Pages | Requests; the visitor's address goes on in `X-Forwarded-For` | — | Slow-header timeout 10 s |
| Browser → edge (API) | `https://API_HOST` (443); plain HTTP on port 80 is **refused** (`403`), never redirected | HTTPS only ✅ (V4.1.2, V3.5.4: a different host name from the website) | JSON API, TOR downloads | Session cookie, JSON bodies | Session cookie | Rate limits (API.md §2) |
| Edge → website, edge → API | `frontend:3000`, `backend:4000` | HTTP inside the internal Docker network | The only way in from outside | The requests above | — | — |
| Worker → ClamAV | `clamav:3310` (internal network) | clamd INSTREAM over TCP | Scan every downloaded TOR file before it is unpacked or stored | The file | — | 110 MB per stream, 120 s |
| ClamAV → signature mirror | `database.clamav.net` | HTTPS | Virus-signature updates (freshclam) | — | — | — |
| Docker → Alloy → Loki | Docker socket (read-only) → `loki:3100` (logging network) | HTTP | Every container's log lines into the log store (§13) | Log lines | — | — |
| Loki → Alertmanager | `alertmanager:9093` (logging network) | HTTP | Security alerts (§13) | Alert name, labels | — | — |
| API / worker → MongoDB | `MONGODB_URI` (a secret file) | MongoDB wire protocol on the internal network, **TLS 1.2 or newer required, login required** ✅ (V12.3.1, V13.2.1); no published port in production | All application data | Everything | One user per service, `b2g_api` and `b2g_worker`, each `readWrite` on the application database only ✅ (V13.2.2) | — |

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
| Authenticator codes (two-step sign-in) | TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30-second step, 160-bit secret from `crypto.randomBytes`, checked in constant time | `utils/totp.ts`, `services/mfa.service.ts` | SHA-1 here is HMAC-SHA1 as RFC 4226 specifies, which every authenticator app implements; it is not collision-sensitive. Each code is accepted once (§15) |
| Authenticator secrets at rest | AES-256-GCM, a random 96-bit IV per value, the account id as authenticated data, key `MFA_ENCRYPTION_KEY` | `utils/secretBox.ts`, `models/mfaCredential.model.ts` | A value copied to another account does not decrypt; any change to it is detected. Stored as `v1.<iv>.<tag>.<ciphertext>` |
| Recovery codes | 80 random bits per code from `crypto.randomBytes` (unbiased mapping to 32 characters); stored as the same HMAC-SHA256 pre-hash and bcrypt as passwords | `utils/recoveryCodes.ts`, `services/mfa.service.ts` | Only a hash is kept; each code is accepted once. A 4-character id (not secret) selects the one hash to check |
| TOR file identity | SHA-256, full 256-bit digest | `services/fileStorage.service.ts` | Also the de-duplication key. Files stored before 2026-11-20 used 96 bits; `npm run backfill:tor-file-keys` renames them |
| Failed sign-ins for unknown emails | SHA-256 of the lower-cased address | `models/loginFailure.model.ts` | The address itself is never stored |
| Breached-password lookup | SHA-1 | `integrations/haveIBeenPwned.client.ts` | Required by the service's k-anonymity range API; only a 5-character prefix leaves the server. Not used for any protection |
| CSP nonces | `crypto.randomUUID()` per page request | `B2GVendor/src/proxy.ts` | 122 random bits |
| Transport (browser) | TLS 1.2 / 1.3 ✅ (V12.1.1, V12.1.2); TLS 1.2 limited to six ECDHE suites with AES-GCM or ChaCha20-Poly1305 (Mozilla "intermediate", minus the DHE suites Go does not implement); TLS 1.3's three suites | The edge (Caddy), `docker/edge/Caddyfile` | Certificates from Let's Encrypt (ECDSA P-256 by default), renewed automatically. HTTP/3 is switched off |
| Transport (MongoDB) | TLS 1.2 / 1.3 (`--tlsDisabledProtocols=TLS1_0,TLS1_1`), certificate checked against a private authority | `mongod`; the API and the worker (`tlsCAFile` in their connection address) | RSA 4096 authority (5 years) and RSA 2048 server certificate (365 days, for the host name `mongo`), made by `docker/secrets/generate.sh` |
| Transport (mail) | TLS 1.2 or newer, certificate and host name checked | `config/transportSecurity.ts` | Port 465, or STARTTLS made mandatory by `REQUIRE_SECURE_BACKENDS` |
| Transport (outbound calls) | HTTPS | e-GP, data.go.th, HIBP and the AI provider | |

Not used: encryption at rest inside the application other than for authenticator secrets (the rest of
the MongoDB volume relies on the host's disk encryption), JWTs or any signed token, custom random number generation (`Math.random` is never used
for anything security-related).

## 3. Keys and secrets

Every secret the system holds, where it lives, who can reach it and how it is replaced (ASVS V11.1.1).

| Secret | Used by | Stored in | Rotation |
| :--- | :--- | :--- | :--- |
| `SMTP_PASS` | API, worker | A Docker secret, the file `smtp_pass`, read through `SMTP_PASS_FILE` ✅ (V13.3.1) | Yearly, when a person with access leaves, or at once if leaked |
| `OPENROUTER_API_KEY` | Worker | The secret `openrouter_api_key` (the worker only) | Same; revoke the old key in the provider's console after the switch |
| Google service-account key (`GOOGLE_APPLICATION_CREDENTIALS`) | Worker | The secret `google_credentials`, a JSON file (the worker only) | Same; delete the old key in Google Cloud IAM |
| `DATA_GO_TH_API_KEY` | Worker, API | The secret `data_go_th_api_key` (both) | Same |
| `MFA_ENCRYPTION_KEY` ✅ (V6.5.3) | API only | The secret `mfa_encryption_key` (32 random bytes, base64), made by `docker/secrets/generate.sh` and never replaced once it exists | **Not rotated casually**: every authenticator secret in the database was written with it. If it is lost or leaked, replace it and reset each account's two-step sign-in (§15). Keep a copy apart from the database backups |
| MongoDB credentials ✅ (V13.2.1) | The API (`mongo_api_uri`), the worker (`mongo_worker_uri`): each only its own. MongoDB itself: the three passwords. Operators: the root password | Docker secrets; random 40-character passwords from `docker/secrets/generate.sh`. The root password is given to MongoDB only | At once if leaked, or yearly: change it in MongoDB first, then the files ([Deployment.md](Deployment.md#5-day-to-day)) |
| TLS private key and certificate ✅ (V12.2.2) | The edge | Caddy's `edge-data` volume (certificates and the ACME account) | Let's Encrypt certificates last 90 days and Caddy renews them by itself |
| MongoDB certificate authority and server certificate ✅ | MongoDB (server file), the API and the worker (the authority's certificate only) | Secrets `mongo_server_pem` and `mongo_ca_pem`; the authority's private key stays on the host in `secrets/ca/`, never mounted | Server certificate: yearly, `docker/secrets/generate.sh renew-mongo-cert`. Authority: every 5 years |
| First Super Admin's password | `npm run seed:superadmin` | Given once to the seeding command (argument or `SEED_SUPERADMIN_PASSWORD`); stored only as its bcrypt hash | The Super Admin should change it after the first sign-in |

Rules:

- `.env` files are never committed (`.gitignore` keeps everything but `.env.example`), never baked into
  an image (`env_file:` in `docker-compose.yml` passes them at run time) and never logged. The
  website receives no backend secret at all.
- **In production no secret is in a `.env` file.** Each is a file from the secret store (V13.3.1), read
  through `NAME_FILE` (`config/secretFiles.ts`), so it is not in the container's environment either. Each
  service is given only the files it needs (V13.3.2): the website none, the API and the worker each
  their own MongoDB address, the root password only MongoDB. A secret given both as a value and as a
  file stops the process at start-up. No password is a default (V13.2.3): the generator makes them
  random and different, and `docker/secrets/generate.sh check` rejects a short, repeated or default one.
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
- **Signing in:** always issues a new token, and ends the session the same browser already held. For an
  account with two-step sign-in the password alone issues only a **challenge**: a 5-minute session that
  `requireAuth` refuses everywhere and that only `POST /auth/mfa/verify` accepts. A correct code ends
  the challenge and issues a NEW session (so a token seen before the second step is useless). Challenges
  are not listed among a person's devices and do not count toward any limit (§15).
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
| **Stored as** | Hash only (bcrypt or SHA-256) ✅; keys only in secret files from the secret store ✅ (production) | Plain, in MongoDB ✅ | Plain ✅ | Plain ✅ |
| **In transit** | TLS ✅ (production: the edge, MongoDB and mail) | TLS ✅ | TLS ✅ | TLS ✅ |
| **In URLs** | Never: tokens go in the `#` fragment or a body ✅ (V14.2.1) | Never ✅ | — | Allowed |
| **In logs** | Never ✅ | Only masked: emails as `s***@example.com` ✅; phone numbers redacted in the audit log ✅ | Allowed | Allowed |
| **Returned by the API** | Never ✅ | To the owner and Admins only ✅ (§5) | To the owner and the roles in §5 ✅ | To everyone ✅ |
| **Browser caching** | `Cache-Control: no-store` ✅ | `no-store` ✅ | `no-store` ✅ | May be cached |
| **Integrity** | — | Strict schemas on every write ✅ | Every admin change audited ✅ | Status only from e-GP; files identified by full SHA-256 ✅ |
| **Retention** | Expires (§8) ✅ | Until the account is deleted; unverified accounts removed after 7 days ✅ | §8 ✅ | Kept |

V14.2.4 is met in a deployment (§14): TLS on every connection, a MongoDB login, and secrets in the secret
store. What cannot be shown without a public server is Let's Encrypt issuing a real certificate;
`docker/verify-deployment.sh probe` shows it once DNS points at the server.

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
| Logs (application, access, proxy, ClamAV) | 90 days in Loki (§13) | Loki's compactor (retention); nobody can delete them earlier |

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
| Antivirus scan | ClamAV memory (~1.5 GB with signatures) and a few seconds per large file | One scan per downloaded file, 120 s time limit; the daemon runs in its own container |
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
| Fetching URLs found in the e-GP feed | Server-side request forgery into the internal network or cloud metadata | Feed, pages and TOR files: `*.gprocurement.go.th` only, every redirect checked before it is followed (`utils/outbound.ts`); in Docker, the egress proxy refuses every other host as well |
| Parsing PDF and ZIP files from the feed (`pdf-parse`, `adm-zip`) | Parser bugs, ZIP bombs, path tricks in entry names, malware passed on to users | Scanned by ClamAV before anything opens them (an infected or unscannable file is never parsed or stored); size and entry limits (§9); files stored only as `<sha256>.pdf`, never by their own name |
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
16.4.6 (critical RCE), express 4.22.3, mongoose 8.24.10, morgan 1.12.1 (since removed: replaced by the JSON access log, §13), zod 4, nodemailer 10,
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
| `qrcode-generator` 2.0.4 (website) | Draws the QR code for two-step sign-in setup from a string that holds the authenticator secret | No dependencies of its own; runs in the browser only, on text the API just sent, and never sends it anywhere (no image service); drawn as SVG elements, so nothing is injected into the page. Pinned to an exact version |

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

## 13. Logging

What is logged, where it goes, how it is protected and what raises an alarm (ASVS V16.1.1, V16.2.3,
V16.2.4, V16.2.5, V16.3.1–V16.3.3, V16.4.1–V16.4.3).

### Inventory

| Log | Written by | Format | Where it goes | Kept |
| :--- | :--- | :--- | :--- | :--- |
| Application log | API, worker (`utils/logger.ts`) | One JSON object per line: `time`, `level`, `scope`, `msg`, and inside a request `requestId` and the actor's id and role | stdout/stderr → Docker → Alloy → Loki | 90 days |
| Security events | API, worker (`logger.security`) | JSON with `scope: "security"` and a stable `event` name (below), plus the client address | Same as above | 90 days |
| HTTP access log | API (`middlewares/accessLog.middleware.ts`) | JSON `event: "http.request"`: method, path **without** the query string, status, duration, address, request id, account id | Same as above | 90 days |
| Audit log | API, worker (`audit/`) | MongoDB documents: who, what (field diff), when, where | MongoDB `auditlogs` collection, append-only | For the life of the system (§8) |
| Egress proxy log | Squid | One line per request: time, client, result (`TCP_TUNNEL` / `TCP_DENIED`), method, destination | stdout → Loki | 90 days |
| Antivirus, database, log stack | ClamAV, MongoDB, Loki, Alloy, Alertmanager | Their own formats | stdout → Loki | 90 days |
| CSP violation reports | Website (`/csp-report`) | JSON line per report | Website stdout → Loki | 90 days |

Nothing is written to log files inside the application containers, and nothing is sent anywhere else
(V16.2.3). The request id is returned to the caller in the `X-Request-Id` header, so a reported error
can be found in the logs.

### What is never logged

Passwords, session and link tokens, API keys and SMTP credentials are never logged. Email addresses
are masked (`s***@example.com`); request bodies and query strings are not logged at all; a
validation failure logs the names of the fields, not what was sent (V16.2.5). JSON encoding escapes
CR, LF and every control character, so text from a request cannot forge a log line (V16.4.1).

### Security events

| Event | Level | When |
| :--- | :--- | :--- |
| `auth.login.success` | info | A sign-in succeeded (account, role, session id) |
| `auth.login.failure` | warn | A sign-in failed: `reason` is `invalid_credentials`, `locked`, `suspended` or `email_not_verified`; masked email; whether the account exists |
| `auth.lockout` | warn | The failure that locked an account (or an unknown address) and until when. `scope: "mfa"` for a lock caused by wrong second-step codes |
| `auth.reauth.failure` | warn | A wrong current password on change-password or when ending a session |
| `auth.mfa.challenge` | info | The password was right and a second step is owed (a challenge session was issued) |
| `auth.mfa.failure` | warn | A wrong, replayed or locked-out code. `purpose` (`sign_in`, `mfa_setup`, `mfa_disable`, `mfa_recovery_codes`), `reason` (`invalid_code`, `replayed`, `locked`); never the code |
| `auth.mfa.recovery_used` | warn | A recovery code was used, with how many remain; the owner is emailed |
| `account.mfa.setup_started`, `account.mfa.enabled`, `account.mfa.disabled`, `account.mfa.recovery_regenerated` | info | The owner changed their own second factor |
| `account.mfa.reset` | warn | An administrator (or the server command line) removed someone's second factor: who, whom, which identity check, how many sessions ended |
| `auth.logout`, `auth.session.revoked`, `auth.session.idle_timeout` | info | A session ended: sign-out, a new sign-in in the same browser, the owner or an Admin ending sessions, inactivity |
| `auth.signup`, `auth.email_verified` | info | A sign-up (`created` or `existing_email`), an email verified |
| `auth.password.changed`, `auth.password_reset.requested`, `auth.password_reset.completed` | info | Password changes and resets |
| `auth.token.invalid` | warn | A verification, reset or unsubscribe link that is wrong, used or expired |
| `access.denied` | warn | Every 401 / 403 / 423 refusal (no session, wrong role, suspended, locked), with the route and actor |
| `input.rejected` | info | A request refused by validation (400), or too large / wrong type (413, 415): field names only |
| `input.dangerous_keys_dropped` | warn | A body carried `$` operators, dotted keys or `__proto__` / `constructor` / `prototype` |
| `csrf.blocked` | warn | A state-changing request from a foreign origin, with the origin |
| `rate_limit.exceeded` | warn | A rate limit refused a request |
| `outbound.blocked` | warn | The application refused to call a host off its allow-list |
| `tor.malware_found` | error | The antivirus found malware in a downloaded TOR file |

### Protection and alerting

- **Separate store (V16.4.3):** Grafana Alloy reads every container's output through the Docker
  socket (read-only) and ships it to **Grafana Loki**. The application containers are not on the
  logging network: they cannot reach Loki at all, so they cannot read, change or delete stored lines.
- **No changes (V16.4.2):** Loki's delete API is disabled (`deletion_mode: disabled`): stored lines
  disappear only through the 90-day retention. Loki's port is not published to the host.
- **Alerts (V16.4.3):** Loki's ruler evaluates `docker/logging/rules/security.yaml` every minute and
  sends alerts to **Alertmanager** (`http://127.0.0.1:9093` on the host): many failed sign-ins, account
  lockouts, many wrong two-step codes, any reset of someone's two-step sign-in, CSRF refusals, injection probes, blocked outbound calls, egress denials, malware in a TOR
  file, bursts of 5xx errors. To escalate by email, fill in the receiver in
  `docker/logging/alertmanager.yml`.
- **Reading the logs:** from a container on the logging network, e.g.
  `docker compose exec alertmanager wget -qO- 'http://loki:3100/loki/api/v1/query_range?query={service="backend"}|json|event="auth.login.failure"'`,
  or attach Grafana to the logging network with Loki as its data source.

## 14. Deployment

How the production overlay (`docker-compose.prod.yml`, [Deployment.md](Deployment.md)) answers each ASVS 5.0
requirement, and how each was shown. "Rehearsal" is `docker/verify-deployment.sh local`, a full stack on one
machine; "config check" is `npm run check:deployment-config`, which reads the files and needs no server.

| ASVS | Requirement | In place | Shown by |
| :--- | :--- | :--- | :--- |
| V3.5.4 | The website and the API on different host names | Caddy serves `APP_HOST` and `API_HOST` as separate sites ✅ | Rehearsal: a real sign-in across the two names; the cookie is `__Host-`, Secure, HttpOnly, SameSite=Lax |
| V4.1.2 | Only user-facing endpoints redirect HTTP to HTTPS | The website redirects (Caddy's automatic `308`); the API answers plain HTTP with `403`, no redirect ✅ | Rehearsal; config check |
| V12.1.1 | Only TLS 1.2 and 1.3, 1.3 preferred | `protocols tls1.2 tls1.3` ✅ | Rehearsal: 1.3 negotiated by default, 1.1 and 1.0 refused |
| V12.1.2 | Only recommended cipher suites | Six ECDHE suites with AES-GCM or ChaCha20-Poly1305 ✅ | Rehearsal: every TLS 1.2 suite the client knows was tried, and only recommended ones were accepted |
| V12.2.1 | TLS for all client connections to external-facing services | Only the edge publishes a port; nothing answers plain HTTP with content ✅ | Rehearsal; config check |
| V12.2.2 | Publicly trusted certificates | Let's Encrypt, issued and renewed by Caddy ✅ | ⬜ Needs a public domain: `probe` against the real server |
| V12.3.1 | TLS for every inbound and outbound connection, no fallback | MongoDB `requireTLS`; mail TLS mandatory; both enforced at start-up by `REQUIRE_SECURE_BACKENDS` ✅ | Rehearsal (MongoDB without TLS is refused); `check:transport-security` (mail, against real servers: no plain-text fallback, a wrong host name or untrusted certificate is refused) |
| V13.2.1 | Authenticated connections between components, individual accounts | MongoDB `--auth`; `b2g_api` and `b2g_worker` ✅ | Rehearsal: no login is refused; each service connects as its own user |
| V13.2.2 | Least privilege, non-root | `readWrite` on the application database only; application containers non-root with all capabilities dropped and a read-only file system ✅ | Rehearsal: each user sees only its own database and cannot create users; every container's user and capabilities |
| V13.2.3 | No default credentials | Random, distinct, 40-character passwords; the root user is not named `root` or `admin` ✅ | Config check; `generate.sh check` rejects defaults |
| V13.3.1 | A secret store, no secrets in source or build artifacts | Docker secrets, read through `NAME_FILE`; no secret in `.env` or an image ✅ | `check:secret-files`; rehearsal: no secret in any environment |
| V13.3.2 | Least privilege on secrets | Each service lists only its own secrets ✅ | Rehearsal: what each container sees under `/run/secrets`; config check |

The non-root exceptions are third-party images, which keep their own default users (Squid, ClamAV, Loki,
Alloy, Alertmanager); Alloy needs the Docker socket, read-only, to read logs. MongoDB's entrypoint starts as
root only to give its data directory and its secrets to the `mongodb` user, and `mongod` runs as that user.

## 15. Two-step sign-in

(ASVS V6.3.3, V6.4.4, V6.5.1, V6.5.2, V6.5.3, V6.5.4, V6.5.5, V6.5.6, V6.5.8; code in
`Backend/src/services/mfa.service.ts`, `utils/totp.ts`, `utils/recoveryCodes.ts`, `utils/secretBox.ts`)

A password alone is not enough for an account that has a second factor: an **authenticator app** (a
time-based one-time password, TOTP, RFC 6238) and ten **recovery codes** for when the phone is lost.

| ASVS | Requirement in short | In place |
| :--- | :--- | :--- |
| V6.3.3 | A second factor for every sign-in of the privileged accounts | **Admin and Super Admin must have one** (`MFA_REQUIRED_FOR_STAFF`, on by default, always on in production). Until they enrol, `requireRole` answers every staff route `403 MFA_SETUP_REQUIRED` and the website opens *Account security*; only sign-out and the setup routes work. **Vendors may turn it on** for themselves. A sign-in is not complete after the password: it issues a challenge, and a full session only after a correct code (§4) ✅ |
| V6.4.4 | A lost factor is replaced only after an identity check | An Admin resets a **vendor**, the Super Admin resets an **Admin**, and a Super Admin is reset only from the server (`npm run mfa:reset`, which needs access to the container). The form asks for how the identity was checked (`in_person`, `video_call`, `callback_to_known_number`, `other_documented`), why (10–500 characters) and the administrator's **own password**; nobody can reset their own, and nobody resets someone of an equal or higher role. Everything is audit-logged, every session of the account ends, and the owner is emailed ✅ |
| V6.5.1 | Each code and recovery code works once | The highest 30-second step accepted is stored (`lastUsedStep`) and moved forward with one atomic update, so a code of that step or an older one is refused even when two requests race. A recovery code is marked used by one atomic positional update ✅ |
| V6.5.2 | Recovery codes are stored hashed | The password hash (HMAC-SHA256 pre-hash, then bcrypt); only a 4-character id, which selects the hash to check, is kept in the clear. The code is shown once, at creation ✅ |
| V6.5.3 | Seeds and codes come from a CSPRNG | `crypto.randomBytes` for the 160-bit secret and for the codes (rejection sampling, so every character is equally likely). Never `Math.random` ✅ |
| V6.5.4 | A recovery code has enough entropy to withstand guessing | 16 secret characters of a 32-character alphabet = **80 bits** (the requirement is 20). Wrong guesses are also limited (below) ✅ |
| V6.5.5 | A TOTP lives no longer than 30 seconds | The step is 30 seconds (RFC 6238's default). By default one step of drift either way is also accepted (`MFA_TOTP_DRIFT_STEPS=1`), as RFC 6238 §5.2 advises for transmission delay and a phone clock a little off, so a code is accepted for up to 60 seconds after its own step ends. **For a strict 30-second lifetime set `MFA_TOTP_DRIFT_STEPS=0`**: only the current step is then accepted. Either way a code works once, and a code outside the window is refused ✅ |
| V6.5.6 | A lost or stolen factor can be revoked | The owner can turn it off or make new recovery codes (password and a current code asked; the old ones stop working at once), and an administrator can reset it (V6.4.4). A reset ends every session of the account, and turning it off or on ends its other sessions ✅ |
| V6.5.8 | A TOTP is checked against server time | Time comes from the server's clock only (`config/clock.ts`); no request field carries a time, and the schemas refuse any field they do not know ✅ |

### How it works

- **Setup** (`/account/mfa/setup` then `/enable`): the password is asked, a fresh secret is made and
  held, encrypted, as *pending* for 10 minutes; it becomes the account's factor only when a code made
  from it is proven. The ten recovery codes are shown once, in that response. Enabling ends the
  account's other sessions and emails the owner.
- **Signing in:** a correct password on an account with a factor returns `{ "mfaRequired": true }` and a
  5-minute challenge session. `POST /auth/mfa/verify` takes a 6-digit code **or a recovery code** (anything
  that is not exactly six digits is checked as a recovery code, in upper or lower case, with or without
  dashes or spaces), ends the challenge and issues a new session. A challenge is refused by every other route.
- **Wrong codes:** counted apart from wrong passwords. Four free tries, then a lock of 1, 2, 4 … up to 30
  minutes (`423 ACCOUNT_LOCKED`); a correct password does **not** clear it (or someone who knew the
  password could guess codes without end), only a correct code does. On top of that, 10 attempts per IP
  per 15 minutes, and 10 changes of a factor per account per 15 minutes. A wrong code and an unknown
  recovery code give the same answer (`401 INVALID_MFA_CODE`) and cost the same time.
- **Storage:** a collection of its own, `mfacredentials`, so no account query, API view or audit diff can
  carry a secret. The seed is AES-256-GCM encrypted (§2) under `MFA_ENCRYPTION_KEY` (§3), bound to the
  account id; the API refuses to start without the key while staff are required to use a factor. A
  response never contains a seed after setup, and the logs never contain a code or a secret (§13).
- **Staff cannot turn it off.** While `MFA_REQUIRED_FOR_STAFF` is on, an Admin or Super Admin may make
  new recovery codes but not remove the factor; only another administrator's reset can, and the
  account then has to enrol again before it can do anything.
- **Audit:** `account.mfa_enabled`, `account.mfa_disabled`, `account.mfa_recovery_regenerated` and
  `account.mfa_reset` are written to the audit log, with the role in the metadata so that entries about staff
  stay visible to the Super Admin only, like every other audit entry about staff.

### What an operator must know

- **The server's clock must be right** (NTP), or correct codes are refused. It is the only clock used.
- **`MFA_ENCRYPTION_KEY` must be kept** (§3): without it no authenticator can be read.
- **If someone loses both the phone and the recovery codes,** an administrator resets them (above); the
  steps are in [Deployment.md](Deployment.md#5-day-to-day).
- **Not covered:** hardware security keys / passkeys (WebAuthn), SMS or email codes (deliberately not
  offered: a phone number or inbox is a weaker factor than the app), and a trusted-device "remember me".
