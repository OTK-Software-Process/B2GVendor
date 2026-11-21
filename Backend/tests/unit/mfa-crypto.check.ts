import { randomBytes } from 'node:crypto';
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchingTimeStep, otpauthUri, timeStep, totpAt, TOTP_SECRET_BYTES } from '../../src/utils/totp';
import { decrypt, encrypt, parseKey, SecretBoxError } from '../../src/utils/secretBox';
import { generateRecoveryCode, looksLikeTotpCode, parseRecoveryCode, RECOVERY_CODE_COUNT, RECOVERY_SECRET_BITS } from '../../src/utils/recoveryCodes';

// The cryptography of two-step verification (ASVS V6.3.3, V6.5.1-V6.5.8):
// TOTP checked against the PUBLISHED test vectors of RFC 4226 and RFC 6238, Base32
// against RFC 4648, the encryption of the stored seed, and the recovery codes.
// Run: npm run check:mfa-crypto

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function throws(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function main(): void {
  // ---------------------------------------------------------------- RFC 4648 Base32
  const base32Vectors: [string, string][] = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  record(base32Vectors.every(([plain, encoded]) => base32Encode(Buffer.from(plain)) === encoded), 'Base32 encodes the RFC 4648 test vectors (without padding)');
  record(base32Vectors.every(([plain, encoded]) => base32Decode(encoded).toString() === plain), 'Base32 decodes them back');
  record(base32Decode('mzxw 6ytb oi======').toString() === 'foobar', 'Base32 decoding accepts lower case, spaces and padding (a key retyped by hand)');
  record(throws(() => base32Decode('MZXW1')) !== null, 'Base32 decoding refuses a character outside the alphabet (1 is not Base32)');
  const roundTrips = Array.from({ length: 200 }, () => randomBytes(1 + Math.floor(Math.random() * 40))).every(bytes => base32Decode(base32Encode(bytes)).equals(bytes));
  record(roundTrips, 'random byte strings of 1 to 40 bytes survive encode then decode');

  // ---------------------------------------------------------------- RFC 4226 HOTP
  const rfcKey = Buffer.from('12345678901234567890');
  const hotpVectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  record(hotpVectors.every((expected, counter) => hotp(rfcKey, counter) === expected), 'HOTP gives the ten RFC 4226 test values (counters 0 to 9)', hotpVectors.map((_, c) => hotp(rfcKey, c)).join(' '));
  record(hotp(rfcKey, 2 ** 33 + 5, 8).length === 8, 'a counter beyond 32 bits is handled (the high word of the counter is used)');

  // ---------------------------------------------------------------- RFC 6238 TOTP
  const secret = base32Encode(rfcKey);
  const totpVectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  record(totpVectors.every(([seconds, expected]) => totpAt(secret, seconds * 1000, { digits: 8 }) === expected), 'TOTP gives the six RFC 6238 test values (8 digits, 30 s step)');
  record(totpVectors.every(([seconds, expected]) => totpAt(secret, seconds * 1000) === expected.slice(2)), 'and the same moments give the last six digits as 6-digit codes, as authenticator apps show them');
  record(timeStep(59_000) === 1 && timeStep(60_000) === 2 && timeStep(29_999) === 0 && timeStep(30_000) === 1, 'the step changes exactly every 30 seconds');

  // ---------------------------------------------------------------- generated secrets
  const secrets = Array.from({ length: 500 }, () => generateTotpSecret());
  record(secrets.every(s => /^[A-Z2-7]{32}$/.test(s)), 'a generated secret is 32 Base32 characters');
  record(secrets.every(s => base32Decode(s).length === TOTP_SECRET_BYTES) && TOTP_SECRET_BYTES * 8 === 160, 'and decodes to 20 bytes: 160 random bits (RFC 4226 recommends 160)');
  record(new Set(secrets).size === secrets.length, '500 generated secrets are all different');

  // ---------------------------------------------------------------- the drift window and replay inputs
  const key = generateTotpSecret();
  const T = 1_700_000_015_000; // 15 s into a step
  const step = timeStep(T);
  const codeAt = (offset: number): string => totpAt(key, (step + offset) * 30_000);
  record(matchingTimeStep(key, codeAt(0), T, 1) === step, 'the code of the current step is accepted and its step number returned');
  record(matchingTimeStep(key, codeAt(-1), T, 1) === step - 1 && matchingTimeStep(key, codeAt(1), T, 1) === step + 1, 'with one step of drift, the previous and the next step are accepted (a phone clock a little off)');
  record(matchingTimeStep(key, codeAt(-2), T, 1) === null && matchingTimeStep(key, codeAt(2), T, 1) === null, 'two steps away is refused: a code does not live beyond its step plus one step of drift');
  record(matchingTimeStep(key, codeAt(-1), T, 0) === null && matchingTimeStep(key, codeAt(0), T, 0) === step, 'with no drift allowed only the current step counts');
  record(matchingTimeStep(key, codeAt(0), T + 31_000, 0) === null, 'a code is refused once 30 seconds have passed (checked against the SERVER time given, not a time the code carries)');
  const wrongCode = String((Number(codeAt(0)) + 1) % 1_000_000).padStart(6, '0');
  record(matchingTimeStep(key, wrongCode, T, 1) === null, 'a wrong code is refused');
  for (const bad of ['12345', '1234567', 'abcdef', '12 3456', '', '１２３４５６', '12345a']) {
    if (matchingTimeStep(key, bad, T, 1) !== null) record(false, `the input ${JSON.stringify(bad)} must not match`);
  }
  record(true, 'inputs that are not exactly six ASCII digits never match (5 or 7 digits, letters, spaces, full-width digits)');
  record(matchingTimeStep(key, totpAt(key, 5_000), 5_000, 1) === 0, 'a clock at the very start of time works: the window skips the steps before step 0 instead of failing');

  const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'a.b@example.com', issuer: 'B2G Vendor' });
  const parsed = new URL(uri);
  record(parsed.protocol === 'otpauth:' && parsed.host === 'totp' && decodeURIComponent(parsed.pathname) === '/B2G Vendor:a.b@example.com', 'the otpauth address names the issuer and the account', uri);
  record(parsed.searchParams.get('secret') === 'JBSWY3DPEHPK3PXP' && parsed.searchParams.get('issuer') === 'B2G Vendor' && parsed.searchParams.get('digits') === '6' && parsed.searchParams.get('period') === '30' && parsed.searchParams.get('algorithm') === 'SHA1', 'and states the algorithm, digits and period explicitly');

  // ---------------------------------------------------------------- the box that holds the seed
  const boxKey = parseKey(randomBytes(32).toString('base64'));
  const seed = generateTotpSecret();
  const sealed = encrypt(seed, boxKey, 'account-1');
  record(sealed.startsWith('v1.') && sealed.split('.').length === 4 && !sealed.includes(seed), 'an encrypted seed is versioned and does not contain the seed');
  record(decrypt(sealed, boxKey, 'account-1') === seed, 'it decrypts back to the seed');
  record(encrypt(seed, boxKey, 'account-1') !== sealed, 'encrypting the same seed twice gives different results (a fresh IV each time)');
  record(throws(() => decrypt(sealed, parseKey(randomBytes(32).toString('base64')), 'account-1')) !== null, 'a different key cannot decrypt it');
  record(throws(() => decrypt(sealed, boxKey, 'account-2')) !== null, 'another account cannot decrypt it: the ciphertext is bound to its owner');
  const parts = sealed.split('.');
  const flip = (value: string): string => (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
  record(throws(() => decrypt([parts[0], flip(parts[1]), parts[2], parts[3]].join('.'), boxKey, 'account-1')) !== null, 'changing the IV is detected');
  record(throws(() => decrypt([parts[0], parts[1], flip(parts[2]), parts[3]].join('.'), boxKey, 'account-1')) !== null, 'changing the authentication tag is detected');
  record(throws(() => decrypt([parts[0], parts[1], parts[2], flip(parts[3])].join('.'), boxKey, 'account-1')) !== null, 'changing the ciphertext is detected');
  record(throws(() => decrypt(['v2', ...parts.slice(1)].join('.'), boxKey, 'account-1')) !== null && throws(() => decrypt('garbage', boxKey, 'account-1')) !== null, 'an unknown version, or something that is not an encrypted value, is refused');
  record(throws(() => decrypt(sealed, boxKey, 'account-1'.padEnd(500, 'x'))) !== null, 'a different associated value fails to decrypt');
  record(throws(() => parseKey(randomBytes(31).toString('base64'))) !== null && throws(() => parseKey('not base64 at all!')) !== null, 'a key that is not exactly 32 bytes is refused');
  const decryptError = throws(() => decrypt(sealed, boxKey, 'account-2'));
  record(decryptError !== null && !decryptError.includes(seed) && !decryptError.includes(boxKey.toString('base64')), 'a failed decryption says nothing about the seed or the key');
  record(decrypt(encrypt('ภาษาไทย 🔑', boxKey, 'ผู้ใช้'), boxKey, 'ผู้ใช้') === 'ภาษาไทย 🔑', 'text and associated data in any language round-trip');
  record(new SecretBoxError('x') instanceof Error, 'failures are SecretBoxError, so callers can tell them from bugs');

  // ---------------------------------------------------------------- recovery codes
  const codes = Array.from({ length: 5000 }, () => generateRecoveryCode());
  record(codes.every(c => /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/.test(c.display)), 'a recovery code is five groups of four characters from Crockford\'s alphabet (no I, L, O or U)', codes[0].display);
  record(codes.every(c => c.id.length === 4 && c.secret.length === 16 && c.display.replace(/-/g, '') === c.id + c.secret), 'it is a 4-character ID plus a 16-character secret');
  record(RECOVERY_SECRET_BITS === 80 && RECOVERY_SECRET_BITS >= 20, 'the secret carries 80 random bits (V6.5.4 asks for at least 20)');
  record(new Set(codes.map(c => c.secret)).size === codes.length, '5000 generated secrets are all different');
  const counts = new Map<string, number>();
  for (const c of codes) for (const ch of c.secret) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const expected = (codes.length * 16) / 32;
  const chiSquare = [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
  record(counts.size === 32 && chiSquare < 70, 'every one of the 32 characters occurs, and evenly (no modulo bias)', `chi-square ${chiSquare.toFixed(1)} over 31 degrees of freedom (a fair source stays under about 52)`);
  record(RECOVERY_CODE_COUNT === 10, 'ten codes are issued at a time');

  const sample = generateRecoveryCode();
  const typed = sample.display.toLowerCase().replace(/-/g, ' ');
  record(JSON.stringify(parseRecoveryCode(typed)) === JSON.stringify({ id: sample.id, secret: sample.secret }), 'a code typed in lower case with spaces instead of hyphens is read correctly');
  record(JSON.stringify(parseRecoveryCode(sample.display)) === JSON.stringify({ id: sample.id, secret: sample.secret }) && JSON.stringify(parseRecoveryCode(sample.display.replace(/-/g, ''))) === JSON.stringify({ id: sample.id, secret: sample.secret }), 'and so is the code as shown, or with the hyphens left out');
  const lookalike = parseRecoveryCode('OOOO-IIII-LLLL-0000-1111');
  record(lookalike?.id === '0000' && lookalike.secret === '1111111100001111', 'O is read as 0, and I or L as 1 (Crockford\'s look-alikes)', JSON.stringify(lookalike));
  record(parseRecoveryCode('ABCD-EFGH') === null && parseRecoveryCode('') === null && parseRecoveryCode('A'.repeat(21)) === null, 'a code of the wrong length is refused');
  record(parseRecoveryCode('UUUU-UUUU-UUUU-UUUU-UUUU') === null && parseRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAA$') === null, 'characters outside the alphabet (U, $) are refused');
  record(looksLikeTotpCode('123456') && looksLikeTotpCode(' 123456 ') && !looksLikeTotpCode('12345') && !looksLikeTotpCode('1234567') && !looksLikeTotpCode('ABCD-EFGH'), 'six digits are an authenticator code; anything else is not');

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
