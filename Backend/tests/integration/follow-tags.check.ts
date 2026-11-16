// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import http from 'http';
import mongoose, { Types } from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { Follow } from '../../src/models/follow.model';
import { AnnounceType, GovSite, IGovSite } from '../../src/models/govSite.model';
import { Notification } from '../../src/models/notification.model';
import { Session } from '../../src/models/session.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { createGovSite } from '../../src/services/govSite.service';
import { runRssPoll } from '../../src/services/ingestion.service';
import { notifyNewWorkMatches } from '../../src/services/notification.service';
import { createSession } from '../../src/services/session.service';
import { startFakeSmtp } from '../helpers/fakeSmtp';

// Follow Interest Tag (Use Case 6.2.5; SRS US-3.1, US-3.4, FR-3.1, FR-3.3, FR-3.6,
// FR-3.7, FR-1.4). The /follows API: follow, unfollow, pause and resume a tag,
// who may call it, whose follows a caller can see, and what a follow (or a paused
// follow) actually does to the notifications that come out of a poll (Use Case
// 6.2.6). Uses its own throwaway database (dropped at the start and end), local
// mock e-GP and SMTP servers -- never the dev database, never a real mailbox.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-follow-check';

// Nothing real may be called: no mail (until the fake SMTP below), no AI, no HTML pages.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;
(env as { AI_TAGGING_ENABLED: boolean }).AI_TAGGING_ENABLED = false;
(env as { EGP_HTML_TOR_ENABLED: boolean }).EGP_HTML_TOR_ENABLED = false;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ----------------------------------------------------------------- the mock e-GP feed
interface FeedItem { id: string; title: string; at: string }
const feeds: Record<string, Partial<Record<AnnounceType, FeedItem[]>>> = {};
let origin = '';

const mock = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
    const type = url.searchParams.get('anounceType') as AnnounceType;
    const items = (feeds[url.searchParams.get('deptId') ?? '']?.[type] ?? [])
      .map(
        i =>
          `<item><title>${i.title}</title><link>${origin}/doc/${i.id}/${type}</link>` +
          `<description>${i.id}, ${i.title}</description><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`
      )
      .join('');
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return void res.end(`<?xml version="1.0" encoding="windows-874"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>${items}</channel></rss>`);
  }
  res.writeHead(404);
  res.end();
});

interface Res { status: number; json: any; text: string }

async function main(): Promise<void> {
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  (env as { EGP_RSS_BASE_URL: string }).EGP_RSS_BASE_URL = `${origin}/EPROCRssFeedWeb/egpannouncerss.xml`;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Follow.init(), Tag.init(), GovSite.init(), Account.init(), Work.init(), Notification.init()]);

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, opts: { cookie?: string; body?: unknown; raw?: string } = {}): Promise<Res> {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  const code = (r: Res) => r.json?.error?.code;
  const ids = (r: Res) => ((r.json?.data ?? []) as { _id: string }[]).map(t => t._id).sort();
  const sorted = (list: Types.ObjectId[] | string[]) => list.map(String).sort();

  // ---------------------------------------------------------------- the people
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const cookieFor = async (a: { _id: unknown }) => `${SESSION_COOKIE_NAME}=${(await createSession(a._id as never, {})).rawToken}`;
  const alice = await mk('alice@example.com', 'user');
  const bob = await mk('bob@example.com', 'user');
  const carol = await mk('carol@example.com', 'user');
  const superAdmin = await mk('super@example.com', 'superadmin');
  const tagAdmin = await mk('tagadmin@example.com', 'admin', { permissions: ['tag:manage'] });
  const pollAdmin = await mk('polladmin@example.com', 'admin', { permissions: ['poll:manage'] });
  const aliceC = await cookieFor(alice);
  const bobC = await cookieFor(bob);
  const carolC = await cookieFor(carol);
  const superC = await cookieFor(superAdmin);
  const tagAdminC = await cookieFor(tagAdmin);
  const pollAdminC = await cookieFor(pollAdmin);

  // ---------------------------------------------------------------- the tags, one of every facet
  const site = await createGovSite({ name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOHF', deptId: '8101' });
  const siteTag = (await Tag.findOne({ facet: 'site', siteId: site._id }))!;
  const agency = await Tag.create({ name: 'แขวงทางหลวงที่ 1', facet: 'agency' });
  const method = await Tag.create({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method' });
  const category = await Tag.create({ name: 'งานก่อสร้าง', facet: 'category' });
  const keyword = await Tag.create({ name: 'ซอฟต์แวร์', facet: 'keyword' });
  const retiredTag = await Tag.create({ name: 'แท็กที่เลิกใช้แล้ว', facet: 'keyword', retired: true });
  const allFacets = [siteTag, agency, method, category, keyword];
  const T = (t: { _id: unknown }) => String(t._id);
  const url = (t: { _id: unknown } | string) => `/follows/tags/${typeof t === 'string' ? t : T(t)}`;
  const follows = (a: { _id: unknown }) => Follow.find({ accountId: a._id as never }).lean();
  const GHOST = '0123456789abcdef01234567'; // a well-formed id that belongs to no tag

  // ============================================================ 1. who may call it (FR-1.4, US-1.3)
  const calls: [string, string, unknown][] = [
    ['GET', '/follows/tags', undefined],
    ['POST', url(category), undefined],
    ['DELETE', url(category), undefined],
    ['PATCH', `${url(category)}/pause`, { paused: true }],
    ['GET', `${url(category)}/followers`, undefined]
  ];
  let anonOk = 0;
  const anonBad: string[] = [];
  for (const [method_, p, body] of calls) {
    const r = await call(method_, p, { body });
    if (r.status === 401 && code(r) === 'NOT_AUTHENTICATED') anonOk += 1;
    else anonBad.push(`${method_} ${p} -> ${r.status}`);
  }
  record(anonOk === calls.length && (await Follow.countDocuments()) === 0, 'anonymous: all 5 follow endpoints answer 401 NOT_AUTHENTICATED and nothing is created', anonBad.join(' | '));
  const anonMalformed = await call('POST', url('not-an-id'));
  record(anonMalformed.status === 401, 'anonymous: sign-in is checked before the id (a malformed id is still 401, not 400)', String(anonMalformed.status));
  const garbage = await call('GET', '/follows/tags', { cookie: `${SESSION_COOKIE_NAME}=not-a-real-session-token` });
  record(garbage.status === 401 && code(garbage) === 'NOT_AUTHENTICATED', 'a made-up session cookie is 401');
  const empty = await call('GET', '/follows/tags', { cookie: `${SESSION_COOKIE_NAME}=` });
  record(empty.status === 401, 'an empty session cookie is 401');

  // a session that has been signed out, or has expired, no longer works
  const gone = await createSession(carol._id as never, {});
  const goneC = `${SESSION_COOKIE_NAME}=${gone.rawToken}`;
  record((await call('GET', '/follows/tags', { cookie: goneC })).status === 200, 'a fresh session works');
  await call('POST', '/auth/logout', { cookie: goneC });
  const afterLogout = await call('POST', url(category), { cookie: goneC });
  record(afterLogout.status === 401 && (await follows(carol)).length === 0, 'after logout, the old session cookie can no longer follow a tag');
  const old = await createSession(carol._id as never, {});
  await Session.updateOne({ _id: old.session._id }, { expiresAt: new Date(Date.now() - 1000) });
  const afterExpiry = await call('POST', url(category), { cookie: `${SESSION_COOKIE_NAME}=${old.rawToken}` });
  record(afterExpiry.status === 401 && (await follows(carol)).length === 0, 'an expired session cannot follow a tag');

  // ============================================================ 2. follow (US-3.1, FR-3.1)
  const firstFollow = await call('POST', url(category), { cookie: aliceC });
  record(
    firstFollow.status === 200 && firstFollow.json?.success === true && firstFollow.json.data?.tagId === T(category) && firstFollow.json.data?.accountId === String(alice._id) && firstFollow.json.data?.paused === false,
    'follow: a registered user follows a tag and gets back the follow (own account, that tag, not paused)',
    firstFollow.text.slice(0, 160)
  );
  record((await follows(alice)).length === 1, 'follow: exactly one follow is stored');
  for (const tag of allFacets) {
    const r = await call('POST', url(tag), { cookie: aliceC });
    if (r.status !== 200) record(false, `follow: a ${tag.facet} tag can be followed`, `${r.status} ${r.text.slice(0, 120)}`);
  }
  record(sorted((await follows(alice)).map(f => f.tagId)).join() === sorted(allFacets.map(t => t._id)).join(), 'follow: tags of every facet (site, agency, method, category, keyword) can be followed together');
  const list = await call('GET', '/follows/tags', { cookie: aliceC });
  const expectedOrder = [...allFacets].sort((a, b) => (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(T);
  record(list.status === 200 && ((list.json?.data ?? []) as { _id: string }[]).map(t => t._id).join() === expectedOrder.join(), 'list: GET /follows/tags returns the followed tags, grouped by facet and then by name', (list.json?.data ?? []).map((t: { name: string }) => t.name).join(' | '));
  const first = ((list.json?.data ?? []) as Record<string, unknown>[])[0] ?? {};
  record(typeof first.name === 'string' && typeof first.facet === 'string' && first.retired === false, 'list: each entry is the tag itself (name, facet, not retired)');
  const listText = JSON.stringify(list.json);
  record(!/passwordHash|accountId|"email"|alice@example/.test(listText), 'list: the response carries no account data');

  // already followed: the API call is a no-op (the website's button turns it into an unfollow)
  const before = (await follows(alice)).find(f => String(f.tagId) === T(category))!;
  const again = await call('POST', url(category), { cookie: aliceC });
  const afterAgain = (await follows(alice)).filter(f => String(f.tagId) === T(category));
  record(again.status === 200 && afterAgain.length === 1 && String(afterAgain[0]._id) === String(before._id) && afterAgain[0].createdAt.getTime() === before.createdAt.getTime(), 'follow: following an already-followed tag changes nothing (still one follow, same record)', again.text.slice(0, 120));
  record((await follows(alice)).length === 5, 'follow: ...and it never adds a second copy');

  // a double click, a retry, two tabs: many identical requests at once
  const race = await Promise.all(Array.from({ length: 25 }, () => call('POST', url(keyword), { cookie: bobC })));
  const raceFail = race.filter(r => r.status !== 200);
  record(raceFail.length === 0 && (await follows(bob)).filter(f => String(f.tagId) === T(keyword)).length === 1, '25 simultaneous follows of the same tag all succeed and leave exactly one follow', raceFail.slice(0, 2).map(r => `${r.status} ${r.text.slice(0, 100)}`).join(' | '));
  const raceUnfollow = await Promise.all(Array.from({ length: 25 }, () => call('DELETE', url(keyword), { cookie: bobC })));
  record(raceUnfollow.every(r => r.status === 200) && (await follows(bob)).length === 0, '25 simultaneous unfollows all succeed and leave no follow');
  const mixed = await Promise.all(Array.from({ length: 30 }, (_, i) => call(i % 2 ? 'DELETE' : 'POST', url(keyword), { cookie: bobC })));
  const mixedFail = mixed.filter(r => r.status !== 200);
  record(mixedFail.length === 0 && (await follows(bob)).length <= 1, 'follows and unfollows racing each other never fail and never leave a duplicate', mixedFail.slice(0, 2).map(r => `${r.status} ${r.text.slice(0, 100)}`).join(' | '));
  await Follow.deleteMany({ accountId: bob._id });

  // the tag must exist and be live
  const unknown = await call('POST', url(GHOST), { cookie: aliceC });
  record(unknown.status === 404 && code(unknown) === 'NOT_FOUND', 'follow: a well-formed id that is no tag is 404', `${unknown.status} ${code(unknown)}`);
  const retiredTry = await call('POST', url(retiredTag), { cookie: aliceC });
  record(retiredTry.status === 404 && code(retiredTry) === 'NOT_FOUND', 'follow: a retired tag cannot be followed (404)', `${retiredTry.status} ${code(retiredTry)}`);
  record((await follows(alice)).length === 5, 'follow: ...and neither created a follow');

  // malformed ids are a mistake in the request, not a missing tag
  const badIds = ['abc', '123', 'null', 'undefined', 'z'.repeat(24), '0123456789abcdef0123456', '0123456789abcdef012345678', '0123456789abcdef0123456g', '%24ne', '%7B%22%24ne%22%3Anull%7D', '..%2F..%2Fadmin', '%20', '0123456789abcdef01234567%20', '%00', '1e100', '-1', '0x1234567890abcdef12345678'];
  const badIdFails: string[] = [];
  for (const id of badIds) {
    for (const [m, suffix, body] of [['POST', '', undefined], ['DELETE', '', undefined], ['PATCH', '/pause', { paused: true }]] as [string, string, unknown][]) {
      const r = await call(m, `/follows/tags/${id}${suffix}`, { cookie: aliceC, body });
      if (r.status !== 400 || code(r) !== 'VALIDATION_ERROR') badIdFails.push(`${m} ${id}${suffix} -> ${r.status}`);
    }
  }
  record(badIdFails.length === 0, `ids: ${badIds.length} malformed tag ids are 400 VALIDATION_ERROR on follow, unfollow and pause (never a 404 or 500)`, badIdFails.slice(0, 4).join(' | '));
  const badAdmin = await call('GET', '/follows/tags/nope/followers', { cookie: superC });
  record(badAdmin.status === 400, 'ids: a malformed id on the followers endpoint is 400');
  record((await follows(alice)).length === 5, 'ids: none of those requests changed anything');

  // a body or query naming somebody else is ignored: the caller is the session's account, always
  await call('POST', `${url(agency)}?accountId=${bob._id}`, { cookie: carolC, body: { accountId: String(bob._id), paused: true } });
  record((await follows(bob)).length === 0 && (await follows(carol)).length === 1 && (await follows(carol))[0].paused === false, 'follow: an accountId in the body or query is ignored (it follows for the caller only, unpaused)');
  await Follow.deleteMany({ accountId: carol._id });
  const oddMethods = [['PUT', url(category)], ['PATCH', url(category)], ['GET', url(category)], ['POST', `${url(category)}/pause`], ['PUT', `${url(category)}/pause`], ['DELETE', '/follows/tags'], ['POST', '/follows/tags'], ['GET', '/follows']];
  const oddBad: string[] = [];
  for (const [m, p] of oddMethods) {
    const r = await call(m, p, { cookie: aliceC, body: m === 'GET' ? undefined : {} });
    if (r.status !== 404 && r.status !== 400) oddBad.push(`${m} ${p} -> ${r.status}`);
  }
  record(oddBad.length === 0 && (await follows(alice)).length === 5, 'routes: a method or path the API does not have is a clean 404/400 and changes nothing', oddBad.join(' | '));
  const brokenJson = await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, raw: '{"paused": tru' });
  record(brokenJson.status === 400, 'pause: a broken JSON body is 400, not a 500', String(brokenJson.status));

  // ============================================================ 3. unfollow (US-3.4)
  const unf = await call('DELETE', url(category), { cookie: aliceC });
  record(unf.status === 200 && unf.json?.data?.unfollowed === true, 'unfollow: removes the follow (200 unfollowed)');
  record((await follows(alice)).length === 4 && !ids(await call('GET', '/follows/tags', { cookie: aliceC })).includes(T(category)), 'unfollow: the tag is gone from the list and from the database; the other four stay');
  const unfAgain = await call('DELETE', url(category), { cookie: aliceC });
  record(unfAgain.status === 200 && (await follows(alice)).length === 4, 'unfollow: unfollowing again is harmless (200, nothing else touched)');
  const neverFollowed = await call('DELETE', url(retiredTag), { cookie: aliceC });
  record(neverFollowed.status === 200, 'unfollow: a tag the user never followed is 200 too');
  const unfUnknown = await call('DELETE', url(GHOST), { cookie: aliceC });
  record(unfUnknown.status === 404 && code(unfUnknown) === 'NOT_FOUND', 'unfollow: a well-formed id that is no tag is 404', `${unfUnknown.status}`);
  const refollow = await call('POST', url(category), { cookie: aliceC });
  record(refollow.status === 200 && (await follows(alice)).length === 5, 'unfollow: the tag can be followed again afterwards');

  // ============================================================ 4. pause and resume (FR-3.7, FR-3.3)
  const settings = async (cookie: string) => ((await call('GET', '/account/notification-settings', { cookie })).json?.data?.pausedTagIds ?? ['<no answer>']) as string[];
  const p1 = await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(p1.status === 200 && p1.json?.data?.paused === true && p1.json.data.tagId === T(category), 'pause: PATCH {paused:true} pauses the follow');
  const storedPaused = (await follows(alice)).find(f => String(f.tagId) === T(category));
  record(storedPaused?.paused === true && (await follows(alice)).filter(f => f.paused).length === 1, 'pause: stored on that one follow only');
  record(ids(await call('GET', '/follows/tags', { cookie: aliceC })).includes(T(category)), 'pause: a paused tag is still a followed tag (still in the list)');
  record(JSON.stringify(await settings(aliceC)) === JSON.stringify([T(category)]), 'pause: the notification settings list it as paused');
  const p2 = await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(p2.status === 200 && p2.json?.data?.paused === true, 'pause: pausing twice is harmless');
  const reFollowPaused = await call('POST', url(category), { cookie: aliceC });
  record(reFollowPaused.status === 200 && (await follows(alice)).find(f => String(f.tagId) === T(category))?.paused === true, 'pause: following a paused tag again does not quietly un-pause it');
  const r1 = await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, body: { paused: false } });
  record(r1.status === 200 && r1.json?.data?.paused === false && (await settings(aliceC)).length === 0, 'resume: PATCH {paused:false} resumes it');
  record((await follows(alice)).every(f => !f.paused), 'resume: no follow is left paused');
  const notFollowing = await call('PATCH', `${url(retiredTag)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(notFollowing.status === 404 && code(notFollowing) === 'NOT_FOUND', 'pause: a tag the user does not follow is 404');
  const pauseGhost = await call('PATCH', `${url(GHOST)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(pauseGhost.status === 404, 'pause: a tag that does not exist is 404');
  await call('DELETE', url(agency), { cookie: aliceC });
  const pauseUnfollowed = await call('PATCH', `${url(agency)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(pauseUnfollowed.status === 404 && (await Follow.countDocuments({ accountId: alice._id, tagId: agency._id })) === 0, 'pause: it cannot be used to follow a tag (an unfollowed tag stays unfollowed)');
  await call('POST', url(agency), { cookie: aliceC });
  const badBodies: [string, unknown][] = [
    ['no body', undefined], ['empty object', {}], ['"true" as a string', { paused: 'true' }], ['1', { paused: 1 }], ['0', { paused: 0 }], ['null', { paused: null }],
    ['an array', { paused: [true] }], ['an object', { paused: { $ne: false } }], ['a list as the body', [true]], ['a bare true', true],
    ['an extra field accountId', { paused: true, accountId: String(bob._id) }], ['an extra field tagId', { paused: true, tagId: T(keyword) }], ['a $set', { $set: { paused: true } }]
  ];
  const badBodyFails: string[] = [];
  for (const [label, body] of badBodies) {
    const r = await call('PATCH', `${url(agency)}/pause`, { cookie: aliceC, body });
    // a bare true / a list: the JSON parser or the schema refuses it -- either way 400, never a change
    if (r.status !== 400 || !['VALIDATION_ERROR', 'BAD_REQUEST'].includes(code(r))) badBodyFails.push(`${label} -> ${r.status} ${code(r)}`);
  }
  record(badBodyFails.length === 0 && (await follows(alice)).every(f => !f.paused), `pause: ${badBodies.length} wrong bodies are all 400 and change nothing`, badBodyFails.join(' | '));
  // pause, unfollow, follow again: the new follow starts fresh
  await call('PATCH', `${url(agency)}/pause`, { cookie: aliceC, body: { paused: true } });
  await call('DELETE', url(agency), { cookie: aliceC });
  await call('POST', url(agency), { cookie: aliceC });
  record((await follows(alice)).find(f => String(f.tagId) === T(agency))?.paused === false, 'pause: unfollowing a paused tag and following it again starts a fresh, un-paused follow');

  // ============================================================ 5. one user cannot see or change another's follows (US-1.3)
  await call('POST', url(category), { cookie: bobC });
  await call('POST', url(keyword), { cookie: bobC });
  await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, body: { paused: true } });
  const aliceList = ids(await call('GET', '/follows/tags', { cookie: aliceC }));
  const bobList = ids(await call('GET', '/follows/tags', { cookie: bobC }));
  record(aliceList.join() === sorted(allFacets.map(t => t._id)).join() && bobList.join() === sorted([category._id, keyword._id]).join(), 'isolation: each user lists only their own follows (alice 5, bob 2)', `${aliceList.length} / ${bobList.length}`);
  const peek = await call('GET', `/follows/tags?accountId=${alice._id}&userId=${alice._id}`, { cookie: bobC });
  record(ids(peek).join() === bobList.join(), 'isolation: asking for another account by query still lists only the caller\'s follows');
  record((await call('GET', '/follows/tags', { cookie: carolC })).json?.data?.length === 0, 'isolation: a user with no follows sees an empty list, not somebody else\'s');
  // bob pauses the tag both follow; alice's pause state is hers alone
  await call('PATCH', `${url(keyword)}/pause`, { cookie: bobC, body: { paused: true } });
  const alicePausedAfter = (await follows(alice)).filter(f => f.paused).map(f => String(f.tagId));
  record(JSON.stringify(alicePausedAfter) === JSON.stringify([T(category)]), 'isolation: bob pausing a tag does not pause it for alice (and her own pause is untouched)');
  await call('PATCH', `${url(keyword)}/pause`, { cookie: bobC, body: { paused: false } });
  // bob tries to unfollow / pause a tag only alice follows
  const sneakDelete = await call('DELETE', url(agency), { cookie: bobC });
  record(sneakDelete.status === 200 && (await Follow.countDocuments({ accountId: alice._id, tagId: agency._id })) === 1, 'isolation: bob unfollowing a tag only alice follows leaves alice\'s follow alone');
  const sneakPause = await call('PATCH', `${url(agency)}/pause`, { cookie: bobC, body: { paused: true } });
  record(sneakPause.status === 404 && (await follows(alice)).find(f => String(f.tagId) === T(agency))?.paused === false, 'isolation: bob cannot pause alice\'s follow (404, hers unchanged)');
  record((await follows(bob)).length === 2 && (await follows(alice)).length === 5, 'isolation: the follows of both are intact after all that');
  const mySettings = await settings(bobC);
  record(mySettings.length === 0 && (await settings(aliceC)).join() === T(category), 'isolation: each user\'s notification settings list only their own paused tags');
  // staff see only their own follows too
  await call('POST', url(method), { cookie: tagAdminC });
  const adminList = ids(await call('GET', '/follows/tags', { cookie: superC }));
  const tagAdminList = ids(await call('GET', '/follows/tags', { cookie: tagAdminC }));
  record(adminList.length === 0 && tagAdminList.join() === T(method), 'isolation: an Admin lists only their own follows as well (not every user\'s)');
  await Follow.deleteMany({ accountId: tagAdmin._id });
  await call('PATCH', `${url(category)}/pause`, { cookie: aliceC, body: { paused: false } });

  // followers of a tag: Admin-only view
  const fAnon = await call('GET', `${url(category)}/followers`);
  const fUser = await call('GET', `${url(category)}/followers`, { cookie: aliceC });
  record(fAnon.status === 401 && fUser.status === 403 && code(fUser) === 'FORBIDDEN', 'followers: anonymous 401, a vendor 403');
  const fSuper = await call('GET', `${url(category)}/followers`, { cookie: superC });
  const fTag = await call('GET', `${url(category)}/followers`, { cookie: tagAdminC });
  const fPoll = await call('GET', `${url(category)}/followers`, { cookie: pollAdminC });
  const followerEmails = ((fSuper.json?.data ?? []) as { email: string }[]).map(a => a.email).sort();
  record(fSuper.status === 200 && fTag.status === 200 && fPoll.status === 200 && followerEmails.join() === 'alice@example.com,bob@example.com', 'followers: an Admin (any admin role) sees the accounts following the tag', followerEmails.join());
  const fText = JSON.stringify(fSuper.json);
  record(!/passwordHash|\$2[aby]\$|lockedUntil|failedLoginCount|lastFailedLoginAt|passwordChangedAt|tokenHash/.test(fText), 'followers: no password hash or lockout field is in the response');
  record((await call('GET', `${url(GHOST)}/followers`, { cookie: superC })).status === 404, 'followers: a tag that does not exist is 404');

  // ============================================================ 6. a suspended account is shut out
  const dave = await mk('dave@example.com', 'user');
  const daveC = await cookieFor(dave);
  await call('POST', url(siteTag), { cookie: daveC });
  // The Admin's Suspend signs the account out everywhere, so the old session stops working at once...
  const susp = await call('PATCH', `/admin/accounts/${dave._id}/suspend`, { cookie: superC });
  const afterSuspend = await call('POST', url(category), { cookie: daveC });
  record(susp.status === 200 && afterSuspend.status === 401 && (await follows(dave)).length === 1, 'suspend: the Admin\'s suspension ends the account\'s sessions (the old cookie is 401) and changes none of its follows', `${susp.status} ${afterSuspend.status}`);
  await call('PATCH', `/admin/accounts/${dave._id}/reactivate`, { cookie: superC });
  // ...and if a session did survive (a race, or an account suspended by hand), the follow endpoints still refuse it
  const daveC2 = await cookieFor(dave);
  await Account.updateOne({ _id: dave._id }, { status: 'suspended' });
  const suspCalls: [string, string, unknown][] = [['GET', '/follows/tags', undefined], ['POST', url(category), undefined], ['DELETE', url(siteTag), undefined], ['PATCH', `${url(siteTag)}/pause`, { paused: true }]];
  const suspBad: string[] = [];
  for (const [m, p, body] of suspCalls) {
    const r = await call(m, p, { cookie: daveC2, body });
    if (r.status !== 403 || code(r) !== 'ACCOUNT_SUSPENDED') suspBad.push(`${m} ${p} -> ${r.status}`);
  }
  const daveFollows = await follows(dave);
  record(suspBad.length === 0 && daveFollows.length === 1 && daveFollows[0].paused === false, 'suspend: a suspended account with a live session still gets 403 ACCOUNT_SUSPENDED on every follow endpoint, and its follows are untouched', suspBad.join(' | '));
  await Account.updateOne({ _id: dave._id }, { status: 'active' });
  record((await call('POST', url(category), { cookie: daveC2 })).status === 200 && (await follows(dave)).length === 2, 'suspend: once the account is active again, that session follows again');
  await Follow.deleteMany({ accountId: dave._id });

  // ============================================================ 7. a retired tag (FR-3.4, FR-3.7)
  const toRetire = await Tag.create({ name: 'แท็กที่จะถูกเลิกใช้', facet: 'keyword' });
  await call('POST', url(toRetire), { cookie: aliceC });
  await call('POST', url(toRetire), { cookie: bobC });
  const retire = await call('PATCH', `/admin/tags/${toRetire._id}/retire`, { cookie: superC });
  record(retire.status === 200, 'retire: the Admin retires a tag that users follow (setup)', String(retire.status));
  const afterRetire = await call('GET', '/follows/tags', { cookie: aliceC });
  const entry = ((afterRetire.json?.data ?? []) as { _id: string; retired: boolean }[]).find(t => t._id === T(toRetire));
  record(afterRetire.status === 200 && !!entry && entry.retired === true, 'retire: the follow is kept, and the list says the tag is retired', JSON.stringify(entry));
  record((await call('POST', url(toRetire), { cookie: carolC })).status === 404, 'retire: nobody new can follow the retired tag');
  const pauseRetired = await call('PATCH', `${url(toRetire)}/pause`, { cookie: aliceC, body: { paused: true } });
  record(pauseRetired.status === 200 && pauseRetired.json?.data?.paused === true, 'retire: a user can still pause a retired tag they follow');
  const unfRetired = await call('DELETE', url(toRetire), { cookie: aliceC });
  record(unfRetired.status === 200 && (await Follow.countDocuments({ accountId: alice._id, tagId: toRetire._id })) === 0, 'retire: ...and unfollow it (they are never stuck with it)');
  await call('PATCH', `/admin/tags/${toRetire._id}/reactivate`, { cookie: superC });
  record((await call('POST', url(toRetire), { cookie: carolC })).status === 200, 'retire: once reactivated, the tag can be followed again');
  record((await Follow.countDocuments({ accountId: bob._id, tagId: toRetire._id })) === 1, 'retire: and a follow kept through the retirement is live again');
  await Follow.deleteMany({ tagId: toRetire._id });

  // ============================================================ 8. no limit on how many tags (SRS: "unlimited interest tags")
  const many = await Tag.insertMany(Array.from({ length: 120 }, (_, i) => ({ name: `แท็กทดสอบ ${String(i).padStart(3, '0')}`, facet: 'keyword' as const })));
  const manyRes = await Promise.all(many.map(t => call('POST', url(t), { cookie: carolC })));
  const manyList = await call('GET', '/follows/tags', { cookie: carolC });
  record(manyRes.every(r => r.status === 200) && manyList.json?.data?.length === 120, 'volume: a user can follow 120 tags and gets all 120 back');
  await Follow.deleteMany({ accountId: carol._id });
  await Tag.deleteMany({ _id: { $in: many.map(t => t._id) } });

  // ============================================================ 9. what a follow does to notifications (FR-3.3, FR-3.6; Use Case 6.2.6)
  const smtp = await startFakeSmtp();
  await Follow.deleteMany({});
  const eve = await mk('eve@example.com', 'user');          // follows, then pauses
  const frank = await mk('frank@example.com', 'user');      // follows, then unfollows
  const grace = await mk('grace@example.com', 'user');      // never follows
  const heidi = await mk('heidi@example.com', 'user');      // follows, then is suspended
  const eveC = await cookieFor(eve);
  const frankC = await cookieFor(frank);
  const graceC = await cookieFor(grace);
  const heidiC = await cookieFor(heidi);
  for (const c of [aliceC, eveC, frankC, heidiC]) await call('POST', url(siteTag), { cookie: c });
  await call('PATCH', `${url(siteTag)}/pause`, { cookie: eveC, body: { paused: true } });
  await call('DELETE', url(siteTag), { cookie: frankC });
  await call('PATCH', `/admin/accounts/${heidi._id}/suspend`, { cookie: superC });
  const mine = async (cookie: string) => ((await call('GET', '/notifications', { cookie })).json?.data ?? []) as { workTitle: string; matchedTags: string[]; read: boolean }[];
  const day = (n: number) => `2026-04-${String(n).padStart(2, '0')}T03:00:00Z`;
  feeds['8101'] = { D0: [{ id: '69010001', title: 'Follow test project one', at: day(1) }] };
  await runRssPoll(site as IGovSite, 'scheduler');
  const aliceN = await mine(aliceC);
  record(aliceN.length === 1 && aliceN[0].workTitle.includes('project one') && aliceN[0].matchedTags.includes(siteTag.name) && aliceN[0].read === false, 'notify: a new work on a followed tag notifies the follower (unread, naming the matched tag)', JSON.stringify(aliceN).slice(0, 160));
  record((await mine(eveC)).length === 0, 'notify: a PAUSED follow is not notified');
  record((await mine(frankC)).length === 0, 'notify: an UNFOLLOWED tag is not notified');
  record((await mine(graceC)).length === 0, 'notify: a user who never followed it is not notified');
  record((await Notification.countDocuments({ accountId: heidi._id })) === 0, 'notify: a suspended follower is not notified');
  const mails = smtp.messages.filter(m => /^To:/im.test(m));
  const mailTo = (who: string) => smtp.messages.filter(m => m.includes(who)).length;
  record(mailTo('alice@example.com') === 1 && mailTo('eve@example.com') === 0 && mailTo('frank@example.com') === 0 && mailTo('grace@example.com') === 0, 'notify: and the email goes to the follower only (none to the paused, unfollowed or non-following users)', `mails=${mails.length}`);

  // resume: the next work reaches her, the one she missed does not come back
  await call('PATCH', `${url(siteTag)}/pause`, { cookie: eveC, body: { paused: false } });
  feeds['8101'] = { D0: [{ id: '69010001', title: 'Follow test project one', at: day(1) }, { id: '69010002', title: 'Follow test project two', at: day(2) }] };
  await runRssPoll(site as IGovSite, 'scheduler');
  const eveN = await mine(eveC);
  record(eveN.length === 1 && eveN[0].workTitle.includes('project two'), 'notify: after RESUME the follower hears about the next new work, but not the one she missed while paused', eveN.map(n => n.workTitle).join(' | '));
  record((await mine(aliceC)).length === 2 && (await mine(frankC)).length === 0 && mailTo('eve@example.com') === 1, 'notify: the active follower now has both, the unfollower still none, and eve has one email');
  // follow again: she hears about the next one
  await call('POST', url(siteTag), { cookie: frankC });
  feeds['8101'] = { D0: [{ id: '69010003', title: 'Follow test project three', at: day(3) }] };
  await runRssPoll(site as IGovSite, 'scheduler');
  record((await mine(frankC)).length === 1 && (await mine(frankC))[0].workTitle.includes('project three'), 'notify: a user who follows again gets the next new work');
  // re-polling the same feed again: no duplicates
  await runRssPoll(site as IGovSite, 'scheduler');
  record((await mine(aliceC)).length === 3 && mailTo('alice@example.com') === 3, 'notify: polling the same feed again sends nothing twice');

  // one notification per work even when several followed tags match (FR-3.6)
  const dup = await Work.create({ siteId: site._id, projectId: 'MULTI-1', title: 'งานที่ตรงหลายแท็ก', status: 'BIDDING', announceType: 'D0', tags: [siteTag._id, category._id, keyword._id] });
  for (const t of [siteTag, category, keyword]) await call('POST', url(t), { cookie: graceC });
  await call('PATCH', `${url(keyword)}/pause`, { cookie: graceC, body: { paused: true } });
  await notifyNewWorkMatches(dup, [siteTag._id, category._id, keyword._id]);
  await notifyNewWorkMatches(dup, [siteTag._id, category._id, keyword._id]);
  const graceN = (await mine(graceC)).filter(n => n.workTitle === 'งานที่ตรงหลายแท็ก');
  record(graceN.length === 1 && graceN[0].matchedTags.length === 2 && !graceN[0].matchedTags.includes(keyword.name), 'notify: a work matching two followed tags is ONE notification naming both, and a paused tag is not named', JSON.stringify(graceN));
  record(mailTo('grace@example.com') === 1, 'notify: ...and one email');
  // a later poll adds a second tag she follows to a work she was already told about: no second email
  const dup2 = await Work.create({ siteId: site._id, projectId: 'MULTI-2', title: 'งานที่ได้แท็กเพิ่มภายหลัง', status: 'BIDDING', announceType: 'D0', tags: [siteTag._id, category._id] });
  await notifyNewWorkMatches(dup2, [siteTag._id]);
  await notifyNewWorkMatches(dup2, [category._id]);
  const graceLate = (await mine(graceC)).filter(n => n.workTitle === 'งานที่ได้แท็กเพิ่มภายหลัง');
  record(graceLate.length === 1 && mailTo('grace@example.com') === 2, 'notify: a work that picks up a second followed tag on a later poll is still one notification and one more email in total, not two', `${graceLate.length} notification(s), ${mailTo('grace@example.com')} email(s)`);

  // ============================================================ 10. deleting an account removes its follows (PDPA)
  await call('POST', url(category), { cookie: frankC });
  const frankCount = await Follow.countDocuments({ accountId: frank._id });
  const del = await call('DELETE', `/admin/accounts/${frank._id}`, { cookie: superC });
  record(frankCount === 2 && del.status === 200 && (await Follow.countDocuments({ accountId: frank._id })) === 0, 'delete: removing an account removes its follows with it', `${frankCount} -> ${await Follow.countDocuments({ accountId: frank._id })}, ${del.status}`);

  // ============================================================ 11. integrity over everything this check did
  const allFollows = await Follow.find({}).lean();
  const seen = new Set<string>();
  let dupes = 0;
  for (const f of allFollows) {
    const key = `${f.accountId}:${f.tagId}`;
    if (seen.has(key)) dupes += 1;
    seen.add(key);
  }
  const accountsLeft = new Set((await Account.find({}, '_id').lean()).map(a => String(a._id)));
  const tagsLeft = new Set((await Tag.find({}, '_id').lean()).map(t => String(t._id)));
  const orphans = allFollows.filter(f => !accountsLeft.has(String(f.accountId)) || !tagsLeft.has(String(f.tagId)));
  record(allFollows.length > 0 && dupes === 0 && orphans.length === 0 && allFollows.every(f => typeof f.paused === 'boolean'), `integrity: all ${allFollows.length} follows left are unique, belong to an existing account and tag, and have a paused flag`);

  await smtp.close();
  server.close();
  mock.close();
  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
