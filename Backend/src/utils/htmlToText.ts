/**
 * HTML -> plain text, just good enough to read an announcement page for its
 * wording and figures (see services/htmlText.service.ts). Deliberately small
 * and dependency-free: no DOM, no layout -- scripts/styles/comments are dropped,
 * block boundaries become line breaks, table cells stay on one line, every other
 * tag is removed with its text kept, and entities are decoded.
 *
 * Pure -- no I/O -- so it is unit-testable.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  copy: '©'
};

function isValidCodePoint(code: number): boolean {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
}

// &#3627; / &#xE2B; / &nbsp; -- some servers send Thai as numeric entities.
// An entity we can't make sense of is left exactly as written.
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : ' ';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Content that is never visible text. (e-GP puts a <script> before <html>.)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // A finished table cell is followed by a space, so "ราคา</td><td>1,000" reads "ราคา 1,000".
    .replace(/<\/(?:td|th)\s*>/gi, ' ')
    // The end of a block (or a <br>/<hr>) is a line break.
    .replace(/<\/(?:p|div|tr|li|ul|ol|table|h[1-6]|title|section|article|header|footer|pre|blockquote|form|fieldset)\s*>|<(?:br|hr)\b[^>]*>/gi, '\n')
    // Any other tag disappears, its text stays. Only `<` followed by a letter,
    // `/` or `!` starts a tag, so a stray "<" in prose is left alone.
    .replace(/<\/?[a-zA-Z][^>]*>|<![^>]*>/g, '');

  return decodeEntities(stripped)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
