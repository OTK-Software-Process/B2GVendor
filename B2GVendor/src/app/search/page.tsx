import { PublicShell } from '@/components/PublicShell';
import { SearchClient } from './SearchClient';

// Server Component page (no 'use client') — see agencies/page.tsx for why:
// forces full dynamic rendering so useSearchParams() in SearchClient below
// doesn't need a <Suspense> boundary, which hangs `next dev` in this
// Next.js/Turbopack combo (confirmed live).
export const dynamic = 'force-dynamic';

export default function SearchPage() {
  return (
    <PublicShell>
      <SearchClient />
    </PublicShell>
  );
}
