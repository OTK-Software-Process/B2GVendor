import { HomeClient } from './HomeClient';

// Server Component page (no 'use client') so this route segment config is
// actually honored — see agencies/page.tsx for the full explanation of why
// (SearchBar uses useSearchParams() as a client component; Suspense-wrapping
// it hangs `next dev` in this Next.js/Turbopack combo, confirmed live, so
// this route forces full dynamic rendering instead of using Suspense).
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <HomeClient />;
}
