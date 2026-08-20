import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CORS_ORIGIN: z.string().default('http://localhost:3000')
});

export type Env = z.infer<typeof envSchema>;

// Fails fast with a readable message if a required var is missing/invalid,
// instead of the server booting halfway and failing on first use.
export const env: Env = envSchema.parse(process.env);
