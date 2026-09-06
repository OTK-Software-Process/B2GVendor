import { VertexAI } from '@google-cloud/vertexai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * AI-assisted auto-tagging client (SRS Section 4.3, FR-3.2; NFR-N3.7 /
 * NFR-3.7: this is a best-effort classification step, never a blocking
 * dependency). Given a work's Thai title and a controlled vocabulary of
 * candidate tags, asks Vertex AI to pick which ones apply -- classification
 * against an existing taxonomy, not free-form tag generation, so it can
 * never introduce an orphan/duplicate tag (NFR-N3.3).
 *
 * Soft-disabled by default (AI_TAGGING_ENABLED=false) since it requires a
 * real GCP project with billing and a service account -- ingestion must
 * keep working with this off.
 */

export interface TagCandidate {
  id: string;
  name: string;
  facet: 'category' | 'keyword';
}

let client: VertexAI | null = null;

function getClient(): VertexAI | null {
  if (!env.AI_TAGGING_ENABLED) return null;
  if (!env.GOOGLE_CLOUD_PROJECT) {
    logger.warn('vertexAi', 'AI_TAGGING_ENABLED is true but GOOGLE_CLOUD_PROJECT is not set -- skipping AI tagging');
    return null;
  }
  if (!client) {
    client = new VertexAI({ project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION });
  }
  return client;
}

function buildPrompt(title: string, candidates: TagCandidate[]): string {
  const options = candidates.map(c => `- ${c.id}: ${c.name} (${c.facet})`).join('\n');
  return [
    'You are classifying a Thai government procurement announcement title into a FIXED set of tags.',
    'Only choose tags from the list below -- never invent a new tag name.',
    'Return at most 5 tags that genuinely apply. If none apply, return an empty array.',
    '',
    `Title: ${title}`,
    '',
    'Candidate tags:',
    options,
    '',
    'Respond with ONLY a JSON array of matching tag ids, e.g. ["cat-1","kw-3"].'
  ].join('\n');
}

function parseTagIds(text: string, validIds: Set<string>): string[] {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id));
  } catch {
    return [];
  }
}

/**
 * Returns the subset of `candidates` (by id) that apply to `title`.
 * Never throws -- any failure (disabled, missing credentials, API error,
 * timeout, unparseable response) resolves to an empty array so ingestion
 * always proceeds with at least the structured (site/agency) tags.
 */
export async function classifyTags(title: string, candidates: TagCandidate[]): Promise<string[]> {
  if (candidates.length === 0) return [];

  const vertexAi = getClient();
  if (!vertexAi) return [];

  try {
    const model = vertexAi.getGenerativeModel({
      model: env.VERTEX_AI_MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 256 }
    });

    const result = await model.generateContent(buildPrompt(title, candidates));
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const validIds = new Set(candidates.map(c => c.id));
    return parseTagIds(text, validIds);
  } catch (err) {
    logger.warn('vertexAi', `classifyTags failed for title "${title.slice(0, 60)}..." -- continuing without AI tags`, err);
    return [];
  }
}
