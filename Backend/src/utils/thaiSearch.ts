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
// one-slip variants below grow with the SQUARE of the query's length (~3 bytes
// per Thai letter): a pasted 60-letter Thai title was enough to make the whole
// search fail with a server error. The prefix tree below roughly halves the
// size, but it is still quadratic, so past this size the typo tolerance is
// dropped and only the exact text is matched.
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

// Matching remains substring-based. For queries of at least four letters, it
// also matches with one inserted, missing, or mistyped character.
//
// The variants are built so MongoDB's regex engine can reject a position fast
// (measured on 20,000 seeded works: a Thai query went from ~1.6 s to ~0.17 s per
// scan, a Latin one from ~0.85 s to ~0.03 s, with exactly the same matches):
//   - only variants that add something are kept. In a substring search a
//     wildcard at either end, a substitution of the first or last letter (already
//     covered by deleting it) and an *optional* insertion (the exact word is
//     already a variant) can never match anything more;
//   - the variants are merged into a prefix tree, ค(?:อ(?:ม...|...)|...)|อม...,
//     so a position is ruled out after a letter or two instead of being tried
//     against every variant in turn. (Every Thai letter starts with the same
//     UTF-8 byte, so the engine's first-byte skip can't help Thai text.)
interface TrieNode {
  end: boolean;
  next: Map<string, TrieNode>;
}

function prefixTreeRegexSource(sequences: string[][]): string {
  const root: TrieNode = { end: false, next: new Map() };
  for (const sequence of sequences) {
    let node = root;
    for (const token of sequence) {
      if (node.end) break; // a shorter variant already matches everything this one would
      let child = node.next.get(token);
      if (!child) {
        child = { end: false, next: new Map() };
        node.next.set(token, child);
      }
      node = child;
    }
    node.end = true;
    node.next.clear();
  }
  const emit = (node: TrieNode): string => {
    if (node.end) return '';
    const branches = [...node.next].map(([token, child]) => token + emit(child));
    return branches.length === 1 ? branches[0] : `(?:${branches.join('|')})`;
  };
  return emit(root);
}

export function buildThaiSearchRegex(query: string): RegExp {
  const characters = Array.from(normalizeThaiSearchText(query.trim()));
  if (characters.length === 0) return /$a/u;

  const escaped = characters.map(escapeRegExp);
  const variants: string[][] = [escaped];
  const searchableCharacters = characters.filter(character => !/\p{M}/u.test(character)).length;

  if (searchableCharacters >= 4 && characters.length <= 64) {
    const last = escaped.length - 1;
    for (let index = 0; index < escaped.length; index += 1) {
      // one character missing
      variants.push(escaped.filter((_, current) => current !== index));
      // one character mistyped (not the first/last: deleting it already covers that)
      if (index > 0 && index < last) {
        variants.push([...escaped.slice(0, index), SEARCH_WILDCARD_CHARACTER, ...escaped.slice(index + 1)]);
      }
      // one extra character inside the word
      if (index > 0) {
        variants.push([...escaped.slice(0, index), SEARCH_WILDCARD_CHARACTER, ...escaped.slice(index)]);
      }
    }
  }

  const source = prefixTreeRegexSource(variants);
  if (Buffer.byteLength(source) > MAX_TYPO_PATTERN_BYTES) return new RegExp(escaped.join(''), 'u');
  return new RegExp(source, 'u');
}
