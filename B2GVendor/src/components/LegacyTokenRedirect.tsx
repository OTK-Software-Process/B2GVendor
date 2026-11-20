'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { fragmentTokenUrl } from '@/lib/fragmentToken';

/**
 * Emails sent before the token moved into the URL fragment link to
 * /<page>/<token>. Those links keep working: the token is moved behind the `#`
 * at once (replacing the history entry, so the old URL is not kept either) and
 * the real page takes over. New emails never use this form (ASVS V14.2.1).
 */
export function LegacyTokenRedirect({ page }: { page: 'reset-password' | 'verify-email' | 'unsubscribe' }) {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    window.location.replace(fragmentTokenUrl(page, decodeURIComponent(token ?? '')));
  }, [page, token]);

  return null;
}
