'use client';

import { useSyncExternalStore } from 'react';

// Emailed one-time links carry their token after the `#`
// (/reset-password#token=..., /verify-email#token=..., /unsubscribe#token=...).
// A URL fragment is never sent to any server -- not ours, not a proxy, not in a
// Referer header -- so the token cannot land in an access log (ASVS V14.2.1).
// The page reads it here, in the browser, and posts it in a request body.

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = (): string => window.location.hash;
// On the server (and during hydration) the fragment is unknown.
const noHashYet = (): string | null => null;

/**
 * The `token` from the page's URL fragment: `undefined` until the browser has
 * been read, `null` when the link has none, otherwise the token.
 */
export function useFragmentToken(): string | null | undefined {
  const hash = useSyncExternalStore<string | null>(subscribe, readHash, noHashYet);
  if (hash === null) return undefined;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && token.length > 0 ? token : null;
}

/** The fragment form of a page link, for an old /page/<token> URL. */
export function fragmentTokenUrl(page: string, token: string): string {
  return `/${page}#token=${encodeURIComponent(token)}`;
}
