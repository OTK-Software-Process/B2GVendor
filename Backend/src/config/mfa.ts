import { env } from './env';
import { parseKey } from '../utils/secretBox';

// Two-step verification's configuration, in one place (docs/Security.md section 15).

let cached: { raw: string; key: Buffer } | null = null;

/** The encryption key for authenticator secrets, or null when none is configured. Throws if one is set but wrong. */
export function mfaKey(): Buffer | null {
  const raw = env.MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  if (cached?.raw !== raw) cached = { raw, key: parseKey(raw) };
  return cached.key;
}

/**
 * Problems that must stop the API from starting (server.ts). A staff account
 * cannot be made to use a second factor without a key to store its secret, and
 * silently letting staff in without one would defeat the requirement.
 */
export function mfaConfigurationProblems(): string[] {
  const problems: string[] = [];
  if (env.MFA_ENCRYPTION_KEY) {
    try {
      parseKey(env.MFA_ENCRYPTION_KEY);
    } catch (error) {
      problems.push(`MFA_ENCRYPTION_KEY is not usable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (env.MFA_REQUIRED_FOR_STAFF) {
    problems.push('MFA_ENCRYPTION_KEY is not set, and Admin accounts must use a second factor (MFA_REQUIRED_FOR_STAFF). Generate a key with: openssl rand -base64 32. For a development setup without two-step verification, set MFA_REQUIRED_FOR_STAFF=false.');
  }
  return problems;
}
