import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { vertexProvider } from './vertexProvider';
import { openRouterProvider } from './openRouterProvider';
import { AiProvider, DocumentAnalysisInput, DocumentAnalysisResult, TagCandidate } from './types';

export { TagCandidate, DocumentAnalysisInput, DocumentAnalysisResult } from './types';

/**
 * AI-assisted document analysis (SRS Section 4.3, FR-3.2; NFR-N3.7 /
 * NFR-3.7: this is a best-effort step, never a blocking dependency).
 *
 * Given a work's title and, when available, its TOR document already
 * converted to plain text (see pdfText.service.ts -- never a raw PDF/HTML
 * file, to keep token usage down and keep this module provider-agnostic),
 * asks the configured AI_PROVIDER for:
 *   1. tagIds -- classification against a candidate tag list.
 *   2. description -- a short plain-language summary of the document's
 *      actual content.
 *   3. budget -- a pre-award estimate read from the document text, if any.
 *   4. newTag -- optionally, ONE brand-new tag proposal when NONE of the
 *      candidates genuinely fit (relaxes the old "never invent a tag"
 *      NFR-N3.3 rule on purpose, by explicit request, so the vocabulary can
 *      grow to cover topics an admin never anticipated). This module only
 *      returns the proposal -- ingestion.service.ts is what actually
 *      persists it via tag.service.ts's findOrCreateAiTag() and folds it
 *      into the candidate list for later documents in the same poll run.
 *
 * The provider (Vertex AI vs OpenRouter) is a pure strategy swap driven by
 * env.AI_PROVIDER -- prompt-building and response-parsing are identical
 * either way, so the two backends can never drift into different output
 * shapes. When no document text is available (html-linked item, extraction
 * failed, or AI disabled/unconfigured), this degrades to title-only
 * classification with no description -- never throws, never blocks
 * ingestion.
 */

const EMPTY_RESULT: DocumentAnalysisResult = { description: null, tagIds: [], budget: null, newTag: null };

const providers: Record<string, AiProvider> = {
  vertexai: vertexProvider,
  openrouter: openRouterProvider
};

function getProvider(): AiProvider | null {
  if (!env.AI_TAGGING_ENABLED) return null;
  return providers[env.AI_PROVIDER] ?? null;
}

// Some reasoning-capable models (e.g. Qwen3.5) bake a <think>...</think>
// chain-of-thought block directly into `content` regardless of the
// provider-level "exclude reasoning" request flag (openRouterProvider sets
// it, but this model ignores it). That block often contains its own stray
// '{'/'}' characters, which broke the brace-matching JSON extraction below
// (it grabbed from a brace INSIDE the reasoning through to the real
// answer's closing brace, producing garbage that always failed to parse --
// silently, since this function's caller treats any failure as "no AI
// result" rather than an error). Strip it before extracting JSON.
function stripReasoning(text: string): string {
  const closeTag = text.lastIndexOf('</think>');
  return closeTag === -1 ? text : text.slice(closeTag + '</think>'.length);
}

function parseResult(text: string, candidates: TagCandidate[]): DocumentAnalysisResult {
  try {
    const match = stripReasoning(text).match(/\{[\s\S]*\}/);
    if (!match) return EMPTY_RESULT;

    const parsed = JSON.parse(match[0]);
    const validIds = new Set(candidates.map(c => c.id));
    const tagIds = Array.isArray(parsed.tagIds)
      ? parsed.tagIds.filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id))
      : [];
    const description =
      typeof parsed.description === 'string' && parsed.description.trim().length > 0
        ? parsed.description.trim().slice(0, 2000)
        : null;
    // Coerce defensively -- models are inconsistent about emitting a numeric
    // literal vs. a numeric string (e.g. "1250000" vs 1250000). Reject
    // anything non-finite or <= 0 rather than trusting it as a real price.
    const budgetNumber = Number(parsed.budget);
    const budget = typeof parsed.budget !== 'object' && Number.isFinite(budgetNumber) && budgetNumber > 0 ? budgetNumber : null;
    const newTag = parseNewTag(parsed.newTag, candidates);

    return { description, tagIds, budget, newTag };
  } catch {
    return EMPTY_RESULT;
  }
}

// Defensive validation on top of the prompt's own instructions -- a model
// can still ignore "don't duplicate a candidate" or "name/facet only", so
// re-check here rather than trusting the response shape blindly. Anything
// that fails these checks is dropped (returns null) rather than surfaced as
// an error -- proposing a new tag is always optional, never required.
function parseNewTag(raw: unknown, candidates: TagCandidate[]): DocumentAnalysisResult['newTag'] {
  if (!raw || typeof raw !== 'object') return null;
  const name = (raw as { name?: unknown }).name;
  const facet = (raw as { facet?: unknown }).facet;
  if (typeof name !== 'string' || (facet !== 'category' && facet !== 'keyword')) return null;

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return null;
  // Reject an exact (case-insensitive) rewording of an existing candidate --
  // the point is to cover a genuinely new topic, not relabel one we already
  // have. This can't catch every synonym, but it catches the model simply
  // echoing a candidate's name back under "newTag" instead of "tagIds".
  if (candidates.some(c => c.name.trim().toLowerCase() === trimmed.toLowerCase())) return null;

  return { name: trimmed, facet };
}

/**
 * Never throws -- any failure (disabled, misconfigured provider, API error,
 * timeout, unparseable response) resolves to { description: null, tagIds: [] }
 * so ingestion always proceeds with at least the structured (site) tags.
 */
export async function analyzeTorDocument(
  input: DocumentAnalysisInput,
  candidates: TagCandidate[]
): Promise<DocumentAnalysisResult> {
  const provider = getProvider();
  if (!provider) return EMPTY_RESULT;

  try {
    const userPrompt = buildUserPrompt(input, candidates);
    const text = await provider.generate(SYSTEM_PROMPT, userPrompt);
    if (!text) return EMPTY_RESULT;

    return parseResult(text, candidates);
  } catch (err) {
    logger.warn(
      'aiTagging',
      `analyzeTorDocument (${provider.name}) failed for title "${input.title.slice(0, 60)}..." -- continuing without AI results`,
      err
    );
    return EMPTY_RESULT;
  }
}
