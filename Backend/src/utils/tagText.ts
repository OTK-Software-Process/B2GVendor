// Text comparison for tag names and aliases (synonyms). Two spellings a human
// would call "the same tag" must compare equal even when they differ in case,
// spacing, punctuation or full/half-width forms -- e.g. "e-bidding",
// "E Bidding" and "ebidding". Thai combining marks (vowels/tone marks) are
// kept: dropping them would make different Thai words collide.

const NEAR_DUPLICATE_THRESHOLD = 0.85;
const MIN_KEY_LENGTH_FOR_SIMILARITY = 4;
const MIN_CONTAINMENT_RATIO = 0.8;

/** Canonical comparison key: NFKC, lowercased, only letters/digits/combining marks kept. */
export function tagKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export type TermMatchKind = 'exact' | 'similar';

export interface TermMatch {
  kind: TermMatchKind;
  /** 1 for an exact match, otherwise 0..1. */
  similarity: number;
}

/**
 * Compares two already-computed tag keys. "exact" = same key. "similar" = long
 * enough to judge and either one contains the other with almost the same
 * length, or the edit distance is small. Very short keys (< 4 characters) are
 * never called similar -- they would flag unrelated tags constantly.
 */
export function compareTagKeys(a: string, b: string): TermMatch | null {
  if (!a || !b) return null;
  if (a === b) return { kind: 'exact', similarity: 1 };

  const chars = (s: string) => Array.from(s);
  const ca = chars(a);
  const cb = chars(b);
  const shorter = Math.min(ca.length, cb.length);
  const longer = Math.max(ca.length, cb.length);
  if (shorter < MIN_KEY_LENGTH_FOR_SIMILARITY) return null;

  const contained = (ca.length <= cb.length ? b.includes(a) : a.includes(b)) && shorter / longer >= MIN_CONTAINMENT_RATIO;
  const similarity = 1 - levenshtein(ca, cb) / longer;

  if (contained) return { kind: 'similar', similarity: Math.max(similarity, shorter / longer) };
  if (similarity >= NEAR_DUPLICATE_THRESHOLD) return { kind: 'similar', similarity };
  return null;
}

/**
 * Trims aliases, drops blanks, drops any alias that is just another spelling
 * of the tag's own name, and de-duplicates the rest (first spelling wins).
 */
export function cleanAliases(name: string, aliases: readonly string[] = []): string[] {
  const seen = new Set<string>([tagKey(name)]);
  const result: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = tagKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}
