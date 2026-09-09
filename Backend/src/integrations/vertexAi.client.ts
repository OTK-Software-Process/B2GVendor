import { VertexAI } from '@google-cloud/vertexai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * AI-assisted document analysis (SRS Section 4.3, FR-3.2; NFR-N3.7 /
 * NFR-3.7: this is a best-effort step, never a blocking dependency).
 *
 * Given a work's title and, when available, the actual extracted TOR PDF
 * text, asks Vertex AI for two things in one call:
 *   1. tagIds -- classification against a FIXED candidate tag list (never
 *      free-form generation, so it can't introduce an orphan/duplicate tag,
 *      NFR-N3.3), based on the real document content when we have it.
 *   2. description -- a short plain-language summary of what the work
 *      actually is, generated from the PDF text. Title alone is often a
 *      generic legal phrase ("จ้างเหมาบริการ..."); the PDF body is what
 *      actually describes the scope.
 *
 * When no PDF text is available (html-linked item, extraction failed, or
 * AI disabled/unconfigured), this degrades to title-only classification
 * with no description -- never throws, never blocks ingestion.
 */

export interface TagCandidate {
  id: string;
  name: string;
  facet: 'category' | 'keyword';
}

export interface DocumentAnalysisInput {
  title: string;
  pdfText?: string | null;
}

export interface DocumentAnalysisResult {
  description: string | null;
  tagIds: string[];
}

const EMPTY_RESULT: DocumentAnalysisResult = { description: null, tagIds: [] };

let client: VertexAI | null = null;

function getClient(): VertexAI | null {
  if (!env.AI_TAGGING_ENABLED) return null;
  if (!env.GOOGLE_CLOUD_PROJECT) {
    logger.warn('vertexAi', 'AI_TAGGING_ENABLED is true but GOOGLE_CLOUD_PROJECT is not set -- skipping AI analysis');
    return null;
  }
  if (!client) {
    client = new VertexAI({ project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION });
  }
  return client;
}

function buildPrompt(input: DocumentAnalysisInput, candidates: TagCandidate[]): string {
  const options = candidates.map(c => `- ${c.id}: ${c.name} (${c.facet})`).join('\n');
  const hasPdfText = !!input.pdfText;

  return [
    'You are analyzing a Thai government procurement announcement.',
    '',
    `Title: ${input.title}`,
    '',
    hasPdfText
      ? `Excerpt from the official TOR/announcement document:\n${input.pdfText}`
      : '(No document text is available -- only the title above. Do not invent details that are not in the title.)',
    '',
    'Task 1 -- Tags: choose which of the candidate tags below genuinely apply.',
    'Only choose from this fixed list -- never invent a new tag name. Return at most 5.',
    'Candidate tags:',
    options,
    '',
    hasPdfText
      ? 'Task 2 -- Description: write a short (1-2 sentence) plain-Thai summary of what this ' +
        'procurement is actually for, based on the document excerpt above. Do not repeat the title verbatim.'
      : 'Task 2 -- Description: return null (no document text was available to summarize).',
    '',
    'Respond with ONLY a JSON object of this exact shape, nothing else:',
    '{"description": "..." or null, "tagIds": ["id1","id2"]}'
  ].join('\n');
}

function parseResult(text: string, validIds: Set<string>): DocumentAnalysisResult {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY_RESULT;

    const parsed = JSON.parse(match[0]);
    const tagIds = Array.isArray(parsed.tagIds)
      ? parsed.tagIds.filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id))
      : [];
    const description =
      typeof parsed.description === 'string' && parsed.description.trim().length > 0
        ? parsed.description.trim().slice(0, 2000)
        : null;

    return { description, tagIds };
  } catch {
    return EMPTY_RESULT;
  }
}

/**
 * Never throws -- any failure (disabled, missing credentials, API error,
 * timeout, unparseable response) resolves to { description: null, tagIds: [] }
 * so ingestion always proceeds with at least the structured (site) tags.
 */
export async function analyzeTorDocument(
  input: DocumentAnalysisInput,
  candidates: TagCandidate[]
): Promise<DocumentAnalysisResult> {
  const vertexAi = getClient();
  if (!vertexAi) return EMPTY_RESULT;

  try {
    const model = vertexAi.getGenerativeModel({
      model: env.VERTEX_AI_MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 512 }
    });

    const result = await model.generateContent(buildPrompt(input, candidates));
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const validIds = new Set(candidates.map(c => c.id));
    return parseResult(text, validIds);
  } catch (err) {
    logger.warn('vertexAi', `analyzeTorDocument failed for title "${input.title.slice(0, 60)}..." -- continuing without AI results`, err);
    return EMPTY_RESULT;
  }
}
