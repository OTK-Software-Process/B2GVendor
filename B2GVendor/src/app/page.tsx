import { HomeClient } from './HomeClient';
import { serverFetchWorks } from '@/lib/serverApi';

// Server Component page (no 'use client') so this route segment config is
// actually honored — see agencies/page.tsx for the full explanation of why
// (SearchBar uses useSearchParams() as a client component; Suspense-wrapping
// it hangs `next dev` in this Next.js/Turbopack combo, confirmed live, so
// this route forces full dynamic rendering instead of using Suspense).
export const dynamic = 'force-dynamic';

// The latest works are fetched HERE, on the server, so they are in the HTML:
// on a phone over 4G the page no longer waits for the JavaScript and then an API
// round trip before showing them (lib/serverApi.ts). null = the API didn't answer
// in time, and HomeClient loads them in the browser as before.
export default async function HomePage() {
  const recent = await serverFetchWorks({ sort: 'date', page: 1, pageSize: 4 });
  return <HomeClient initialWorks={recent?.items ?? null} />;
}
