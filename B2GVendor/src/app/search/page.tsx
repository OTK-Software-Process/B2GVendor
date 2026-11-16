import { PublicShell } from '@/components/PublicShell';
import { SearchClient } from './SearchClient';
import { serverFetchWorks } from '@/lib/serverApi';
import { searchKey, searchListParams } from '@/lib/searchQuery';

// Server Component page (no 'use client') — see agencies/page.tsx for why:
// forces full dynamic rendering so useSearchParams() in SearchClient below
// doesn't need a <Suspense> boundary, which hangs `next dev` in this
// Next.js/Turbopack combo (confirmed live).
export const dynamic = 'force-dynamic';

// The first page of results for THIS URL is fetched on the server, with the very
// same URL -> query mapping the client uses (lib/searchQuery.ts), so the results
// are in the HTML. SearchClient takes it over and fetches again only when the URL
// asks for something else. null = the API didn't answer in time: the client loads
// the results itself, as before.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = searchListParams(key => {
    const value = raw[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  });
  const result = await serverFetchWorks(params);

  return (
    <PublicShell>
      <SearchClient initial={result ? { key: searchKey(params), result } : null} />
    </PublicShell>
  );
}
