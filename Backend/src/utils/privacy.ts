/**
 * Personal data that has to appear in a log line is masked first (docs/Security.md
 * section 7 -- personal data is "Confidential": it may be logged only masked).
 *
 *   maskEmail('somchai.j@example.com') -> 's********@example.com'
 *
 * Enough to tell two addresses apart while debugging a delivery, not enough to
 * read the address back from the log.
 */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return '(none)';
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}${email.slice(at)}`;
}

/**
 * The link for an emailed one-time token. The token goes AFTER the `#`: a URL
 * fragment is never sent to any server, so it cannot end up in an access log,
 * a proxy log or a Referer header (ASVS V14.2.1). The page reads it in the
 * browser and posts it in a request body.
 */
export function tokenLink(baseUrl: string, page: string, rawToken: string): string {
  return `${baseUrl}/${page}#token=${encodeURIComponent(rawToken)}`;
}
