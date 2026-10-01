import http from 'node:http';
import mongoose from 'mongoose';

// Integration check for the places where the admin panel and the ingestion
// pipeline meet (the two were built on separate branches):
//   A. a tag an admin removed from a work stays removed when the retry sweep
//      re-reads that work's document (the sweep is where HTML pages are read);
//   B. the admin-only `excludedTags` field never reaches the public API, on
//      every listing path (including "budget: low to high");
//   C. the dashboard's schedule / queue figures follow the same rules as Data
//      Ingestion (24 h interval, pause switch, stale queued jobs don't count).
// Run: npm run check:admin-ingestion   (needs a MongoDB; see MONGODB_URI below)
//
// Safety: this script DROPS its database, so it refuses to run against any DB
// whose name doesn't contain "check". Every network call goes to a local server
// started here -- the real e-GP site and any real AI provider are never contacted,
// whatever is in Backend/.env.

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-ingestion-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI; // set BEFORE the app modules read env

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// The model's answer: which tags it proposes for every document it reads.
let aiTagIds: string[] = [];

// A readable announcement page that states a winning bid (plain UTF-8 is enough here).
const PAGE =
  '<html><head><meta charset="utf-8"><title>ประกาศผู้ชนะ</title></head><body>' +
  '<p>ประกาศรายชื่อผู้ชนะการเสนอราคา จ้างปรับปรุงอาคารสำนักงาน โดยวิธีเฉพาะเจาะจง ตามที่หน่วยงานได้มีหนังสือเชิญชวน</p>' +
  '<p>ผู้ได้รับการคัดเลือก ได้แก่ ห้างหุ้นส่วนจำกัด ทดสอบ โดยเสนอราคาเป็นเงินทั้งสิ้น 12,345.00 บาท รวมภาษีมูลค่าเพิ่มแล้ว</p>' +
  '</body></html>';

function startServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return void res.end('<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description></channel></rss>');
    }
    if (url.pathname === '/ai/v1/chat/completions') {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const content = JSON.stringify({ description: 'สรุปโดย AI จำลอง', tagIds: aiTagIds, budget: null, newTag: null });
      return void res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    if (url.pathname === '/egp2procmainWeb/jsp/procsearch.sch') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return void res.end(PAGE);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main(): Promise<void> {
  const server = await startServer();
  const port = (server.address() as { port: number }).port;
  process.env.EGP_RSS_BASE_URL = `http://127.0.0.1:${port}/EPROCRssFeedWeb/egpannouncerss.xml`;
  process.env.AI_TAGGING_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/ai/v1`;
  const pageUrl = (id: string): string =>
    `http://127.0.0.1:${port}/egp2procmainWeb/jsp/procsearch.sch?servlet=gojsp&proc_id=ShowHTMLFile&projectId=${id}&templateType=W2&seqNo=1`;

  const { GovSite } = await import('../../src/models/govSite.model');
  const { Work } = await import('../../src/models/work.model');
  const { Tag } = await import('../../src/models/tag.model');
  const { PollJob } = await import('../../src/models/pollJob.model');
  const { IngestionRun } = await import('../../src/models/ingestionRun.model');
  const { IngestionSettings } = await import('../../src/models/ingestionSettings.model');
  const { createGovSite } = await import('../../src/services/govSite.service');
  const { runRssPoll } = await import('../../src/services/ingestion.service');
  const { listWorks, getWorkById } = await import('../../src/services/work.service');
  const { getAdminDashboard } = await import('../../src/services/adminDashboard.service');
  const { updateIngestionSettings } = await import('../../src/services/ingestionSettings.service');

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([GovSite.syncIndexes(), Work.syncIndexes(), Tag.syncIndexes(), IngestionRun.syncIndexes()]);

  const site = await createGovSite({ name: 'ทดสอบแอดมิน', shortCode: 'ADMT', deptId: '9101', announceTypes: ['W0'], requestsPerMinute: 600 });
  const tagX = await Tag.create({ name: 'หมวดที่แอดมินถอดออก', facet: 'category' });
  const tagY = await Tag.create({ name: 'หมวดที่ยังใช้ได้', facet: 'category' });

  const legacyWork = (id: string, over: Record<string, unknown> = {}) =>
    Work.create({
      siteId: site._id,
      projectId: id,
      title: `ประกาศผู้ชนะ ${id}`,
      status: 'AWARDED',
      announceType: 'W0',
      torFiles: [{ announceType: 'W0', linkType: 'html', sourceUrl: pageUrl(id) }],
      statusHistory: [{ status: 'AWARDED', announceType: 'W0', changedAt: new Date() }],
      ...over
    });

  // ===================================================================== A. the retry sweep respects manual tag removal
  aiTagIds = [tagX._id.toString(), tagY._id.toString()];
  await legacyWork('91000001', { excludedTags: [tagX._id] }); // an admin removed tag X from this work
  await legacyWork('91000002'); // control: nobody removed anything
  await runRssPoll(site, 'scheduler'); // empty feed: only the sweep runs, and it reads both pages

  const excludedOne = await Work.findOne({ projectId: '91000001' });
  const controlOne = await Work.findOne({ projectId: '91000002' });
  const has = (work: typeof excludedOne, tagId: unknown): boolean => !!work?.tags.some(t => t.equals(tagId as never));
  record(controlOne?.budget === 12345 && !!controlOne.description, 'sweep: the page was read (price and description filled in)');
  record(has(controlOne, tagX._id) && has(controlOne, tagY._id), 'sweep: the model\'s tags are added to a work nobody edited (so the next check is not vacuous)');
  record(has(excludedOne, tagY._id) && !has(excludedOne, tagX._id), 'sweep: a tag an admin removed is NOT put back; the other tag is', `tags=${excludedOne?.tags.length}`);
  record((excludedOne?.excludedTags ?? []).length === 1, 'sweep: the removal itself is kept');

  // ===================================================================== B. the admin-only field stays off the public API
  await legacyWork('91000003', { budget: 500, excludedTags: [tagX._id], torFiles: [] }); // priced
  await legacyWork('91000004', { excludedTags: [tagX._id], torFiles: [] }); // unpriced
  const exposes = (item: { toJSON(): Record<string, unknown> }): boolean => 'excludedTags' in item.toJSON();
  const bySort = async (sort: 'date' | 'budget-asc' | 'budget-desc') => (await listWorks({ sort, pageSize: 50 })).items;
  const lowToHigh = await bySort('budget-asc');
  record(lowToHigh.length >= 4 && lowToHigh.some(w => w.budget === 500) && lowToHigh.some(w => !w.budget), 'public list "budget: low to high" returns both priced and unpriced works');
  record(lowToHigh.every(w => !exposes(w)), 'public list "budget: low to high" never exposes excludedTags (priced-first path)');
  record((await bySort('date')).every(w => !exposes(w)) && (await bySort('budget-desc')).every(w => !exposes(w)), 'public list by date / budget-desc never exposes excludedTags');
  const detail = await getWorkById(String((await Work.findOne({ projectId: '91000001' }))?._id));
  record(!exposes(detail), 'public work detail never exposes excludedTags');

  // ===================================================================== C. dashboard follows the ingestion schedule rules
  const adminId = new mongoose.Types.ObjectId();
  const monthAhead = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await GovSite.updateOne({ _id: site._id }, { $set: { nextPollAt: monthAhead, enabled: true } });

  let dash = await getAdminDashboard();
  record(dash.ingestion.scheduleEnabled === true && dash.ingestion.pollIntervalMinutes === 1440, 'dashboard: reports the automatic schedule (on, every 24 h by default)', `${dash.ingestion.pollIntervalMinutes}`);
  const nextAt = dash.ingestion.nextScheduledAt?.getTime() ?? 0;
  record(nextAt > Date.now() && nextAt <= Date.now() + 24 * 3600 * 1000 + 60_000, 'dashboard: next run is pulled in to the interval (a timer 30 days out is not shown as-is)', String(dash.ingestion.nextScheduledAt));

  await updateIngestionSettings({ pollIntervalMinutes: 180 }, adminId);
  dash = await getAdminDashboard();
  const shorter = dash.ingestion.nextScheduledAt?.getTime() ?? 0;
  record(dash.ingestion.pollIntervalMinutes === 180 && shorter <= Date.now() + 180 * 60_000 + 60_000, 'dashboard: follows a changed interval (3 h)', String(dash.ingestion.nextScheduledAt));

  await updateIngestionSettings({ scheduleEnabled: false }, adminId);
  dash = await getAdminDashboard();
  record(dash.ingestion.scheduleEnabled === false && dash.ingestion.nextScheduledAt === null, 'dashboard: a paused schedule has no next run');
  await updateIngestionSettings({ scheduleEnabled: true }, adminId);

  const staleJob = await PollJob.create({ scope: 'all', source: 'both', requestedBy: 'scheduler', status: 'queued' });
  await PollJob.collection.updateOne({ _id: staleJob._id }, { $set: { createdAt: new Date(Date.now() - 2 * 3600 * 1000) } }); // nobody ever claimed it
  dash = await getAdminDashboard();
  record(dash.ingestion.queuedJobs === 0, 'dashboard: a queued job nobody claimed for over an hour is not "queued"', String(dash.ingestion.queuedJobs));
  await PollJob.create({ scope: 'all', source: 'both', requestedBy: 'scheduler', status: 'queued' });
  dash = await getAdminDashboard();
  record(dash.ingestion.queuedJobs === 1, 'dashboard: a fresh queued job is counted');

  await IngestionSettings.deleteMany({});

  // ===================================================================== report
  server.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error('check failed to run', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(2);
});
