import { htmlToText } from '../utils/htmlToText';
import { contentFromText, DocumentContent } from './pdfText.service';

// Turns an e-GP HTML announcement page (already decoded to a string -- see
// egpRss.client.ts's fetchHtmlDocument) into the same shape a PDF yields, so
// the rest of the pipeline treats both alike.
//
// e-GP answers "the announcement file doesn't exist" with HTTP 200 and a
// near-empty page -- confirmed live: the title plus "E4514:ค้นหาไฟล์เอกสารไม่พบ"
// ("document file not found"), about 55 characters. That is NOT a document
// that states no price, so it must not be reported as one: it yields no text,
// which the caller treats as "nothing to read" (retryable), never as a
// readable document. A real winner page is over a thousand characters.
const MIN_DOCUMENT_CHARS = 100;
const EGP_ERROR_CODE = /\bE\d{4}\s*[:：]/;
const MAX_ERROR_PAGE_CHARS = 400;

export function extractHtmlContent(html: string, sourceName?: string): DocumentContent {
  const text = htmlToText(html);

  const tooShort = text.length < MIN_DOCUMENT_CHARS;
  const errorPage = EGP_ERROR_CODE.test(text) && text.length < MAX_ERROR_PAGE_CHARS;
  if (tooShort || errorPage) return { text: null, priceCandidates: [] };

  return contentFromText(text, sourceName);
}
