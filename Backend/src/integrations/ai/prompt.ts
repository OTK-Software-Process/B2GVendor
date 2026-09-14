import { DocumentAnalysisInput, TagCandidate } from './types';

/**
 * Fixed, hidden instruction sent as the "system" turn on every call,
 * regardless of provider or document. Never shown to end users -- its whole
 * job is to pin the output to one exact JSON shape so the website's Work
 * fields (description, tags) never drift as models/providers/prompts change
 * (requirement: "always return the same format ... that's gonna be used in
 * website page").
 */
export const SYSTEM_PROMPT = [
  'You are a backend classification service for a Thai government ' +
    'procurement listings website (B2G Vendor). Your output is consumed ' +
    'only by application code -- it is never shown to a user as-is, and you ' +
    'are never addressed by one.',
  '',
  'You MUST respond with ONLY one JSON object -- no markdown code fences, no ' +
    'explanation before or after it -- matching EXACTLY this shape:',
  '{"description": string or null, "tagIds": string[]}',
  '',
  'Rules (apply to every document, no exceptions):',
  '- "tagIds": choose ONLY from the candidate tag list given in the next ' +
    'message. Never invent a tag id or name that is not in that list. ' +
    'Return at most 5, and only ones that genuinely apply.',
  '- "description": a short 1-2 sentence PLAIN-THAI summary of what the ' +
    'procurement is actually for. Never repeat the title verbatim. Never ' +
    'state a fact that is not present in the supplied document text.',
  '- If no document text is supplied (title only), "description" MUST be ' +
    'null -- do not guess a description from the title alone.',
  '- When unsure about a field, prefer null / an empty array over a guess.',
  '- Output raw JSON only. It must parse directly with JSON.parse -- no ' +
    'trailing commentary, no ```json fences.'
].join('\n');

export function buildUserPrompt(input: DocumentAnalysisInput, candidates: TagCandidate[]): string {
  const options = candidates.map(c => `- ${c.id}: ${c.name} (${c.facet})`).join('\n');
  const hasText = !!input.documentText;

  return [
    `Title: ${input.title}`,
    '',
    hasText
      ? `Document text (already extracted to plain text):\n${input.documentText}`
      : '(No document text is available -- only the title above.)',
    '',
    'Candidate tags -- choose only from this list:',
    options || '(none configured)'
  ].join('\n');
}
