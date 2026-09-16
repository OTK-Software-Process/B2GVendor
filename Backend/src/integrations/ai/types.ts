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

export interface NewTagProposal {
  name: string;
  facet: 'category' | 'keyword';
}

export interface DocumentAnalysisResult {
  description: string | null;
  tagIds: string[];
  // Estimated/reference price (THB) actually stated in the document text --
  // e.g. "ราคากลาง" or "วงเงินงบประมาณ" -- NOT the final award amount (that
  // only exists post-award, via data.go.th enrichment). null when the
  // document doesn't state one, or no document text was available at all.
  budget: number | null;
  // A brand-new tag the model proposes ONLY when none of the candidates
  // genuinely applied -- see prompt.ts. The caller (ingestion.service.ts)
  // is responsible for actually persisting this via
  // tag.service.ts's findOrCreateAiTag() and merging it into tagIds; this
  // module never touches the database itself. null on every ordinary call
  // where an existing tag was a good enough fit.
  newTag: NewTagProposal | null;
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
