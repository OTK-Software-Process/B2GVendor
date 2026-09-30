import type { PriceCandidate } from '../../utils/priceExtraction';

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
  // "บาท" amounts scanned from the FULL text of every PDF of the work (see
  // utils/priceExtraction.ts) -- documentText above is truncated, so the
  // price can be in here without being visible there. Listed in the prompt
  // so the model can't miss it, and used as a fallback when it still returns
  // no budget (or when AI is off entirely).
  priceHints?: PriceCandidate[];
  // The document is a winner announcement (announce type W0/W2). The only
  // price such a page carries is the winning bid ("โดยเสนอราคาเป็นเงินทั้งสิ้น
  // ..."), so the scan -- whose labels identify that figure exactly -- is
  // trusted over the model here, and a winning bid is accepted as the price.
  acceptAwardedPrice?: boolean;
}

export interface NewTagProposal {
  name: string;
  facet: 'category' | 'keyword';
}

export interface DocumentAnalysisResult {
  description: string | null;
  tagIds: string[];
  // Estimated/reference price (THB) actually stated in the document text --
  // e.g. "ราคากลาง" or "วงเงินงบประมาณ". The one exception is a winner
  // announcement, where the figure is the winning bid (see budgetBasis); the
  // full contract data only exists post-award, via data.go.th enrichment.
  // null when the document doesn't state one, or no text was available at all.
  budget: number | null;
  // 'awarded' when `budget` is a winning bid (from a winner announcement)
  // rather than an estimated/reference price; null otherwise.
  budgetBasis: 'awarded' | null;
  // Where `budget` came from: the model read it ('ai'), or the model returned
  // nothing and the deterministic "บาท" scan supplied it ('text-match').
  // null when there is no budget.
  budgetSource: 'ai' | 'text-match' | null;
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
