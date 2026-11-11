import mongoose from 'mongoose';
import { env } from '../config/env';
import { Work } from '../models/work.model';
import { repairHistory, StatusEvent } from '../utils/statusHistory';

// Puts right the status and status history of works written by the older poll,
// which followed whichever announcement it read last: an old announcement still
// listed in a feed pulled an awarded work back to "draft TOR" and added a history
// entry on every poll. For each work: every announcement is kept once, in order of
// publication, and the status is that of the latest one (SRS FR-4.3, FR-5.4).
// Works that are already right are not touched.
//   npm run backfill:status-history -- --dry-run     (only reports)
const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const total = await Work.countDocuments();
  console.log(`${DRY_RUN ? '[dry run] ' : ''}Checking the status history of ${total} work(s)...`);

  let repairedHistory = 0;
  let repairedStatus = 0;
  const writes: { updateOne: { filter: { _id: mongoose.Types.ObjectId }; update: { $set: Record<string, unknown> } } }[] = [];

  const cursor = Work.find({}, '_id status announceType statusHistory').lean().cursor();
  for await (const work of cursor) {
    const history = (work.statusHistory ?? []) as StatusEvent[];
    if (history.length === 0) continue; // nothing to derive a status from

    const fixed = repairHistory(history);
    const latest = fixed[fixed.length - 1];
    const historyChanged = fixed.length !== history.length || fixed.some((event, i) => event !== history[i]);
    const statusChanged = work.status !== latest.status || work.announceType !== latest.announceType;
    if (!historyChanged && !statusChanged) continue;

    if (historyChanged) repairedHistory += 1;
    if (statusChanged) repairedStatus += 1;
    writes.push({ updateOne: { filter: { _id: work._id }, update: { $set: { statusHistory: fixed, status: latest.status, announceType: latest.announceType } } } });
  }

  if (writes.length > 0 && !DRY_RUN) await Work.bulkWrite(writes, { ordered: false });

  console.log(`Done${DRY_RUN ? ' (dry run -- nothing written)' : ''}: ${repairedHistory} history(ies) put in order, ${repairedStatus} status(es) corrected, ${total} work(s) checked.`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:status-history failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
