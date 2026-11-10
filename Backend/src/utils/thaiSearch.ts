const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const SEARCH_WILDCARD_CHARACTER = '[^\\n]';

export function normalizeThaiSearchText(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[๐-๙]/g, digit => String(THAI_DIGITS.indexOf(digit)))
    .replace(/เเ/g, 'แ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// MongoDB refuses a regular expression longer than 32,764 bytes, and the
// one-slip variants below grow with the SQUARE of the query's length (about 3n^2
// characters, 3 bytes each in Thai): a pasted 60-letter Thai title was enough to
// make the whole search fail with a server error. Past this size the typo
// tolerance is dropped and only the exact text is matched.
const MAX_TYPO_PATTERN_BYTES = 16_000;

/** The words of a search box, split on whitespace (Thai itself has no spaces). */
export function splitSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.split(/\s+/)) {
    const key = normalizeThaiSearchText(term);
    if (key && !seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

// Matching remains substring-based. For queries of at least four letters,
// generate patterns allowing one inserted, missing, or mistyped character.
export function buildThaiSearchRegex(query: string): RegExp {
  const characters = Array.from(normalizeThaiSearchText(query.trim()));
  if (characters.length === 0) return /$a/u;

  const escaped = characters.map(escapeRegExp);
  const patterns = [escaped.join('')];
  const searchableCharacters = characters.filter(character => !/\p{M}/u.test(character)).length;

  if (searchableCharacters >= 4 && characters.length <= 64) {
    for (let index = 0; index < escaped.length; index += 1) {
      patterns.push(escaped.filter((_, current) => current !== index).join(''));
      patterns.push(
        `${escaped.slice(0, index).join('')}${SEARCH_WILDCARD_CHARACTER}${escaped.slice(index + 1).join('')}`
      );
      patterns.push(
        `${escaped.slice(0, index).join('')}(?:${SEARCH_WILDCARD_CHARACTER})?${escaped.slice(index).join('')}`
      );
    }

    patterns.push(`(?:${SEARCH_WILDCARD_CHARACTER})?${escaped.join('')}`);
    patterns.push(`${escaped.join('')}(?:${SEARCH_WILDCARD_CHARACTER})?`);
  }

  const source = Array.from(new Set(patterns)).join('|');
  if (Buffer.byteLength(source) > MAX_TYPO_PATTERN_BYTES) return new RegExp(escaped.join(''), 'u');
  return new RegExp(`(?:${source})`, 'u');
}
