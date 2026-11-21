import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encryption of a secret that has to be READ BACK, unlike a password: an
// authenticator's seed must be known to the server to check a code, so it cannot
// be stored as a one-way hash (ASVS V11.3, docs/Security.md section 2).
//
// AES-256-GCM, a fresh random 96-bit IV for every encryption, and the owner's
// account id as additional authenticated data. The last one binds a ciphertext to
// ONE account: copying one account's encrypted seed onto another (a database
// write is all it takes) makes decryption fail instead of quietly sharing a factor.
//
// Stored form:  v1.<iv>.<tag>.<ciphertext>   (base64url). The "v1" is the key
// version, so that a future key rotation can tell which key a value needs.

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/** Reads a key given as 32 random bytes in base64 (`openssl rand -base64 32`). */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new SecretBoxError(`The key must be ${KEY_BYTES} bytes in base64 (openssl rand -base64 32); this one decodes to ${key.length}`);
  return key;
}

export function encrypt(plaintext: string, key: Buffer, associatedData: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Throws SecretBoxError for a wrong key, another account's data, or any change to the stored value. */
export function decrypt(token: string, key: Buffer, associatedData: string): string {
  const [version, iv, tag, ciphertext, ...rest] = token.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) throw new SecretBoxError('Not an encrypted value this version understands');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('The value could not be decrypted (wrong key, another account, or it was changed)');
  }
}
