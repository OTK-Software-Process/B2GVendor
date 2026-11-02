import AdmZip from 'adm-zip';
import { logger } from '../utils/logger';
import { hasPdfSignature, safePdfFilename } from '../utils/pdfFile';

// Splits a downloaded zip archive into its individual PDF entries. B0
// (draft-TOR) items are delivered this way via egp-upload-service rather
// than as a single PDF link -- see egpRss.client's classifyLink.
//
// The archive is untrusted input, so it is never unpacked blindly (a "zip
// bomb" of a few KB can inflate to gigabytes):
//   - an archive with more than maxEntries entries, or more than maxPdfEntries
//     PDFs, is refused outright (a real TOR zip holds a handful);
//   - each entry's DECLARED unpacked size is checked against maxEntryBytes and
//     the running maxTotalBytes budget BEFORE it is inflated. adm-zip >= 0.6.1
//     refuses to inflate past the declared size, so the declared size is a real
//     upper bound -- an entry that lies about it fails to unpack and is skipped;
//   - an entry is kept only if its bytes start with the PDF signature.
// Nothing is ever written to disk here; the caller stores the kept buffers.

export interface ZipPdfEntry {
  filename: string;
  buffer: Buffer;
}

export interface ZipLimits {
  maxEntries: number;
  maxPdfEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const MB = 1024 * 1024;
export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 200,
  maxPdfEntries: 50,
  maxEntryBytes: 50 * MB,
  maxTotalBytes: 200 * MB
};

export function extractPdfsFromZip(zipBuffer: Buffer, limits: ZipLimits = ZIP_LIMITS): ZipPdfEntry[] {
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(zipBuffer).getEntries();
  } catch (err) {
    logger.warn('zipExtraction', 'Failed to open zip archive -- treating as no PDFs found', err);
    return [];
  }

  if (entries.length > limits.maxEntries) {
    logger.warn('zipExtraction', `Zip refused: ${entries.length} entries (limit ${limits.maxEntries})`);
    return [];
  }
  const pdfEntries = entries.filter(entry => !entry.isDirectory && /\.pdf$/i.test(entry.entryName));
  if (pdfEntries.length > limits.maxPdfEntries) {
    logger.warn('zipExtraction', `Zip refused: ${pdfEntries.length} PDF entries (limit ${limits.maxPdfEntries})`);
    return [];
  }

  const kept: ZipPdfEntry[] = [];
  let totalBytes = 0;
  for (const entry of pdfEntries) {
    const declared = entry.header.size;
    if (declared > limits.maxEntryBytes) {
      logger.warn('zipExtraction', `Skipped ${entry.entryName}: declares ${declared} bytes unpacked (limit ${limits.maxEntryBytes})`);
      continue;
    }
    if (totalBytes + declared > limits.maxTotalBytes) {
      logger.warn('zipExtraction', `Skipped ${entry.entryName}: the archive's unpacked total would pass ${limits.maxTotalBytes} bytes`);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = entry.getData();
    } catch (err) {
      logger.warn('zipExtraction', `Skipped ${entry.entryName}: could not be unpacked (corrupt, encrypted or a false size)`, err);
      continue;
    }
    // Belt and braces: adm-zip already caps the output at the declared size.
    if (buffer.length > declared || buffer.length > limits.maxEntryBytes) {
      logger.warn('zipExtraction', `Skipped ${entry.entryName}: unpacked to more than it declared`);
      continue;
    }
    if (!hasPdfSignature(buffer)) {
      logger.warn('zipExtraction', `Skipped ${entry.entryName}: named .pdf but is not a PDF`);
      continue;
    }

    totalBytes += buffer.length;
    kept.push({ filename: safePdfFilename(entry.entryName), buffer });
  }
  return kept;
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
