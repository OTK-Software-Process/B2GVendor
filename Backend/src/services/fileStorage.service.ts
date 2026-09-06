import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env';

// Local-disk TOR file storage (FR-N1.6: deduplicated by content hash). This
// is intentionally a thin, swappable module -- moving to a real object
// storage bucket later only means rewriting this one file, not the
// ingestion pipeline that calls it.

const storageDir = path.isAbsolute(env.TOR_STORAGE_DIR)
  ? env.TOR_STORAGE_DIR
  : path.join(process.cwd(), env.TOR_STORAGE_DIR);

export interface SavedFile {
  storageKey: string;
  filename: string;
}

export async function saveTorFile(buffer: Buffer, suggestedFilename: string): Promise<SavedFile> {
  await fs.mkdir(storageDir, { recursive: true });

  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
  const ext = path.extname(suggestedFilename) || '.pdf';
  const storageKey = `${hash}${ext}`;
  const filePath = path.join(storageDir, storageKey);

  try {
    await fs.access(filePath);
    // Already stored (same content hash) -- FR-N1.6, don't re-write.
  } catch {
    await fs.writeFile(filePath, buffer);
  }

  return { storageKey, filename: suggestedFilename };
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
