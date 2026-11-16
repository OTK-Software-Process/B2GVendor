import { PublicShell } from '@/components/PublicShell';
import { AgencyDirectoryClient } from './AgencyDirectoryClient';
import { serverFetchGovSites } from '@/lib/serverApi';

// Server Component page (no 'use client') so this route segment config is
// actually honored: forces full dynamic rendering, skipping static
// prerendering entirely. AgencyDirectoryClient uses useSearchParams() as a
// client component below — wrapping it in <Suspense> instead (the usual fix
// for the "should be wrapped in a suspense boundary" prerender error) hangs
// forever in `next dev` with this Next.js/Turbopack combo (reproduced and
// confirmed live), so this route avoids Suspense entirely instead.
export const dynamic = 'force-dynamic';

// The site directory is fetched here so the site cards are in the HTML
// (lib/serverApi.ts); null = the API didn't answer in time, and the cards come
// from the app-wide list once the browser has loaded it, as before.
export default async function AgencyDirectoryPage() {
  const sites = await serverFetchGovSites();
  return (
    <PublicShell>
      <AgencyDirectoryClient initialSites={sites} />
    </PublicShell>
  );
}
