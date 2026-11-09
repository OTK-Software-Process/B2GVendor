import { createHash } from 'crypto';

export interface PwnedPasswordsMock {
  setBreachedPasswords(passwords: string[]): void;
  setUnavailable(unavailable: boolean): void;
  restore(): void;
}

export function mockPwnedPasswords(): PwnedPasswordsMock {
  const originalFetch = globalThis.fetch;
  let breachedPasswords = new Set<string>();
  let unavailable = false;

  const mockedFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith('https://api.pwnedpasswords.com/range/')) {
      if (unavailable) {
        return new Response('mock HIBP outage', { status: 503 });
      }

      const prefix = url.slice(url.lastIndexOf('/') + 1).toUpperCase();
      const matches = [...breachedPasswords]
        .map(password => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase())
        .filter(hash => hash.slice(0, 5) === prefix)
        .map(hash => `${hash.slice(5)}:1`);
      return new Response([`${'0'.repeat(35)}:0`, ...matches].join('\r\n'));
    }

    return originalFetch(input, init);
  };

  globalThis.fetch = mockedFetch;
  return {
    setBreachedPasswords: passwords => {
      breachedPasswords = new Set(passwords);
    },
    setUnavailable: value => {
      unavailable = value;
    },
    restore: () => {
      if (globalThis.fetch === mockedFetch) {
        globalThis.fetch = originalFetch;
      }
    }
  };
}
