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
 * asks the configured AI_PROVIDER for two things in one call:
 *   1. tagIds -- classification against a FIXED candidate tag list (never
 *      free-form generation, so it can't introduce an orphan/duplicate tag,
 *      NFR-N3.3).
 *   2. description -- a short plain-language summary of the document's
 *      actual content.
 *
 * The provider (Vertex AI vs OpenRouter) is a pure strategy swap driven by
 * env.AI_PROVIDER -- prompt-building and response-parsing are identical
 * either way, so the two backends can never drift into different output
 * shapes. When no document text is available (html-linked item, extraction
 * failed, or AI disabled/unconfigured), this degrades to title-only
 * classification with no description -- never throws, never blocks
 * ingestion.
 */

const EMPTY_RESULT: DocumentAnalysisResult = { description: null, tagIds: [], budget: null };

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

function parseResult(text: string, validIds: Set<string>): DocumentAnalysisResult {
  try {
    const match = stripReasoning(text).match(/\{[\s\S]*\}/);
    if (!match) return EMPTY_RESULT;

    const parsed = JSON.parse(match[0]);
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

    return { description, tagIds, budget };
  } catch {
    return EMPTY_RESULT;
  }
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

    const validIds = new Set(candidates.map(c => c.id));
    return parseResult(text, validIds);
  } catch (err) {
    logger.warn(
      'aiTagging',
      `analyzeTorDocument (${provider.name}) failed for title "${input.title.slice(0, 60)}..." -- continuing without AI results`,
      err
    );
    return EMPTY_RESULT;
  }
}
