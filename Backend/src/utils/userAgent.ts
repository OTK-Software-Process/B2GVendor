export interface ParsedUserAgent {
  browser: string;
  os: string;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg[ae]?\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/Firefox\//i, 'Firefox'],
  [/Chrome\/|CriOS/i, 'Chrome'],
  [/Safari\//i, 'Safari']
];

const OPERATING_SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT/i, 'Windows'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Android/i, 'Android'],
  [/Linux/i, 'Linux']
];

function matchFirst(pairs: Array<[RegExp, string]>, value: string): string {
  for (const [pattern, label] of pairs) {
    if (pattern.test(value)) return label;
  }
  return 'Unknown';
}

export function parseUserAgent(userAgent?: string): ParsedUserAgent {
  if (!userAgent) {
    return { browser: 'Unknown', os: 'Unknown' };
  }
  return {
    browser: matchFirst(BROWSERS, userAgent),
    os: matchFirst(OPERATING_SYSTEMS, userAgent)
  };
}

export function maskIpAddress(ip?: string): string | undefined {
  if (!ip) return undefined;

  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length !== 4) return 'unknown';
    return `${parts[0]}.${parts[1]}.xx.xx`;
  }

  const groups = normalized.split(':').filter(Boolean);
  if (groups.length < 2) return 'unknown';
  return `${groups[0]}:${groups[1]}:xxxx:xxxx`;
}
