import pdfParse from 'pdf-parse';
import { logger } from '../utils/logger';
import { PriceCandidate, findPriceCandidates } from '../utils/priceExtraction';

// Extracts plain text from a downloaded TOR PDF so the AI-tagging step can
// read the actual document content (FR-3.2), not just the RSS title.
//
// Limitation, stated plainly: this extracts embedded text only -- it does
// NOT do OCR. A scanned/image-only PDF (no text layer) will yield an empty
// or near-empty string here, which the caller must treat as "no content
// available" (falls back to title-only classification), not an error.
//
// The text handed to the AI is capped at MAX_CHARS to keep the prompt (and its
// cost) bounded -- a TOR PDF's opening pages (scope of work, background) carry
// the classification signal. But the PRICE (ราคากลาง / วงเงินงบประมาณ) usually
// sits in a cost table well past that cut-off, which is exactly why the AI
// used to "skip" it. So prices are scanned from the FULL text first
// (utils/priceExtraction.ts) and returned alongside the capped text; the AI
// prompt then lists them explicitly.
const MAX_CHARS = 8000;

// What a document (a PDF here; an HTML announcement page in htmlText.service.ts)
// yields for the ingestion pipeline.
export interface DocumentContent {
  // Whitespace-normalised and capped to MAX_CHARS -- what the AI reads. null
  // when the document has no extractable text (scanned/image-only PDF) or
  // parsing failed.
  text: string | null;
  // Every "บาท" amount found in the FULL text, before the cap. Empty when
  // there is no text.
  priceCandidates: PriceCandidate[];
}

// pdf-parse's raw output carries the source PDF's own line-wrapping and
// per-page whitespace padding -- collapsing runs of blank/whitespace-only
// lines cuts a meaningful chunk of tokens off the AI prompt (this text is
// the only thing ever sent to the AI provider -- see integrations/ai --
// never the PDF bytes themselves) without losing any actual content.
function normalizeForAi(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The step every document format shares: normalise the raw text, cap what the
 * AI will read, and scan the FULL text for prices (before the cap).
 * @param sourceName label attached to each price candidate (a PDF's filename)
 *   so a hint can say which file of a multi-PDF bundle it came from.
 */
export function contentFromText(rawText: string, sourceName?: string): DocumentContent {
  const fullText = normalizeForAi(rawText);
  if (!fullText) return { text: null, priceCandidates: [] };

  return {
    text: fullText.length > MAX_CHARS ? fullText.slice(0, MAX_CHARS) : fullText,
    priceCandidates: findPriceCandidates(fullText, sourceName)
  };
}

export async function extractPdfContent(buffer: Buffer, sourceName?: string): Promise<DocumentContent> {
  try {
    const result = await pdfParse(buffer);
    return contentFromText(result.text, sourceName);
  } catch (err) {
    logger.warn('pdfText', 'Failed to extract text from PDF -- continuing without it', err);
    return { text: null, priceCandidates: [] };
  }
}
