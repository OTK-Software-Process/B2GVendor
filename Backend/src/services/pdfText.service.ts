import pdfParse from 'pdf-parse';
import { logger } from '../utils/logger';

// Extracts plain text from a downloaded TOR PDF so the AI-tagging step can
// read the actual document content (FR-3.2), not just the RSS title.
//
// Limitation, stated plainly: this extracts embedded text only -- it does
// NOT do OCR. A scanned/image-only PDF (no text layer) will yield an empty
// or near-empty string here, which the caller must treat as "no content
// available" (falls back to title-only classification), not an error.
//
// Capped at MAX_CHARS to keep the AI prompt (and its cost) bounded -- a TOR
// PDF's opening pages (scope of work, background) carry the classification
// signal; a 40-page cost breakdown at the end doesn't add much for tagging.
const MAX_CHARS = 8000;

export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const result = await pdfParse(buffer);
    const text = result.text.trim();
    if (!text) return null;
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  } catch (err) {
    logger.warn('pdfText', 'Failed to extract text from PDF -- continuing without it', err);
    return null;
  }
}
