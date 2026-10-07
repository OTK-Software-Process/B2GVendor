'use client';

import { useSyncExternalStore } from 'react';
import { savedSearchHref, subscribeSavedFilters } from './savedSearchFilters';

// The href for any link to the search page: "/search" plus the filters the user
// has left on, so going there (from the navbar, the footer, a work's TOR page)
// never loses them -- until they clear them. On the server, and for the first
// client render, it is the bare "/search", so nothing differs from the
// server-rendered markup; it updates right after hydration.
export function useSearchHref(): string {
  return useSyncExternalStore(subscribeSavedFilters, savedSearchHref, () => '/search');
}
