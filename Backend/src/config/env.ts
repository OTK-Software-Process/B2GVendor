import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  APP_URL: z.string().url().default('http://localhost:3000'),

  // In production the name always carries the __Host- prefix (see config/cookie.ts).
  SESSION_COOKIE_NAME: z.string().default('b2g_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Inactivity timeouts (ASVS V7.3.1, docs/Security.md section 4). A session
  // that makes no request for this long is ended and must sign in again.
  // Staff accounts change configuration and other people's accounts, so they
  // time out much sooner than vendors, who only manage their own follows.
  SESSION_IDLE_MINUTES_STAFF: z.coerce.number().int().min(1).default(30),
  SESSION_IDLE_MINUTES_VENDOR: z.coerce.number().int().min(1).default(1440),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // --- Anti-automation (ASVS V2.4.1, V15.2.2) ---
  // Public search (GET /works) per client address per minute. A person paging
  // and filtering stays far below it; a scraper is slowed. The website's own
  // server-side renders forward the visitor's address, so they don't share one
  // budget (B2GVendor/src/lib/serverApi.ts).
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  // Poll Now requests per admin account per minute (the poll lock already
  // allows only one poll at a time; this stops a client hammering the route).
  POLL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  // Longest one search query may run in MongoDB before it is stopped (503).
  SEARCH_MAX_TIME_MS: z.coerce.number().int().min(100).default(5000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('B2G Vendor <no-reply@b2gvendor.local>'),
  // How many instant-notification emails are sent at the same time. One by one,
  // a popular tag (hundreds of followers) times a poll's new works took longer
  // than the ~5 minutes instant notifications are promised in (see
  // tests/integration/notification-latency.check.ts). Keep it within what the
  // SMTP provider allows per connection burst.
  EMAIL_SEND_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),

  // --- Data ingestion (N1) ---
  EGP_RSS_BASE_URL: z
    .string()
    .url()
    .default('https://process3.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml'),
  DATA_GO_TH_BASE_URL: z.string().url().default('https://data.go.th'),
  DATA_GO_TH_API_KEY: z.string().optional(),
  // CGD's contract/enrichment datasets are periodic batch drops -- a fixed
  // resource_id ages out every fiscal period. When a GovSite has no manually
  // pinned dataGoThResourceId, dataGoThResource.service.ts resolves the
  // current one at poll time via package_show, from this default dataset id
  // (override per-GovSite with dataGoThPackageId when a site uses a
  // different CKAN package).
  DATA_GO_TH_DEFAULT_PACKAGE_ID: z.string().optional(),
  // Fallback for a dataset published as one new package per period rather
  // than dated resources inside one stable package (confirmed true of CGD's
  // own contract data -- see dataGoTh.client.ts): a raw CKAN package_search
  // query used to find the newest matching package when neither a
  // GovSite's nor this default package id resolves.
  DATA_GO_TH_DEFAULT_SEARCH_QUERY: z.string().optional(),

  // Read the ONE HTML announcement page an RSS item links to (in practice every
  // winner announcement, W0) so its price -- the winning bid -- can be shown.
  // This deliberately overrides the earlier "never fetch an HTML page" rule
  // (and that host's robots.txt); set to false to go back to treating such a
  // link as a reference URL only. See integrations/egpRss.client.ts.
  EGP_HTML_TOR_ENABLED: z
    .string()
    .default('true')
    .transform(v => v === 'true'),

  // How often (ms) the worker checks for queued PollJob rows.
  POLL_JOB_CLAIM_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // A poll job (one site, or "all sites") that is still going after this many
  // minutes is stopped and logged as failed, so a stuck government server can't
  // hold the "Poll Now" lock for ever. Default 2 h = the shortest schedule interval.
  POLL_JOB_MAX_DURATION_MINUTES: z.coerce.number().positive().default(120),
  // Time limit for ONE request to the e-GP feed or data.go.th. Without it a server
  // that accepts the connection and never answers blocks the whole poll.
  INGESTION_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // (The scheduled-poll interval is NOT an env var: an admin sets it from the
  // UI -- default 24h, minimum 2h -- see config/polling.ts and
  // models/ingestionSettings.model.ts.)

  // Local disk path for downloaded TOR PDFs (FR-N1.6). Swap for a real
  // object-storage bucket later without changing the ingestion pipeline's
  // call shape -- see services/fileStorage.service.ts.
  TOR_STORAGE_DIR: z.string().default('storage/tor'),

  // Customer requirement: only ingest works related to a specific topic
  // (e.g. "software") -- see Tag.includeInIngestionFilter and
  // ingestion.service.ts's inScopeTagIds. Off by default so existing
  // dev/test setups (and this repo's own seeded test data) keep working
  // unchanged until an admin both flips this AND flags at least one tag.
  // Requires AI_TAGGING_ENABLED=true below -- with AI off, no work can ever
  // be classified as in-scope, so literally nothing would be ingested.
  INGESTION_TOPIC_FILTER_ENABLED: z
    .string()
    .default('false')
    .transform(v => v === 'true'),

  // --- AI-assisted tagging (N3) ---
  // Soft on/off switch -- ingestion must keep working with this off (e.g. no
  // credentials in local dev); see NFR-N3.7, AI tagging is best-effort.
  AI_TAGGING_ENABLED: z
    .string()
    .default('false')
    .transform(v => v === 'true'),
  // Which backend actually serves analyzeTorDocument() -- see
  // integrations/ai/index.ts. Swappable per-environment with no code change.
  AI_PROVIDER: z.enum(['openrouter', 'vertexai']).default('openrouter'),

  // OpenRouter (https://openrouter.ai) -- OpenAI-compatible chat-completions
  // API, one API key covers many hosted models.
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('qwen/qwen3.5-flash-02-23'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),

  // Vertex AI (Google Cloud) -- the original provider, kept as an alternative.
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('asia-southeast1'),
  VERTEX_AI_MODEL: z.string().default('gemini-2.0-flash-001'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional()
}).superRefine((value, ctx) => {
  // Links are HTTPS in production: APP_URL is what every emailed link
  // (verification, password reset, notifications, unsubscribe) is built from,
  // and in production the session cookie is Secure, so a plain-http frontend
  // couldn't sign anyone in anyway. Refuse to start rather than mail out
  // plain-http links.
  if (value.NODE_ENV === 'production' && !/^https:\/\//i.test(value.APP_URL)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APP_URL'], message: 'APP_URL must be an https:// address in production' });
  }
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const corsOrigins: string[] = env.CORS_ORIGIN.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
