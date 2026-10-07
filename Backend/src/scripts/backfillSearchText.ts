import mongoose from 'mongoose';
import { env } from '../config/env';
import { Work } from '../models/work.model';
import { normalizeThaiSearchText } from '../utils/thaiSearch';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const total = await Work.countDocuments();
  console.log(`${DRY_RUN ? '[dry run] ' : ''}Updating Thai-normalized search text on ${total} work(s)...`);

  let batch: {
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: { $set: { searchText: string } };
    };
  }[] = [];
  let processed = 0;

  const cursor = Work.find({}, '_id title description').lean().cursor();
  for await (const work of cursor) {
    processed += 1;
    batch.push({
      updateOne: {
        filter: { _id: work._id },
        update: {
          $set: {
            searchText: normalizeThaiSearchText(`${work.title}\n${work.description ?? ''}`)
          }
        }
      }
    });

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await Work.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }

  if (batch.length > 0 && !DRY_RUN) await Work.bulkWrite(batch, { ordered: false });

  console.log(`Done${DRY_RUN ? ' (dry run -- nothing written)' : ''}: ${processed} work(s) processed.`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:search-text failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
