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

  // How often (ms) the worker checks for queued PollJob rows.
  POLL_JOB_CLAIM_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Fallback poll interval for a GovSite that doesn't specify its own.
  POLL_DEFAULT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),

  // Local disk path for downloaded TOR PDFs (FR-N1.6). Swap for a real
  // object-storage bucket later without changing the ingestion pipeline's
  // call shape -- see services/fileStorage.service.ts.
  TOR_STORAGE_DIR: z.string().default('storage/tor'),

  // --- AI-assisted tagging (N3, planned: Vertex AI) ---
  // Soft on/off switch -- ingestion must keep working with this off (e.g. no
  // GCP credentials in local dev); see NFR-N3.7, AI tagging is best-effort.
  AI_TAGGING_ENABLED: z
    .string()
    .default('false')
    .transform(v => v === 'true'),
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
