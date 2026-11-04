import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertPasswordNotPwned } from '../../src/integrations/haveIBeenPwned.client';
import { AppError } from '../../src/utils/AppError';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const password = 'password';
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  let capturedUrl = '';
  let capturedHeaders: Headers | undefined;

  try {
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(`${suffix}:42\r\n${'0'.repeat(35)}:0\r\n`);
    };

    await assert.rejects(
      assertPasswordNotPwned(password),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 400 &&
        error.message.includes('appeared in known data breaches'),
    );
    assert.equal(capturedUrl, `https://api.pwnedpasswords.com/range/${prefix}`);
    assert.equal(capturedUrl.includes(hash), false);
    assert.equal(capturedHeaders?.get('Add-Padding'), 'true');

    globalThis.fetch = async () => new Response(`${'A'.repeat(35)}:0\r\n`);
    await assertPasswordNotPwned('a-different-password');

    globalThis.fetch = async () => {
      throw new Error('network unavailable');
    };
    await assert.rejects(
      assertPasswordNotPwned('another-password'),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 503 &&
        error.code === 'SERVICE_UNAVAILABLE',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => console.log('Have I Been Pwned password checks passed.'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
