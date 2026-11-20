import { env } from '../config/env';
import { logger } from './logger';

// Every HTTP call the backend makes to the outside world goes through here
// (docs/Security.md section 1). One allow-list, one place to read it:
//
//   ASVS V13.2.4  the external hosts the application may call, by purpose
//   ASVS V1.3.6   a URL that came from untrusted data (a feed link) can only
//                 reach the hosts its purpose allows -- no SSRF into the
//                 internal network, the cloud metadata address or anywhere else
//   ASVS V15.3.2  redirects are never followed blindly: each hop is checked
//                 against the same list BEFORE it is requested, and a limited
//                 number of hops is allowed
//
// The network layer repeats the list (the egress proxy, docker/egress-proxy/
// squid.conf), so a call that somehow bypassed this module still could not
// leave the allowed hosts.

export type OutboundPurpose = 'egp' | 'datagoth' | 'hibp' | 'ai';

export const HIBP_HOST = 'api.pwnedpasswords.com';
const EGP_DOMAIN = 'gprocurement.go.th';
const DEFAULT_MAX_REDIRECTS = 5;

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The hosts each purpose may reach. Built from configuration, so a test or a local mock server works too. */
export function allowedHostsFor(purpose: OutboundPurpose): { exact: string[]; domains: string[] } {
  switch (purpose) {
    case 'egp':
      // e-GP's own hosts (feed, announcement pages, TOR files on process*.gprocurement.go.th)
      // and the host the feed is configured on.
      return { exact: [hostOf(env.EGP_RSS_BASE_URL)].filter((h): h is string => !!h), domains: [EGP_DOMAIN] };
    case 'datagoth':
      return { exact: [hostOf(env.DATA_GO_TH_BASE_URL)].filter((h): h is string => !!h), domains: [] };
    case 'hibp':
      return { exact: [HIBP_HOST], domains: [] };
    case 'ai':
      return { exact: [hostOf(env.OPENROUTER_BASE_URL)].filter((h): h is string => !!h), domains: [] };
  }
}

/** Whether `rawUrl` is an http(s) URL on a host `purpose` may reach. */
export function isAllowedOutbound(purpose: OutboundPurpose, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false; // no credentials smuggled in the URL
  const host = url.hostname.toLowerCase();
  const { exact, domains } = allowedHostsFor(purpose);
  return exact.includes(host) || domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

export class OutboundBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundBlockedError';
  }
}

function refuse(purpose: OutboundPurpose, url: string, reason: string): never {
  // A blocked call is either a misconfiguration or a feed trying to point us
  // somewhere else (SSRF): both worth an alert.
  logger.security('warn', 'outbound.blocked', { purpose, host: hostOf(url) ?? '(invalid)', reason });
  throw new OutboundBlockedError(`Refusing to call an unexpected address (${hostOf(url) ?? 'invalid URL'}) for ${purpose}: ${reason}`);
}

export interface OutboundInit extends RequestInit {
  /** Hops allowed before giving up (default 5). 0 = refuse any redirect. */
  maxRedirects?: number;
}

/**
 * fetch() restricted to the hosts of `purpose`, following redirects by hand.
 * Only GET/HEAD requests follow redirects; any other method treats a redirect
 * as an error (a POST must never be replayed at an address we did not choose).
 */
export async function outboundFetch(purpose: OutboundPurpose, url: string | URL, init: OutboundInit = {}): Promise<Response> {
  const { maxRedirects = DEFAULT_MAX_REDIRECTS, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  let current = url.toString();
  if (!isAllowedOutbound(purpose, current)) refuse(purpose, current, 'host not on the allow-list');

  for (let hop = 0; ; hop++) {
    // Looked up on every call (not captured at import) so tests can stand in for fetch.
    const response = await fetch(current, { ...requestInit, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;

    await response.body?.cancel().catch(() => undefined);
    const next = new URL(location, current).toString();
    if (method !== 'GET' && method !== 'HEAD') refuse(purpose, next, `unexpected redirect of a ${method} request`);
    if (hop >= maxRedirects) refuse(purpose, next, `more than ${maxRedirects} redirects`);
    if (!isAllowedOutbound(purpose, next)) refuse(purpose, next, 'redirect to a host not on the allow-list');
    current = next;
  }
}
