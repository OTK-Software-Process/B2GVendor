import mongoose, { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { GovSite } from '../../src/models/govSite.model';
import { Tag } from '../../src/models/tag.model';
import { Work, IWork } from '../../src/models/work.model';
import { applyWorkFacts } from '../../src/services/workFacts.service';
import { listWorksQuerySchema } from '../../src/validators/work.validator';
import { SubmissionDeadline, mergeProcurementFacts } from '../../src/utils/procurementFacts';

// DB + HTTP check for the procurement method / fiscal year / bid deadline:
// how they are applied to a work (workFacts.service.ts) and how the public
// /works API filters and sorts by them. Uses its own throwaway database
// (dropped at the start and end). Run: npm run check:facts-db
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-work-facts-check';

const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

const DAY = 24 * 3600_000;
const inDays = (n: number): Date => new Date(Date.now() + n * DAY);

function deadlineIn(days: number, withTime = true): SubmissionDeadline {
  const endAt = inDays(days);
  return { startAt: withTime ? new Date(endAt.getTime() - 3 * 3600_000) : undefined, endAt, hasTime: withTime };
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = MONGODB_URI;
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const getJson = async (path: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(base + path);
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const site = await GovSite.create({ name: 'Site A', shortCode: 'AAA', deptId: '1' });
  const newWork = (projectId: string, title: string, extra: Partial<IWork> = {}): IWork =>
    new Work({ siteId: site._id, projectId, title, status: 'BIDDING', announceType: 'D0', pubDate: new Date(), ...extra });

  const EBID_TITLE = 'ประกวดราคาซื้อโต๊ะ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)';

  // ======================================================== applyWorkFacts
  // --- method ---
  {
    const w = newWork('69099397073', EBID_TITLE);
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    const tag = await Tag.findOne({ facet: 'method' });
    record(r.changed && !!tag && tag.name === 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', 'a method named in the title creates + assigns the method tag', tag?.name);
    record(w.tags.length === 1 && r.addedTagIds.length === 1 && w.tags[0].equals(tag!._id), '...and it is on the work (and reported as added, for notifications)');

    const again = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(!again.changed && again.addedTagIds.length === 0 && w.tags.length === 1 && (await Tag.countDocuments({ facet: 'method' })) === 1, 'applying twice changes nothing and adds no duplicate tag');

    const other = newWork('69099397074', 'ซื้อเก้าอี้ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)');
    await applyWorkFacts(other, { title: other.title, announceType: 'D0' });
    record(other.tags[0].equals(tag!._id) && (await Tag.countDocuments({ facet: 'method' })) === 1, 'a second work with the same method reuses the one tag');
  }
  {
    const w = newWork('69099397075', 'ซื้อวัสดุ โดยวิธีเฉพาะเจาะจง');
    const existingMethod = await Tag.create({ name: 'วิธีที่ถูกเลือกไว้แล้ว', facet: 'method' });
    w.tags.push(existingMethod._id);
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(!r.addedTagIds.length && w.tags.length === 1, 'a work that already has a method tag never gets a second one');
    await Tag.deleteOne({ _id: existingMethod._id });
  }
  {
    // an admin RETIRED the e-market tag -> "stop using it": nothing assigned, nothing re-created
    await Tag.create({ name: 'วิธีตลาดอิเล็กทรอนิกส์ (e-market)', facet: 'method', retired: true });
    const before = await Tag.countDocuments({ facet: 'method' });
    const w = newWork('69099397076', 'ซื้อกระดาษ ด้วยวิธีตลาดอิเล็กทรอนิกส์(e-market)');
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(!r.addedTagIds.length && w.tags.length === 0 && (await Tag.countDocuments({ facet: 'method' })) === before, 'a RETIRED method tag is not assigned and not re-created');
  }
  {
    // an admin RENAMED the tag (alias kept) -> matched by alias, not duplicated
    await Tag.create({ name: 'คัดเลือก (ชื่อใหม่ที่ admin ตั้ง)', facet: 'method', aliases: ['คัดเลือก'] });
    const before = await Tag.countDocuments({ facet: 'method' });
    const w = newWork('69099397077', 'ซื้อเครื่องมือ โดยวิธีคัดเลือก');
    await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    const assigned = await Tag.findById(w.tags[0]);
    record(assigned?.name === 'คัดเลือก (ชื่อใหม่ที่ admin ตั้ง)' && (await Tag.countDocuments({ facet: 'method' })) === before, 'a renamed method tag is found by its alias (no duplicate)');
  }
  {
    // an admin removed the method tag from THIS work by hand -> it must stay removed
    const ebid = (await Tag.findOne({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' }))!;
    const w = newWork('69099397078', EBID_TITLE, { excludedTags: [ebid._id] });
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(!r.addedTagIds.length && w.tags.length === 0, "a method tag an admin removed from the work is never put back");
  }
  {
    const before = await Tag.countDocuments({ facet: 'method' });
    const w = newWork('69099397079', 'ซื้อ ด้วยวิธีประกวดราคาแบบ ประกวดแบบ โดยวิธีประกวดแบบ');
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0', dryRun: true });
    record(r.changed && (await Tag.countDocuments({ facet: 'method' })) === before, 'dry run: reports the change but creates no tag');
  }
  {
    const w = newWork('69099397080', 'ซื้อของ (ไม่ระบุวิธี)');
    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0', documents: { method: 'specific' } });
    const tag = await Tag.findById(w.tags[0]);
    record(r.addedTagIds.length === 1 && tag?.name === 'วิธีเฉพาะเจาะจง', "the document's method is the fallback when the title names none");
  }

  // --- fiscal year ---
  {
    const w = newWork('69099397081', 'ซื้อโต๊ะ ด้วยวิธีเฉพาะเจาะจง');
    await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(w.fiscalYear === 2569 && w.fiscalYearSource === 'estimated', 'no year stated -> estimated from the project number', `${w.fiscalYear}/${w.fiscalYearSource}`);

    await applyWorkFacts(w, { title: w.title, announceType: 'D0', documents: { fiscalYear: 2570 } });
    record(w.fiscalYear === 2570 && w.fiscalYearSource === 'document', 'a year stated in a document REPLACES the estimate (project 6909.. drafts really say 2570)');

    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(!r.changed && w.fiscalYear === 2570 && w.fiscalYearSource === 'document', 'a later document with no year never downgrades it back to an estimate');

    await applyWorkFacts(w, { title: 'ซื้อโต๊ะ ปีงบประมาณ พ.ศ. ๒๕๖๙ โดยวิธีเฉพาะเจาะจง', announceType: 'D0' });
    record(w.fiscalYear === 2569, 'the title\'s year wins over a document\'s');
  }
  {
    const w = newWork('XYZ', 'ซื้อโต๊ะ');
    await applyWorkFacts(w, { title: w.title, announceType: 'D0' });
    record(w.fiscalYear === undefined && w.fiscalYearSource === undefined, 'an unparseable project number and no stated year -> no year (never invented)');
  }

  // --- deadline ---
  {
    const announced = new Date();
    const w = newWork('69099397090', EBID_TITLE, { pubDate: announced });
    const d = deadlineIn(7);

    await applyWorkFacts(w, { title: w.title, announceType: 'B0', documents: { deadline: d }, reference: announced });
    record(w.deadlineAt === undefined, 'a draft-TOR (B0) document never sets a deadline');

    await applyWorkFacts(w, { title: w.title, announceType: 'W0', documents: { deadline: d }, reference: announced });
    record(w.deadlineAt === undefined, 'nor does a winner announcement (W0)');

    const r = await applyWorkFacts(w, { title: w.title, announceType: 'D0', documents: { deadline: d }, reference: announced });
    record(
      r.changed && w.deadlineAt?.getTime() === d.endAt.getTime() && w.deadlineStartAt?.getTime() === d.startAt?.getTime() && w.deadlineHasTime === true,
      'an invitation (D0) sets deadlineAt + the window start + hasTime'
    );

    const later = deadlineIn(14, false);
    await applyWorkFacts(w, { title: w.title, announceType: 'D2', documents: { deadline: later }, reference: announced });
    record(w.deadlineAt?.getTime() === later.endAt.getTime() && w.deadlineStartAt === undefined && w.deadlineHasTime === false, 'an amendment (D2) moves the deadline (and clears a start it no longer states)');

    const noDeadline = await applyWorkFacts(w, { title: w.title, announceType: 'D0', documents: mergeProcurementFacts({ fiscalYear: 2569 }), reference: announced });
    record(w.deadlineAt?.getTime() === later.endAt.getTime() && noDeadline.changed, 'a later document that states no deadline leaves the old one alone');

    const stray = newWork('69099397091', EBID_TITLE, { pubDate: announced });
    await applyWorkFacts(stray, { title: stray.title, announceType: 'D0', documents: { deadline: deadlineIn(-30) }, reference: announced });
    record(stray.deadlineAt === undefined, 'a "deadline" a month BEFORE the announcement is a misread and is rejected');
    await applyWorkFacts(stray, { title: stray.title, announceType: 'D0', documents: { deadline: deadlineIn(900) }, reference: announced });
    record(stray.deadlineAt === undefined, '...and so is one years after it');
  }

  // ============================================== the public /works API
  const ebid = (await Tag.findOne({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' }))!;
  const specific = (await Tag.findOne({ name: 'วิธีเฉพาะเจาะจง' }))!;
  const roads = await Tag.create({ name: 'Roads', facet: 'category' });
  const bridges = await Tag.create({ name: 'Bridges', facet: 'category' });
  await Work.deleteMany({});

  type Spec = { id: string; title: string; status?: IWork['status']; fy?: number; dl?: number; tags: Types.ObjectId[]; budget?: number };
  const specs: Spec[] = [
    { id: 'W1', title: 'งานถนน A', fy: 2569, dl: 10, tags: [roads._id, ebid._id], budget: 500 },
    { id: 'W2', title: 'งานถนน B', fy: 2569, dl: 3, tags: [roads._id, specific._id], budget: 100 },
    { id: 'W3', title: 'งานสะพาน C', fy: 2570, dl: 5, tags: [bridges._id, ebid._id] },
    { id: 'W4', title: 'งานถนน D (ปิดรับแล้ว)', fy: 2569, dl: -2, tags: [roads._id, ebid._id], budget: 300 },
    { id: 'W5', title: 'งานถนน E (ไม่มีกำหนด)', fy: 2569, tags: [roads._id], budget: 50 },
    { id: 'W6', title: 'งานถนน F (ยกเลิก)', status: 'CANCELLED', fy: 2569, dl: 4, tags: [roads._id, ebid._id] },
    { id: 'W7', title: 'งานถนน G (ผู้ชนะ)', status: 'AWARDED', fy: 2568, dl: 6, tags: [roads._id, specific._id] },
    { id: 'W8', title: 'งานสะพาน H', fy: 2569, dl: 1, tags: [bridges._id] }
  ];
  const created: Record<string, string> = {};
  let offset = 0;
  for (const s of specs) {
    const w = await Work.create({
      siteId: site._id,
      projectId: s.id,
      title: s.title,
      status: s.status ?? 'BIDDING',
      announceType: 'D0',
      // distinct, descending publish dates so the default order is predictable: W1 newest
      pubDate: new Date(Date.now() - offset++ * DAY),
      tags: s.tags,
      fiscalYear: s.fy,
      fiscalYearSource: s.fy ? 'document' : undefined,
      deadlineAt: s.dl === undefined ? undefined : inDays(s.dl),
      deadlineHasTime: s.dl === undefined ? undefined : true,
      budget: s.budget
    });
    created[s.id] = w._id.toString();
  }
  const idToName = Object.fromEntries(Object.entries(created).map(([k, v]) => [v, k]));
  const names = (json: any): string[] => json.data.items.map((i: any) => idToName[i._id]);

  // --- filters ---
  const fy2569 = await getJson('/works?fiscalYear=2569&pageSize=50');
  record(fy2569.status === 200 && names(fy2569.json).sort().join() === 'W1,W2,W4,W5,W6,W8', 'fiscalYear=2569 returns exactly the 2569 works', names(fy2569.json).join());
  record((await getJson('/works?fiscalYear=1999')).status === 400, 'an out-of-range fiscalYear is rejected (400)');
  record((await getJson('/works?fiscalYear=abc')).status === 400, 'a non-numeric fiscalYear is rejected (400)');

  const methodOnly = await getJson(`/works?tag=${ebid._id}&pageSize=50`);
  record(names(methodOnly.json).sort().join() === 'W1,W3,W4,W6', 'filtering by one METHOD tag returns the works with that method', names(methodOnly.json).join());

  const twoMethods = await getJson(`/works?tag=${ebid._id},${specific._id}&pageSize=50`);
  record(names(twoMethods.json).sort().join() === 'W1,W2,W3,W4,W6,W7', 'two tags of the SAME facet match either (OR)', names(twoMethods.json).join());

  const methodAndCategory = await getJson(`/works?tag=${ebid._id},${roads._id}&pageSize=50`);
  record(names(methodAndCategory.json).sort().join() === 'W1,W4,W6', 'tags of DIFFERENT facets must both match (method AND category) -- adding a facet narrows', names(methodAndCategory.json).join());

  const twoCats = await getJson(`/works?tag=${roads._id},${bridges._id}&pageSize=50`);
  record(twoCats.json.data.total === 8, 'two categories match either (OR)', String(twoCats.json.data.total));

  const methodCatYear = await getJson(`/works?tag=${ebid._id},${roads._id}&fiscalYear=2569&pageSize=50`);
  record(names(methodCatYear.json).sort().join() === 'W1,W4,W6', 'method + category + fiscal year combine', names(methodCatYear.json).join());

  const unknownTag = await getJson(`/works?tag=${new Types.ObjectId()}`);
  record(unknownTag.status === 200 && unknownTag.json.data.total === 0, 'a tag id that does not exist matches nothing');
  const junkTag = await getJson('/works?tag=not-an-id');
  record(junkTag.status === 200 && junkTag.json.data.total === 0, 'a malformed tag id matches nothing (no 500)');
  const mixed = await getJson(`/works?tag=${ebid._id},${new Types.ObjectId()}`);
  record(mixed.status === 200 && mixed.json.data.total === 0, 'a real tag + a non-existent one matches nothing (facet AND)');

  // --- sort by deadline ---
  const byDeadline = await getJson('/works?sort=deadline&pageSize=50');
  // open + upcoming first, soonest closing first: W8(1) W2(3) W3(5) W1(10); then the rest newest-first:
  // W4 (closed), W5 (none), W6 (cancelled), W7 (awarded) in publish order.
  record(names(byDeadline.json).join() === 'W8,W2,W3,W1,W4,W5,W6,W7', 'sort=deadline: soonest-closing open works first, then everything else newest-first', names(byDeadline.json).join());
  record(byDeadline.json.data.total === 8, '...with the full total');

  const page1 = await getJson('/works?sort=deadline&pageSize=3&page=1');
  const page2 = await getJson('/works?sort=deadline&pageSize=3&page=2');
  const page3 = await getJson('/works?sort=deadline&pageSize=3&page=3');
  record(
    [...names(page1.json), '|', ...names(page2.json), '|', ...names(page3.json)].join() === 'W8,W2,W3,|,W1,W4,W5,|,W6,W7',
    'sort=deadline paginates correctly ACROSS the open / not-open boundary',
    `${names(page1.json)} | ${names(page2.json)} | ${names(page3.json)}`
  );

  const deadlineWithSearch = await getJson(`/works?sort=deadline&q=${encodeURIComponent('ถนน')}&pageSize=50`);
  record(names(deadlineWithSearch.json).join() === 'W2,W1,W4,W5,W6,W7', 'sort=deadline keeps the free-text search (q) in BOTH groups', names(deadlineWithSearch.json).join());

  const deadlineWithTags = await getJson(`/works?sort=deadline&tag=${ebid._id},${roads._id}&pageSize=50`);
  record(names(deadlineWithTags.json).join() === 'W1,W4,W6', 'sort=deadline keeps the facet filter in BOTH groups', names(deadlineWithTags.json).join());

  const cancelledOnly = await getJson('/works?sort=deadline&status=CANCELLED');
  record(names(cancelledOnly.json).join() === 'W6', 'sort=deadline with an explicit status filter just uses that status');

  // --- the budget sort still behaves (it shares the two-group helper) ---
  const budgetAsc = await getJson('/works?sort=budget-asc&pageSize=50');
  record(names(budgetAsc.json).slice(0, 4).join() === 'W5,W2,W4,W1' && names(budgetAsc.json).length === 8, 'sort=budget-asc: priced ascending first, unpriced after (unchanged by the refactor)', names(budgetAsc.json).join());
  const budgetAscQ = await getJson(`/works?sort=budget-asc&q=${encodeURIComponent('สะพาน')}&pageSize=50`);
  record(names(budgetAscQ.json).sort().join() === 'W3,W8', 'sort=budget-asc keeps the free-text search too', names(budgetAscQ.json).join());
  const dateSort = await getJson('/works?pageSize=50');
  record(names(dateSort.json).join() === 'W1,W2,W3,W4,W5,W6,W7,W8', 'default sort (newest first) is unchanged', names(dateSort.json).join());

  // --- the API shape the website reads ---
  const sample = (await getJson(`/works/${created.W1}`)).json.data;
  record(sample.fiscalYear === 2569 && sample.fiscalYearSource === 'document' && typeof sample.deadlineAt === 'string' && sample.deadlineHasTime === true, 'GET /works/:id exposes fiscalYear, fiscalYearSource, deadlineAt, deadlineHasTime');

  // --- fiscal-year facet ---
  await Work.updateOne({ projectId: 'W7' }, { ingestionRelevance: 'not-related' });
  const years = await getJson('/works/fiscal-years');
  record(
    years.status === 200 && JSON.stringify(years.json.data) === JSON.stringify([{ year: 2570, count: 1 }, { year: 2569, count: 6 }]),
    'GET /works/fiscal-years: years that have works, newest first, with counts (hidden "not-related" works excluded; the route is not read as a work id)',
    JSON.stringify(years.json?.data)
  );

  // --- validator ---
  record(listWorksQuerySchema.safeParse({ sort: 'deadline', fiscalYear: '2569' }).success, 'validator accepts sort=deadline + fiscalYear');
  record(!listWorksQuerySchema.safeParse({ sort: 'closing' }).success, 'validator still rejects an unknown sort');
  record(!listWorksQuerySchema.safeParse({ fiscalyear: '2569' }).success, 'validator is still strict about unknown parameters');

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
