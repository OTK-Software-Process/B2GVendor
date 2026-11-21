import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { hasPdfSignature, safePdfFilename } from '../utils/pdfFile';

// Local-disk TOR file storage (FR-N1.6: deduplicated by content hash). This
// is intentionally a thin, swappable module -- moving to a real object
// storage bucket later only means rewriting this one file, not the
// ingestion pipeline that calls it.
//
// Only PDFs are ever stored, always under a <hash>.pdf key: the remote
// server's file name is kept as a display name only and never decides the
// stored extension (a ".html" name used to be stored -- and served -- as such).

const storageDir = path.isAbsolute(env.TOR_STORAGE_DIR)
  ? env.TOR_STORAGE_DIR
  : path.join(process.cwd(), env.TOR_STORAGE_DIR);

export interface SavedFile {
  storageKey: string;
  filename: string;
}

export class NotPdfError extends Error {
  constructor(filename: string) {
    super(`Not a PDF (no %PDF- signature): ${filename}`);
    this.name = 'NotPdfError';
  }
}

/**
 * The key a file is stored under: its FULL SHA-256 (64 hex digits) + ".pdf".
 * The key is both the file's identity and the de-duplication check, so it must
 * be collision-resistant (ASVS V11.4.3). Files stored before this used the first
 * 96 bits only (24 hex digits); `npm run backfill:tor-file-keys` renames them.
 */
export function torStorageKeyFor(buffer: Buffer): string {
  return `${crypto.createHash('sha256').update(buffer).digest('hex')}.pdf`;
}

/** Stores a TOR PDF. Throws NotPdfError for anything that isn't one. */
export async function saveTorFile(buffer: Buffer, suggestedFilename: string): Promise<SavedFile> {
  const filename = safePdfFilename(suggestedFilename);
  if (!hasPdfSignature(buffer)) throw new NotPdfError(filename);

  await fs.mkdir(storageDir, { recursive: true });

  const storageKey = torStorageKeyFor(buffer);
  const filePath = path.join(storageDir, storageKey);

  try {
    await fs.access(filePath);
    // Already stored (same content hash) -- FR-N1.6, don't re-write.
  } catch {
    await fs.writeFile(filePath, buffer);
  }

  return { storageKey, filename };
}

export function resolveTorFilePath(storageKey: string): string {
  const safeKey = path.basename(storageKey); // defend against path traversal
  return path.join(storageDir, safeKey);
}

export async function torFileExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(resolveTorFilePath(storageKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the stored file really is a PDF. Checked when serving, so a file
 * stored before the signature check existed can never go out as something else.
 */
export async function isStoredPdf(storageKey: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(resolveTorFilePath(storageKey), 'r');
    const head = Buffer.alloc(8);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return hasPdfSignature(head.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
