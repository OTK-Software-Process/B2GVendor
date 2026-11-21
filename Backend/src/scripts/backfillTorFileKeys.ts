import { promises as fs } from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Work } from '../models/work.model';
import { resolveTorFilePath, torStorageKeyFor } from '../services/fileStorage.service';

// Renames TOR files stored under the old 96-bit key (the first 24 hex digits of
// their SHA-256) to the full 256-bit key new files get (ASVS V11.4.3), and
// repoints every work that refers to them. Each file is re-hashed from its
// bytes; one whose new hash does not start with its old key (changed on disk)
// is reported and left alone.
//   npm run backfill:tor-file-keys -- --dry-run     (only reports)
// In PowerShell pass the flag after `--` exactly like that, or npm swallows it.
const DRY_RUN = process.argv.includes('--dry-run');
const OLD_KEY = /^([0-9a-f]{24})\.pdf$/;

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const rows = await Work.aggregate<{ _id: string }>([
    { $unwind: '$torFiles' },
    { $match: { 'torFiles.storageKey': { $regex: OLD_KEY.source } } },
    { $group: { _id: '$torFiles.storageKey' } }
  ]);
  console.log(`${DRY_RUN ? '[dry run] ' : ''}${rows.length} stored file(s) still use a 96-bit key.`);

  let renamed = 0;
  let missing = 0;
  let mismatched = 0;
  let referencesUpdated = 0; // one per work per renamed file it lists

  for (const { _id: oldKey } of rows) {
    const prefix = OLD_KEY.exec(oldKey)?.[1];
    if (!prefix) continue;

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolveTorFilePath(oldKey));
    } catch {
      missing += 1;
      console.warn(`  ! ${oldKey}: not on disk -- left as it is`);
      continue;
    }

    const newKey = torStorageKeyFor(buffer);
    if (!newKey.startsWith(prefix)) {
      mismatched += 1;
      console.warn(`  ! ${oldKey}: its content no longer matches its key -- left as it is`);
      continue;
    }

    if (!DRY_RUN) {
      // Copy first, repoint the works, and only then remove the old file, so a
      // run stopped half-way never leaves a work pointing at nothing.
      const newPath = resolveTorFilePath(newKey);
      try {
        await fs.access(newPath);
      } catch {
        await fs.writeFile(newPath, buffer);
      }
      const result = await Work.updateMany(
        { 'torFiles.storageKey': oldKey },
        { $set: { 'torFiles.$[file].storageKey': newKey } },
        { arrayFilters: [{ 'file.storageKey': oldKey }] }
      );
      referencesUpdated += result.modifiedCount;
      await fs.unlink(resolveTorFilePath(oldKey)).catch(() => undefined);
    }
    renamed += 1;
  }

  console.log(
    `Done${DRY_RUN ? ' (dry run -- nothing written)' : ''}: ${renamed} file(s) ${DRY_RUN ? 'would be renamed' : 'renamed'} to the full SHA-256` +
      `${DRY_RUN ? '' : `, ${referencesUpdated} work file reference(s) updated`}; ${missing} missing, ${mismatched} changed on disk.`
  );
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:tor-file-keys failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
