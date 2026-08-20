import { PublicShell } from '@/components/PublicShell';
import { AgencyDirectoryClient } from './AgencyDirectoryClient';

// Server Component page (no 'use client') so this route segment config is
// actually honored: forces full dynamic rendering, skipping static
// prerendering entirely. AgencyDirectoryClient uses useSearchParams() as a
// client component below — wrapping it in <Suspense> instead (the usual fix
// for the "should be wrapped in a suspense boundary" prerender error) hangs
// forever in `next dev` with this Next.js/Turbopack combo (reproduced and
// confirmed live), so this route avoids Suspense entirely instead.
export const dynamic = 'force-dynamic';

export default function AgencyDirectoryPage() {
  return (
    <PublicShell>
      <AgencyDirectoryClient />
    </PublicShell>
  );
}
