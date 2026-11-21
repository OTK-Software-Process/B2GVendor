import { randomBytes } from 'node:crypto';

// Recovery codes: what a person uses to sign in when their authenticator is lost
// (ASVS V6.4.4, V6.5.1-V6.5.4). Each code works once.
//
// Alphabet: Crockford's Base32 (no I, L, O, U), so a code written down on paper is
// hard to misread. A random character from it carries exactly 5 bits.
//
// A code is 20 characters: a 4-character ID that names which stored hash to check
// (so a sign-in compares ONE bcrypt hash, not ten) and a 16-character secret of 80
// random bits, from the CSPRNG. Only the secret is hashed; the ID is not secret.
// 80 bits is far over the 20 bits V6.5.4 asks for, and the hash (bcrypt, with its
// own random salt) is what V6.5.2 asks for below 112 bits.

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 4;
const SECRET_LENGTH = 16;

/** `count` random characters, 5 bits each, with no modulo bias (32 divides 256). */
export function randomCharacters(count: number): string {
  const bytes = randomBytes(Math.ceil((count * 5) / 8));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < count) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export interface NewRecoveryCode {
  /** Names the stored hash; kept in the clear. */
  id: string;
  /** The part that is hashed. Shown to the person once, never stored. */
  secret: string;
  /** What the person sees and keeps: five groups of four. */
  display: string;
}

export function generateRecoveryCode(): NewRecoveryCode {
  const id = randomCharacters(ID_LENGTH);
  const secret = randomCharacters(SECRET_LENGTH);
  return { id, secret, display: `${id}${secret}`.match(/.{4}/g)!.join('-') };
}

/**
 * Reads what a person typed. Case, spaces and hyphens do not matter, and the
 * characters Crockford's alphabet treats as look-alikes are read as the digit
 * (O as 0, I and L as 1). Returns null for anything that cannot be a code.
 */
export function parseRecoveryCode(input: string): { id: string; secret: string } | null {
  const normalised = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (normalised.length !== ID_LENGTH + SECRET_LENGTH) return null;
  if ([...normalised].some(char => !ALPHABET.includes(char))) return null;
  return { id: normalised.slice(0, ID_LENGTH), secret: normalised.slice(ID_LENGTH) };
}

/** A six-digit authenticator code, as opposed to a recovery code. */
export function looksLikeTotpCode(input: string): boolean {
  return /^\d{6}$/.test(input.trim());
}

export const RECOVERY_SECRET_BITS = SECRET_LENGTH * 5;
