import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time passwords (TOTP, RFC 6238 over HOTP, RFC 4226), the second
// factor of ASVS V6.3.3. Built on Node's `crypto` only: nothing here is a
// cryptographic primitive of our own.
//
// The parameters are the ones every authenticator app understands. HMAC-SHA1 is
// not a weakness here (an HMAC does not depend on the collision resistance that
// broke plain SHA-1) and it is the one algorithm Google Authenticator honours.
//
// Time ALWAYS comes from the server clock, passed in by the caller from
// Date.now(). No function here reads a time the client sent (ASVS V6.5.8).

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** 20 bytes = 160 bits, the length RFC 4226 recommends for an HMAC-SHA1 key. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 Base32, without padding (what authenticator apps expect in an otpauth:// address). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes Base32. Lower case, spaces and `=` padding are accepted (people retype the key); anything else is an error. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Not a Base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new authenticator secret from the operating system's CSPRNG (ASVS V6.5.3), as Base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** HOTP (RFC 4226): the dynamic truncation of HMAC-SHA1(secret, counter), as `digits` digits. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  // JavaScript numbers hold 2^53 exactly: far past the year 285,000,000 for a 30-second counter.
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The counter (time step) that `timeMs` falls in. */
export function timeStep(timeMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(timeMs / 1000 / stepSeconds);
}

/** The code an authenticator app shows at `timeMs`. */
export function totpAt(secretBase32: string, timeMs: number, options: { digits?: number; stepSeconds?: number } = {}): string {
  return hotp(base32Decode(secretBase32), timeStep(timeMs, options.stepSeconds), options.digits ?? TOTP_DIGITS);
}

/**
 * Which time step `code` belongs to, or null if it matches none within
 * `driftSteps` steps of `nowMs` (either side, to absorb the clock of the phone).
 *
 * Every candidate step is always computed and compared in constant time, so how
 * long this takes does not say which step (or how many digits) matched.
 * The caller must still refuse a step it has already accepted (see
 * mfa.service.ts): a valid code may be used once (ASVS V6.5.1).
 */
export function matchingTimeStep(secretBase32: string, code: string, nowMs: number, driftSteps: number, digits = TOTP_DIGITS): number | null {
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null;
  const secret = base32Decode(secretBase32);
  const supplied = Buffer.from(code);
  const current = timeStep(nowMs);
  let matched: number | null = null;
  for (let step = current - driftSteps; step <= current + driftSteps; step += 1) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step, digits));
    if (timingSafeEqual(supplied, expected) && (matched === null || step > matched)) matched = step;
  }
  return matched;
}

/** The address a QR code or a tap-to-add link carries (Google's Key URI format). */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const query = new URLSearchParams({ secret: options.secret, issuer: options.issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString().replace(/\+/g, '%20')}`;
}
