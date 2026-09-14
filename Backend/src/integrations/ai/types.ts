export interface TagCandidate {
  id: string;
  name: string;
  facet: 'category' | 'keyword';
}

export interface DocumentAnalysisInput {
  title: string;
  // Plain text only -- never a PDF/HTML buffer. Whatever document we got
  // (PDF today, extracted via pdfText.service.ts; anything else in the
  // future) must be converted to text BEFORE it reaches this module, both to
  // keep token usage down and so every provider sees the same shape of
  // input. Null/undefined means no document text was available at all
  // (title-only classification).
  documentText?: string | null;
}

export interface DocumentAnalysisResult {
  description: string | null;
  tagIds: string[];
}

// One text-in/text-out call, shared by every backend (Vertex AI, OpenRouter,
// ...) so integrations/ai/index.ts can build the prompt once and switch
// providers with zero changes to prompt/parsing logic. systemPrompt is the
// fixed, hidden instruction (see prompt.ts); userPrompt carries the
// per-document content.
export interface AiProvider {
  name: string;
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}
