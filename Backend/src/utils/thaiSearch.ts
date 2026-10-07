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

  return new RegExp(`(?:${Array.from(new Set(patterns)).join('|')})`, 'u');
}
