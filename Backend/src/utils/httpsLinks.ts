import { isProduction } from '../config/env';

// "Links are HTTPS in production." The e-GP feed hands out plain-http links for
// its HTML announcement pages (http://process.gprocurement.go.th/..., ~700 of
// them in the dev database on 2026-11-16) while its PDF/zip links are already
// https. e-GP serves the same paths over HTTPS with a valid certificate (checked
// 2026-11-16) and itself redirects http -> https, so in production every such
// link is shown -- and fetched -- as https: no plain-http hop for a user or for
// the ingestion worker. Only e-GP's own hosts are rewritten: for any other host
// we can't know that https works.

export function isEgpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'gprocurement.go.th' || host.endsWith('.gprocurement.go.th');
}

export function toHttpsLink(raw: string, production: boolean = isProduction): string {
  if (!production || !/^http:\/\//i.test(raw)) return raw;
  try {
    if (!isEgpHost(new URL(raw).hostname)) return raw;
  } catch {
    return raw;
  }
  return raw.replace(/^http:/i, 'https:');
}
