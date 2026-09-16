import mongoose from 'mongoose';
import { env } from '../config/env';
import { createGovSite } from '../services/govSite.service';
import { GovSite, AnnounceType } from '../models/govSite.model';

/**
 * Seeds government sites so the ingestion pipeline can be exercised
 * end-to-end. Split into two groups:
 *
 * 1. TEST sites (0304, 4520101) -- confirmed live (real, small,
 *    agency-specific result sets) during testAPI exploration, see
 *    testAPI/explore-egp-rss.ts's header comment.
 *
 * 2. Real customer-requested agencies (2026-09-16) -- there is NO published
 *    master list mapping an agency to its e-GP deptId (ProjectDescription.md
 *    N1 "Open risk"; data.go.th's own datasets carry no equivalent field
 *    either, see dataGoTh.client.ts). A first batch of 13-digit Tax IDs
 *    supplied for these agencies turned out to be from the wrong identifier
 *    system entirely -- confirmed live, all 7 returned zero items across
 *    every announce type, while deptId genuinely uses a separate e-GP/GFMIS
 *    numbering scheme (4 digits for a central ministry/department, 7 for a
 *    local government org, 10-12 for a state enterprise/public
 *    organization/special entity). A corrected batch of SHORT codes was
 *    then verified live, one at a time, BEFORE being added here:
 *      - MOPH (สนง.ปลัดกระทรวงสาธารณสุข) deptId=2102 -- 125 real items across
 *        7 of 9 announce types.
 *      - DOH-highway (กรมทางหลวง) deptId=0806 -- 122 real items.
 *      - DOH-health (กรมอนามัย) deptId=2109 -- 57 real items.
 *      - depa (สนง.ส่งเสริมเศรษฐกิจดิจิทัล) deptId=1106 -- only 2 items, but
 *        one is literally "...เมืองอัจฉริยะ...Thailand Smart City Expo
 *        2026" (Smart City is depa's own mandate) -- real, just sparse. The
 *        12-digit code the correction suggested (110610000001) returned
 *        ZERO -- rejected in favor of the empirically-verified 4-digit one.
 *    PEA, EGAT, and DGA are deliberately NOT included as enabled sites --
 *    per the same correction, these don't have one central deptId at all:
 *    PEA/EGAT are subdivided per branch (e.g. a specific PEA branch might be
 *    "5060000314" or "S50662000001", with no agency-wide code), and DGA's
 *    12-digit องค์การมหาชน-style code needs to be read off an actual
 *    DGA PO/contract inside e-GP, not guessed. Add them once someone has a
 *    real, branch-specific (or, for DGA, PO-verified) code -- seeding a
 *    guess here would silently ingest zero results forever.
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const defaultAnnounceTypes: AnnounceType[] = ['B0', 'D0', 'W0'];

  const seeds = [
    // {
    //   name: '[TEST] Agency 0304',
    //   shortCode: 'TEST0304',
    //   deptId: '0304',
    //   announceTypes: defaultAnnounceTypes
    // },
    // {
    //   name: '[TEST] Agency 4520101',
    //   shortCode: 'TEST4520101',
    //   deptId: '4520101',
    //   announceTypes: defaultAnnounceTypes,
    //   // Confirmed DataStore-backed CGD contract resource from testAPI's
    //   // `cgd`/`winner` commands -- real records, may age out over time.
    //   dataGoThResourceId: '2532b3a6-df25-4f4f-90f8-eb308b86229e'
    // },
    {
      name: 'สำนักงานปลัดกระทรวงสาธารณสุข',
      shortCode: 'MOPH',
      deptId: '2102',
      announceTypes: defaultAnnounceTypes
    },
    {
      name: 'กรมทางหลวง',
      shortCode: 'DOH-highway',
      deptId: '0806',
      announceTypes: defaultAnnounceTypes
    },
    {
      name: 'กรมอนามัย',
      shortCode: 'DOH-health',
      deptId: '2109',
      announceTypes: defaultAnnounceTypes
    },
    {
      name: 'สำนักงานส่งเสริมเศรษฐกิจดิจิทัล',
      shortCode: 'depa',
      deptId: '1106',
      announceTypes: defaultAnnounceTypes
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

  console.log(
    '\nDone. 0304/4520101 are TEST sites; MOPH/DOH-highway/DOH-health/depa are real, ' +
      'live-verified agencies. PEA/EGAT/DGA still need a real deptId sourced manually -- see this ' +
      "file's header comment."
  );
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('seed:gov-sites failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
