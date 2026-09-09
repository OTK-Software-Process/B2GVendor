import AdmZip from 'adm-zip';
import { logger } from '../utils/logger';

// Splits a downloaded zip archive into its individual PDF entries. B0
// (draft-TOR) items are delivered this way via egp-upload-service rather
// than as a single PDF link -- see egpRss.client's classifyLink.

export interface ZipPdfEntry {
  filename: string;
  buffer: Buffer;
}

export function extractPdfsFromZip(zipBuffer: Buffer): ZipPdfEntry[] {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (err) {
    logger.warn('zipExtraction', 'Failed to open zip archive -- treating as no PDFs found', err);
    return [];
  }

  return zip
    .getEntries()
    .filter(entry => !entry.isDirectory && /\.pdf$/i.test(entry.entryName))
    .map(entry => ({
      filename: entry.entryName.split('/').pop() || entry.entryName,
      buffer: entry.getData()
    }));
}

// A real B0 zip packages several PDFs together: the actual draft-TOR body
// (named like doc_<deptCode>_<projectId>.pdf), a short cover sheet
// (annoudoc_...), and numbered attachments (Attach_TOR_1.pdf, ...). Only the
// body is worth text-extracting and sending to the AI -- prefer a
// "doc_"-prefixed file that ISN'T the "annoudoc_" cover sheet; fall back to
// the largest file if that naming convention isn't present (other agencies
// may package differently).
export function pickPrimaryPdf(entries: ZipPdfEntry[]): ZipPdfEntry {
  const docMatch = entries.find(e => /^doc_/i.test(e.filename) && !/^annoudoc_/i.test(e.filename));
  if (docMatch) return docMatch;

  return entries.reduce((largest, e) => (e.buffer.length > largest.buffer.length ? e : largest), entries[0]);
}
