import mongoose from 'mongoose';
import { env } from '../config/env';
import { Tag, TagFacet } from '../models/tag.model';

/**
 * Seeds the real category/method/keyword tag vocabulary -- 'site' facet
 * tags are NOT seeded here, they're created automatically per-GovSite (see
 * seedGovSites.ts / govSite.service.ts's createGovSite). The names/aliases
 * below mirror B2GVendor/src/lib/mock-data.ts's MOCK_TAGS so the real
 * taxonomy the frontend now reads from the backend looks like the mock UI
 * it replaces, not a random placeholder set.
 *
 * "บริการพัฒนาระบบซอฟต์แวร์" is flagged includeInIngestionFilter -- this is
 * THE software-only customer requirement's filter tag (see
 * Tag.includeInIngestionFilter, ingestion.service.ts's computeRelevance).
 * Toggle it off (or flag a different/additional tag) via
 * PATCH /admin/tags/:id/ingestion-filter without touching this script.
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const seeds: { name: string; facet: TagFacet; aliases: string[]; includeInIngestionFilter?: boolean }[] = [
    // --- category ---
    { name: 'งานก่อสร้างและโยธา', facet: 'category', aliases: ['โยธา', 'ก่อสร้าง', 'ปรับปรุงถนน', 'ทำสะพาน'] },
    { name: 'ครุภัณฑ์คอมพิวเตอร์และดิจิทัล', facet: 'category', aliases: ['คอมพิวเตอร์', 'ไอที', 'Hardware', 'Server'] },
    { name: 'เวชภัณฑ์และอุปกรณ์ทางการแพทย์', facet: 'category', aliases: ['ยา', 'การแพทย์', 'โรงพยาบาล', 'อุปกรณ์การแพทย์'] },
    {
      name: 'บริการพัฒนาระบบซอฟต์แวร์',
      facet: 'category',
      aliases: ['Software', 'App', 'ระบบสารสนเทศ', 'Cloud', 'ซอฟต์แวร์'],
      includeInIngestionFilter: true
    },
    // --- method ---
    { name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method', aliases: ['e-bidding', 'อีบิดดิ้ง'] },
    { name: 'วิธีตลาดอิเล็กทรอนิกส์ (e-market)', facet: 'method', aliases: ['e-market', 'อีมาร์เก็ต'] },
    // --- keyword ---
    { name: 'ระบบระบายน้ำและป้องกันน้ำท่วม', facet: 'keyword', aliases: ['น้ำท่วม', 'คลอง', 'เครื่องสูบน้ำ'] },
    { name: 'กล้องวงจรปิด CCTV', facet: 'keyword', aliases: ['CCTV', 'กล้องความปลอดภัย', 'Smart City'] }
  ];

  for (const seed of seeds) {
    const existing = await Tag.findOne({ name: seed.name, facet: seed.facet });
    if (existing) {
      console.log(`Tag "${seed.name}" (${seed.facet}) already exists -- skipping.`);
      continue;
    }
    const tag = await Tag.create({
      name: seed.name,
      facet: seed.facet,
      aliases: seed.aliases,
      includeInIngestionFilter: seed.includeInIngestionFilter ?? false
    });
    console.log(`Created tag: ${tag.name} (${tag.facet})${tag.includeInIngestionFilter ? ' [ingestion filter]' : ''}`);
  }

  console.log('\nDone. Site tags are not seeded here -- see seedGovSites.ts.');
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('seed:tags failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
