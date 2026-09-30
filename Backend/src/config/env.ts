import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  APP_URL: z.string().url().default('http://localhost:3000'),

  SESSION_COOKIE_NAME: z.string().default('b2g_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('B2G Vendor <no-reply@b2gvendor.local>'),

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
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const corsOrigins: string[] = env.CORS_ORIGIN.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
