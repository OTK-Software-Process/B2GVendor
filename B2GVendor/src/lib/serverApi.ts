import { headers } from 'next/headers';
import { buildQuery, type BackendGovSite, type BackendWork, type ListWorksParams, type ListWorksResponse } from './backend';

// Data for the PUBLIC pages, fetched on the server while the page renders, so
// the HTML already contains the works / sites instead of a skeleton that waits
// for ~190 KB of JavaScript and then an API round trip (measured on a mid-range
// phone over 4G: that chain put every page at 3.3-3.6 s).
//
// Only ever public, anonymous data: no cookies are forwarded. Anything that
// fails or is slow returns null and the page simply falls back to loading the
// data in the browser, as before -- a slow API must never hold the HTML back
// for long.

// The server talks to the API on the internal address when there is one: in
// docker compose the browser's NEXT_PUBLIC_API_URL (localhost:4000) is not
// reachable from inside the frontend container -- see API_INTERNAL_URL there.
const SERVER_API_BASE = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const SERVER_FETCH_TIMEOUT_MS = 1500;

// The API rate-limits search per client address. Every server-side render comes
// from THIS server's address, so without this all visitors would share one
// budget; the visitor's address is passed on the way a reverse proxy would
// (the API only trusts it in production, behind its one trusted proxy hop).
async function visitorAddressHeader(): Promise<Record<string, string>> {
  try {
    const forwarded = (await headers()).get('x-forwarded-for');
    return forwarded ? { 'X-Forwarded-For': forwarded.slice(0, 256) } : {};
  } catch {
    return {}; // not inside a request (build time)
  }
}

async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE}${path}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(await visitorAddressHeader()) },
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: T };
    return body?.success ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

export function serverFetchWorks(params: ListWorksParams): Promise<ListWorksResponse | null> {
  return serverGet<ListWorksResponse>(`/works${buildQuery(params)}`);
}

export function serverFetchWork(id: string): Promise<BackendWork | null> {
  // A work id is a Mongo ObjectId; anything else can't exist (and must not be
  // spliced into the path).
  if (!/^[a-f0-9]{24}$/i.test(id)) return Promise.resolve(null);
  return serverGet<BackendWork>(`/works/${id}`);
}

export function serverFetchGovSites(): Promise<BackendGovSite[] | null> {
  return serverGet<BackendGovSite[]>('/gov-sites');
}
