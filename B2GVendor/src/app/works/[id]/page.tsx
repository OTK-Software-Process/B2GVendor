import { WorkDetailClient } from './WorkDetailClient';
import { serverFetchWork } from '@/lib/serverApi';

export const dynamic = 'force-dynamic';

// The work is fetched on the server, so its title, status, price and TOR
// documents are in the HTML (faster on a phone, and readable by search engines)
// -- lib/serverApi.ts. null = not found, or the API didn't answer in time: the
// client then tries itself and shows "no longer available" if it really is gone.
export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await serverFetchWork(id);
  return <WorkDetailClient id={id} initialWork={work} />;
}
