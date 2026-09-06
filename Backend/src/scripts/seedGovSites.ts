import mongoose from 'mongoose';
import { env } from '../config/env';
import { createGovSite } from '../services/govSite.service';
import { GovSite, AnnounceType } from '../models/govSite.model';

/**
 * Seeds a small number of TEST government sites so the ingestion pipeline
 * can be exercised end-to-end. These are NOT the 7 launch sites from the
 * spec -- there is no published master list mapping an agency to its e-GP
 * deptId (see ProjectDescription.md N1 "Open risk"), so the real BMA/DOH/
 * PEA/etc deptIds still need to be collected manually before launch.
 *
 * deptId 0304 and 4520101 were confirmed live (real, small, agency-specific
 * result sets) during testAPI exploration -- see
 * testAPI/explore-egp-rss.ts's header comment.
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const defaultAnnounceTypes: AnnounceType[] = ['B0', 'D0', 'W0'];

  const seeds = [
    {
      name: '[TEST] Agency 0304',
      shortCode: 'TEST0304',
      deptId: '0304',
      announceTypes: defaultAnnounceTypes
    },
    {
      name: '[TEST] Agency 4520101',
      shortCode: 'TEST4520101',
      deptId: '4520101',
      announceTypes: defaultAnnounceTypes,
      // Confirmed DataStore-backed CGD contract resource from testAPI's
      // `cgd`/`winner` commands -- real records, may age out over time.
      dataGoThResourceId: '2532b3a6-df25-4f4f-90f8-eb308b86229e'
    }
  ];

  for (const seed of seeds) {
    const existing = await GovSite.findOne({ deptId: seed.deptId });
    if (existing) {
      console.log(`Site with deptId ${seed.deptId} already exists (${existing.name}) -- skipping.`);
      continue;
    }
    const site = await createGovSite(seed);
    console.log(`Created site: ${site.name} (deptId=${site.deptId})`);
  }

  console.log('\nDone. These are TEST sites for verifying the pipeline, not the real launch scope.');
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('seed:gov-sites failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
