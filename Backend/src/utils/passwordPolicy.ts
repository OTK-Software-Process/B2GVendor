import { z } from 'zod';
import { AppError } from './AppError';

// One password policy for sign-up, change, reset and admin seeding (SRS FR-1.9,
// docs/Security.md section 12):
//
//   - 8 to 128 characters, counted as Unicode code points (Thai vowel and tone
//     marks count like any letter). ANY characters: no rule about letters,
//     digits or symbols (ASVS V6.2.5) -- length and the checks below are what
//     make a password strong. 128 is far past the 64 ASVS V6.2.9 asks for; the
//     hasher pre-hashes, so length no longer runs into bcrypt's 72-byte limit.
//   - not built mostly from context-specific words (ASVS V6.1.2, V6.2.11);
//   - not in a known breach (integrations/haveIBeenPwned.client.ts).

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_TOO_LONG = `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
export const PASSWORD_TOO_GUESSABLE =
  'This password is too easy to guess: it is mostly the name of this site, your name or your email address. Add words of your own.';

const codePoints = (value: string): number => Array.from(value).length;

/** The new-password field of every form (sign-up, change, reset). */
export const passwordSchema = z
  .string()
  .refine(password => codePoints(password) >= PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT)
  .refine(password => codePoints(password) <= PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG);

/**
 * The documented list of context-specific words (ASVS V6.1.2): the product, the
 * systems and data it is about, and the role names it uses. Written already
 * normalised (lower case, letters and digits only). docs/Security.md section 12
 * lists the same words.
 */
export const CONTEXT_WORDS: readonly string[] = [
  'b2gvendor',
  'b2g',
  'vendor',
  'egp',
  'gprocurement',
  'procurement',
  'datagoth',
  'tor',
  'admin',
  'superadmin',
  'administrator',
  'password',
  'จัดซื้อจัดจ้าง',
  'จัดซื้อ',
  'จัดจ้าง',
  'ภาครัฐ',
  'ราชการ',
  'ประกวดราคา',
  'รหัสผ่าน'
];

/** Lower case, NFKC, letters and digits only (Thai included), no spaces or symbols. */
export function normaliseForWordCheck(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

export interface PasswordOwner {
  email?: string | null;
  name?: string | null;
  companyName?: string | null;
  taxId?: string | null;
}

/** The words specific to this person: email name and domain label, name parts, company words, tax ID. */
function ownerWords(owner: PasswordOwner): string[] {
  const words: string[] = [];
  if (owner.email) {
    const [local, domain = ''] = owner.email.toLowerCase().split('@');
    words.push(local, ...local.split(/[^\p{L}\p{N}]+/u), domain.split('.')[0] ?? '');
  }
  for (const text of [owner.name, owner.companyName]) {
    if (text) words.push(text, ...text.split(/\s+/));
  }
  if (owner.taxId) words.push(owner.taxId);
  return words.map(normaliseForWordCheck);
}

/**
 * ASVS V6.2.11: refuses a password that is MOSTLY context words -- the site's
 * name, the procurement system, a role, or the person's own name, email or
 * company. Every listed word (3+ characters) found in the normalised password is
 * taken out; if fewer than 8 characters of the person's own remain, the password
 * is refused. "b2gvendor2026!" or "Somchai1234" are refused; a long passphrase
 * that happens to contain "vendor" is not.
 */
export function isTooGuessable(password: string, owner: PasswordOwner = {}): boolean {
  let rest = normaliseForWordCheck(password);
  const words = [...new Set([...CONTEXT_WORDS, ...ownerWords(owner)])]
    .filter(word => codePoints(word) >= 3)
    .sort((a, b) => codePoints(b) - codePoints(a)); // longest first: "b2gvendor" before "b2g"
  let matched = false;
  for (const word of words) {
    if (rest.includes(word)) {
      matched = true;
      rest = rest.split(word).join('');
    }
  }
  return matched && codePoints(rest) < PASSWORD_MIN_LENGTH;
}

/** Throws a 400 VALIDATION_ERROR on `field` when the password is mostly context words. */
export function assertPasswordNotGuessable(password: string, owner: PasswordOwner, field = 'password'): void {
  if (isTooGuessable(password, owner)) {
    throw AppError.validation({ [field]: PASSWORD_TOO_GUESSABLE });
  }
}
