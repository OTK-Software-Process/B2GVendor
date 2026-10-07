// Remembers the search page's filters so they survive leaving the page.
//
// The filters (keyword, status, site, tags, budget, fiscal year) and the sort /
// view choice live only in the search page's URL. That survives a refresh, but
// not a trip to a work's TOR page and back through a plain "/search" link (the
// back link, the navbar, the footer), which starts clean. So the URL's filters
// are copied here whenever they change, and put back when the search page is
// reached with none -- until the user clears them (the page's own clear
// buttons / chip crosses empty the URL, which empties this).
//
// Saved in localStorage so they also survive closing the tab. Everything is
// wrapped in try/catch: storage can be missing (SSR), blocked, or full, and the
// search page must work exactly as before when it is.

const STORAGE_KEY = 'b2g.search.filters';

// What the page keeps in its URL, minus `page`: a page number belongs to one
// result list, not to the filters, and would be stale once the data changes.
export const SAVED_FILTER_KEYS = ['q', 'status', 'site', 'tags', 'budgetMax', 'fiscalYear', 'sortBy', 'view'] as const;

// Far longer than any real filter set (tag ids are 24 chars each).
const MAX_QUERY_LENGTH = 2000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // even touching localStorage can throw (blocked site data)
  }
}

/** The filter part of a URL's query, as a query string -- only the known keys, never `page`. '' when none. */
export function pickFilterQuery(params: URLSearchParams): string {
  const picked = new URLSearchParams();
  for (const key of SAVED_FILTER_KEYS) {
    const value = params.get(key);
    if (value) picked.set(key, value);
  }
  return picked.toString();
}

/** The remembered filters as a query string, or null when nothing (usable) is saved. */
export function loadSavedFilterQuery(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_QUERY_LENGTH) return null;
    // Whatever is in storage is re-filtered to the known keys: it ends up in a
    // URL and an API request, so it is never trusted as-is.
    return pickFilterQuery(new URLSearchParams(raw)) || null;
  } catch {
    return null;
  }
}

/** Remembers these filters ('' / nothing to remember clears them). */
export function saveFilterQuery(query: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (query && query.length <= MAX_QUERY_LENGTH) storage.setItem(STORAGE_KEY, query);
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // quota exceeded / blocked -- the filters just won't be remembered
    return;
  }
  announceChange();
}

// --- keeping the site's "search" links in step ---------------------------------
//
// A plain "/search" link can't tell "go to search" from "reset my filters" -- the
// page would have to guess, and used to reset them (clicking the navbar's search
// link while already on the search page wiped the filters). So every such link
// points at "/search?<saved filters>" instead (useSearchHref), and is told here
// when they change.

const CHANGE_EVENT = 'b2g:search-filters-changed';

function announceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls `onChange` whenever the saved filters change -- in this tab or (storage event) another. */
export function subscribeSavedFilters(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Where a "search" link should go: the search page with the remembered filters, or bare when none. */
export function savedSearchHref(): string {
  const saved = loadSavedFilterQuery();
  return saved ? `/search?${saved}` : '/search';
}

export function clearSavedFilterQuery(storage: StorageLike | null = defaultStorage()): void {
  saveFilterQuery('', storage);
}
