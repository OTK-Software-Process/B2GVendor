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
  MAIL_FROM: z.string().default('B2G Vendor <no-reply@b2gvendor.local>')
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const corsOrigins: string[] = env.CORS_ORIGIN.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
