import mongoose from 'mongoose';
import { env } from '../config/env';
import { GovSite } from '../models/govSite.model';
import { getPollStatus } from '../services/pollJob.service';
import { backfillHtmlPrices, countHtmlPriceBackfill } from '../services/ingestion.service';

/**
 * One-off catch-up for works that were ingested BEFORE HTML announcement pages
 * were read (npm run backfill:html-prices, or in Docker:
 * docker compose exec backend node dist/scripts/backfillHtmlPrices.js).
 *
 * Every such work (in practice a winner announcement) has no price and a link
 * nobody has opened. A normal poll reads at most 40 of them per site, so a big
 * backlog takes many polls; this reads them all in one run, one request per
 * (60 / the site's requestsPerMinute) seconds, through the same code path as
 * the poll -- so the same rules apply (only the exact RSS-linked page, e-GP
 * hosts only, the winning bid is labelled as such and never overwrites an
 * existing ราคากลาง).
 *
 *   --dry-run        only count what would be read; no request, no change
 *   --retry-failed   also try pages that were given up on (3 misses) or tried
 *                    within the last 6 hours
 *   --limit=N        read at most N pages per site (try a few first)
 *
 * Safe to stop and re-run: a page that was read is not asked for again. Run it
 * while no poll is running. Works that have no description yet are also sent to
 * the AI once (same as a poll would), so a large run makes that many AI calls.
 */
const DRY_RUN = process.argv.includes('--dry-run');
const RETRY_FAILED = process.argv.includes('--retry-failed');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;

const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

async function main(): Promise<void> {
  if (limitArg && !(Number.isInteger(LIMIT) && LIMIT > 0)) {
    console.error('--limit must be a positive whole number, e.g. --limit=20');
    process.exit(1);
  }
  if (!env.EGP_HTML_TOR_ENABLED) {
    console.error('Reading HTML pages is switched off (EGP_HTML_TOR_ENABLED=false) -- nothing to do.');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  if (!DRY_RUN && (await getPollStatus()).isPolling) {
    console.error('A poll is running right now. Wait for it to finish (Admin > Data ingestion) and run this again.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const sites = await GovSite.find({}).sort({ shortCode: 1 });
  let totalRead = 0;
  let totalPriced = 0;

  for (const site of sites) {
    const { awaiting, givenUp } = await countHtmlPriceBackfill(site);
    const label = `${site.shortCode} (${site.name})`;

    if (!site.enabled) {
      console.log(`${label}: disabled -- skipped (${awaiting + givenUp} work(s) waiting)`);
      continue;
    }
    const todo = RETRY_FAILED ? awaiting + givenUp : awaiting;
    console.log(
      `${label}: ${awaiting} work(s) with an unread page` +
        (givenUp > 0 ? `, ${givenUp} more given up on or tried within 6 hours${RETRY_FAILED ? ' (retrying them too)' : ' (--retry-failed to try them again)'}` : '')
    );
    if (DRY_RUN || todo === 0) continue;

    let read = 0;
    let priced = 0;
    const seconds = Math.ceil(Math.min(todo, LIMIT) * (60 / site.requestsPerMinute));
    console.log(`  reading up to ${Math.min(todo, LIMIT)} page(s), about ${seconds}s at ${site.requestsPerMinute} requests/min...`);

    await backfillHtmlPrices(site, {
      htmlLimit: LIMIT,
      retryFailedHtml: RETRY_FAILED,
      onWorkSaved: work => {
        read += 1;
        if (work.budget) {
          priced += 1;
          console.log(`  + ${work.projectId}  ฿${baht.format(work.budget)}${work.budgetBasis === 'awarded' ? '  (winning bid)' : ''}`);
        } else {
          console.log(`  . ${work.projectId}  no price (${work.budgetMissingReason ?? 'unknown'})`);
        }
      }
    });
    totalRead += read;
    totalPriced += priced;
    console.log(`  ${site.shortCode}: ${read} work(s) updated, ${priced} now have a price`);
  }

  console.log(DRY_RUN ? '\n[dry run] nothing was requested or changed.' : `\nDone: ${totalRead} work(s) updated, ${totalPriced} now have a price.`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('backfill:html-prices failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
