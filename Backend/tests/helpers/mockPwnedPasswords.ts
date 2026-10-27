export function mockPwnedPasswords(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith('https://api.pwnedpasswords.com/range/')) {
      return new Response(`${'0'.repeat(35)}:0\r\n`);
    }

    return originalFetch(input, init);
  };
}
