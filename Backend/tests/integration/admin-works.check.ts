import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { Follow } from '../../src/models/follow.model';
import { GovSite } from '../../src/models/govSite.model';
import { Notification } from '../../src/models/notification.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { isTagExcluded } from '../../src/services/ingestion.service';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-works-check';

const PASSWORD = 'Password123';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
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

  async function call(method: string, path: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  }
  async function makeAccount(email: string, role: AccountRole) {
    return Account.create({ email, passwordHash: PASSWORD, name: email, type: 'individual', status: 'active', role });
  }
  async function loginCookie(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    const first = res.setCookie?.split(';')[0] ?? '';
    if (!first.startsWith(`${SESSION_COOKIE_NAME}=`)) throw new Error(`login failed for ${email}`);
    return first;
  }

  const vendor = await makeAccount('vendor@example.com', 'user');
  await makeAccount('admin@example.com', 'admin');
  const vendorCookie = await loginCookie('vendor@example.com');
  const adminCookie = await loginCookie('admin@example.com');

  // ---------------------------------------------------------------- fixtures
  const siteA = await GovSite.create({ name: 'Site A', shortCode: 'AAA', deptId: '1' });
  const siteB = await GovSite.create({ name: 'Site B', shortCode: 'BBB', deptId: '2' });
  const siteTagA = await Tag.create({ name: 'Site A', facet: 'site', siteId: siteA._id });
  const siteTagB = await Tag.create({ name: 'Site B', facet: 'site', siteId: siteB._id });
  const tagA = await Tag.create({ name: 'Roads', facet: 'category' });
  const tagB = await Tag.create({ name: 'Bridges', facet: 'category' });
  const tagC = await Tag.create({ name: 'Lighting', facet: 'keyword' });
  const tagRetired = await Tag.create({ name: 'Old topic', facet: 'keyword', retired: true });
  const tagSoftware = await Tag.create({ name: 'Software', facet: 'category', includeInIngestionFilter: true });

  const mkWork = (projectId: string, title: string, site: typeof siteA, tags: unknown[], extra: Record<string, unknown> = {}) =>
    Work.create({
      siteId: site._id,
      projectId,
      title,
      status: 'BIDDING',
      announceType: 'B0',
      statusHistory: [{ status: 'BIDDING', announceType: 'B0' }],
      tags,
      ...extra
    });

  const w1 = await mkWork('P-1001', 'Repair road lighting', siteA, [siteTagA._id, tagA._id]);
  const w2 = await mkWork('P-1002', 'Bridge inspection service', siteB, [siteTagB._id, tagB._id]);
  const w3 = await mkWork('P-1003', 'Hidden cleaning contract', siteA, [siteTagA._id], { ingestionRelevance: 'not-related' });
  const w1Id = w1._id.toString();
  const tid = (t: { _id: unknown }) => String(t._id);

  // ------------------------------------------------------------------ access
  record((await call('GET', '/admin/works')).status === 401, 'visitor gets 401 on GET /admin/works');
  record((await call('GET', '/admin/works', vendorCookie)).status === 403, 'vendor gets 403 on GET /admin/works');
  record((await call('GET', `/admin/works/${w1Id}`, vendorCookie)).status === 403, 'vendor gets 403 on GET /admin/works/:id');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, vendorCookie, { tagIds: [] })).status === 403, 'vendor gets 403 on PUT /admin/works/:id/tags');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, undefined, { tagIds: [] })).status === 401, 'visitor gets 401 on PUT /admin/works/:id/tags');

  // -------------------------------------------------------------------- list
  const all = await call('GET', '/admin/works', adminCookie);
  record(all.status === 200 && all.json.data.total === 3 && all.json.data.items.length === 3, 'admin lists ALL works, including one hidden from the public', String(all.json?.data?.total));
  const first = all.json.data.items.find((w: any) => w.projectId === 'P-1001');
  record(
    first?.siteId?.shortCode === 'AAA' && first.tags.some((t: any) => t.name === 'Roads' && t.facet === 'category'),
    'list items carry the site and populated tags (name/facet)'
  );
  record(!JSON.stringify(all.json).includes('excludedTags'), 'list does not expose the internal excludedTags field');
  record((await call('GET', '/admin/works?q=bridge', adminCookie)).json.data.total === 1, 'search by title (case-insensitive)');
  record((await call('GET', '/admin/works?q=P-1003', adminCookie)).json.data.total === 1, 'search by project id');
  record((await call('GET', '/admin/works?q=(', adminCookie)).status === 200, 'regex characters in search do not break it');
  record((await call('GET', `/admin/works?siteId=${siteA._id}`, adminCookie)).json.data.total === 2, 'filter by site');
  record((await call('GET', `/admin/works?tag=${tid(tagB)}`, adminCookie)).json.data.total === 1, 'filter by tag');
  record((await call('GET', '/admin/works?visibility=hidden', adminCookie)).json.data.items.map((w: any) => w.projectId).join() === 'P-1003', 'filter: hidden works only');
  record((await call('GET', '/admin/works?visibility=visible', adminCookie)).json.data.total === 2, 'filter: visible works only');
  const paged = await call('GET', '/admin/works?pageSize=2&page=2', adminCookie);
  record(paged.json.data.items.length === 1 && paged.json.data.total === 3, 'pagination works');
  record((await call('GET', '/admin/works?pageSize=500', adminCookie)).status === 400, 'page size is capped (400 above 50)');
  record((await call('GET', '/admin/works?siteId=nope', adminCookie)).status === 400, 'an invalid site id is rejected');

  // ------------------------------------------------------- public vs admin
  const publicHidden = await call('GET', `/works/${w3._id}`);
  const adminHidden = await call('GET', `/admin/works/${w3._id}`, adminCookie);
  record(publicHidden.status === 404 && adminHidden.status === 200, 'a hidden work is 404 publicly but readable by an admin');
  const publicVisible = await call('GET', `/works/${w1Id}`);
  record(publicVisible.status === 200 && !JSON.stringify(publicVisible.json).includes('excludedTags'), 'public work responses never include excludedTags');
  const one = await call('GET', `/admin/works/${w1Id}`, adminCookie);
  record(one.json.data.work.tags.length === 2 && one.json.data.ingestionFilter.active === false, 'admin work detail: tags populated, ingestion filter reported inactive');
  record((await call('GET', '/admin/works/000000000000000000000000', adminCookie)).status === 404, 'unknown work id -> 404');
  record((await call('GET', '/admin/works/not-an-id', adminCookie)).status === 404, 'malformed work id -> 404');

  // -------------------------------------------------------------- set tags
  const put1 = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(siteTagA), tid(tagB), tid(tagC)] });
  const added1 = put1.json?.data?.added?.map((t: any) => t.name).sort().join();
  const removed1 = put1.json?.data?.removed?.map((t: any) => t.name).join();
  record(put1.status === 200 && added1 === 'Bridges,Lighting' && removed1 === 'Roads', 'PUT tags returns an accurate added/removed diff', `${added1} | ${removed1}`);
  let dbW1 = await Work.findById(w1Id);
  record(
    dbW1!.tags.map(String).sort().join() === [tid(siteTagA), tid(tagB), tid(tagC)].sort().join(),
    'the new tag set is persisted (site tag kept, Roads gone, Bridges + Lighting added)'
  );
  record(dbW1!.excludedTags.map(String).join() === tid(tagA), 'the removed tag is remembered in excludedTags');
  record(put1.json.data.work.tags.some((t: any) => t.name === 'Bridges'), 'the response returns the updated, populated work');

  // Search facets follow the change immediately.
  const facetB = await call('GET', `/works?tag=${tid(tagB)}`);
  record(facetB.json.data.items.some((w: any) => w._id === w1Id), 'public search by the added tag now finds the work');
  const facetA = await call('GET', `/works?tag=${tid(tagA)}`);
  record(!facetA.json.data.items.some((w: any) => w._id === w1Id), 'public search by the removed tag no longer finds it');

  // Ingestion must respect the manual removal.
  record(isTagExcluded(dbW1!, tagA._id) === true && isTagExcluded(dbW1!, tagB._id) === false, 'ingestion helper: a manually removed tag is excluded from auto-tagging, others are not');

  // Site tag is fixed.
  const putNoSite = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagB)] });
  dbW1 = await Work.findById(w1Id);
  record(putNoSite.status === 200 && dbW1!.tags.map(String).includes(tid(siteTagA)), 'omitting the site tag does NOT remove it (a work always keeps its site tag)');
  record(putNoSite.json.data.removed.map((t: any) => t.name).join() === 'Lighting', 'the diff does not report the site tag as removed', putNoSite.json.data.removed.map((t: any) => t.name).join());
  const putOtherSite = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(siteTagB)] });
  record(putOtherSite.status === 400 && !!putOtherSite.json.error.fields?.tagIds, 'adding a DIFFERENT site\'s tag is rejected', JSON.stringify(putOtherSite.json?.error?.fields));

  // Re-adding clears the exclusion.
  await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagA), tid(tagB)] });
  dbW1 = await Work.findById(w1Id);
  record(!dbW1!.excludedTags.map(String).includes(tid(tagA)) && dbW1!.tags.map(String).includes(tid(tagA)), 're-adding a removed tag takes it off the excluded list');
  record(dbW1!.excludedTags.map(String).includes(tid(tagC)), 'a tag removed in an earlier save stays excluded');

  // Validation.
  const retiredAdd = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagA), tid(tagRetired)] });
  record(retiredAdd.status === 400 && !!retiredAdd.json.error.fields?.tagIds, 'a retired tag cannot be newly added', JSON.stringify(retiredAdd.json?.error?.fields));
  record((await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: ['000000000000000000000000'] })).status === 400, 'an unknown tag id is rejected');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: ['xyz'] })).status === 400, 'a malformed tag id is rejected');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, {})).status === 400, 'a missing tagIds field is rejected');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [], extra: 1 })).status === 400, 'unknown body fields are rejected');
  const many = Array.from({ length: 51 }, () => '000000000000000000000000');
  record((await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: many })).status === 400, 'more than 50 tags is rejected');
  record((await call('PUT', '/admin/works/000000000000000000000000/tags', adminCookie, { tagIds: [] })).status === 404, 'PUT on an unknown work -> 404');
  const dupes = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagA), tid(tagA), tid(tagA).toUpperCase()] });
  dbW1 = await Work.findById(w1Id);
  record(dupes.status === 200 && dbW1!.tags.filter(t => t.equals(tagA._id)).length === 1, 'duplicate ids in the request collapse to one tag');
  const unchanged = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: dbW1!.tags.map(String) });
  record(unchanged.status === 200 && unchanged.json.data.added.length === 0 && unchanged.json.data.removed.length === 0, 'saving an unchanged set is a clean no-op');
  const cleared = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [] });
  dbW1 = await Work.findById(w1Id);
  record(cleared.status === 200 && dbW1!.tags.map(String).join() === tid(siteTagA), 'an empty list removes every editable tag but keeps the site tag');

  // A retired tag ALREADY on the work may stay (retiring never strips links) or be removed.
  await Work.updateOne({ _id: w1Id }, { $set: { tags: [siteTagA._id, tagRetired._id] } });
  const keepRetired = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagRetired), tid(tagB)] });
  record(keepRetired.status === 200 && keepRetired.json.data.work.tags.some((t: any) => t.name === 'Old topic' && t.retired === true), 'a retired tag already on the work can be kept');
  const dropRetired = await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagB)] });
  record(dropRetired.status === 200 && dropRetired.json.data.removed.some((t: any) => t.name === 'Old topic'), 'a retired tag on the work can be removed');

  // ------------------------------------------------------------ notifications
  await Follow.create({ accountId: vendor._id, tagId: tagC._id });
  await call('PUT', `/admin/works/${w1Id}/tags`, adminCookie, { tagIds: [tid(tagB), tid(tagC)] });
  await new Promise(r => setTimeout(r, 300));
  record((await Notification.countDocuments({})) === 0, 'adding a tag a user follows sends NO notification (a manual fix is not a "new work" event)');

  // ----------------------------------------------- topic filter (relevance)
  record(dbW1 !== null && (await Work.findById(w1Id))!.ingestionRelevance === undefined, 'filter OFF: relevance is left untouched (unset)');

  (env as { INGESTION_TOPIC_FILTER_ENABLED: boolean }).INGESTION_TOPIC_FILTER_ENABLED = true;
  const w3Id = w3._id.toString();
  const detail = await call('GET', `/admin/works/${w3Id}`, adminCookie);
  record(detail.json.data.ingestionFilter.active === true && detail.json.data.ingestionFilter.inScopeTagIds.join() === tid(tagSoftware), 'filter ON: the detail reports the in-scope tag ids so the UI can warn first');
  const unhide = await call('PUT', `/admin/works/${w3Id}/tags`, adminCookie, { tagIds: [tid(tagSoftware)] });
  record(unhide.json.data.relevance.from === 'not-related' && unhide.json.data.relevance.to === 'shown', 'adding an in-scope tag flips a hidden work to "shown"', JSON.stringify(unhide.json.data.relevance));
  record((await call('GET', `/works/${w3Id}`)).status === 200, '...and the work is now visible on the public site');
  const rehide = await call('PUT', `/admin/works/${w3Id}/tags`, adminCookie, { tagIds: [] });
  record(rehide.json.data.relevance.to === 'not-related', 'removing the last in-scope tag hides the work again');
  record((await call('GET', `/works/${w3Id}`)).status === 404 && (await call('GET', `/admin/works/${w3Id}`, adminCookie)).status === 200, '...it is gone publicly but the admin can still open it to fix it');
  (env as { INGESTION_TOPIC_FILTER_ENABLED: boolean }).INGESTION_TOPIC_FILTER_ENABLED = false;

  // ------------------------------------------------------------ other data
  const w2After = await Work.findById(w2._id);
  record(w2After!.tags.length === 2, 'other works are never touched by an edit');

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
