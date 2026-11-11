// MUST stay the first import: app.ts installs the audit plugin before any model loads.
import { createApp } from '../../src/app';

import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { env } from '../../src/config/env';
import { Account, AccountRole } from '../../src/models/account.model';
import { AnnounceType, GovSite, IGovSite } from '../../src/models/govSite.model';
import { Tag } from '../../src/models/tag.model';
import { STATUS_BY_ANNOUNCE_TYPE, Work, WorkStatus } from '../../src/models/work.model';
import { createGovSite } from '../../src/services/govSite.service';
import { runDataGoThEnrichment, runRssPoll } from '../../src/services/ingestion.service';
import { createSession } from '../../src/services/session.service';
import { applyAnnouncement, isChronological, repairHistory, StatusEvent } from '../../src/utils/statusHistory';

// View Work Detail & Status History (Use Case 6.2.3; SRS FR-4.3, FR-5.1, FR-5.4,
// FR-2.5). The detail API, then the integrity of status and history: polls run
// against a local mock of the e-GP feed (and of data.go.th), so the real
// ingestion code decides every status. Uses its own throwaway database (dropped
// at the start and end) -- never touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-work-detail-check';

// Nothing real may be called: no mail, no AI provider, no HTML pages.
(env as { SMTP_HOST?: string }).SMTP_HOST = undefined;
(env as { AI_TAGGING_ENABLED: boolean }).AI_TAGGING_ENABLED = false;
(env as { EGP_HTML_TOR_ENABLED: boolean }).EGP_HTML_TOR_ENABLED = false;

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ----------------------------------------------------------------- the mock feeds
interface FeedItem { id: string; title: string; at?: string }
const feeds: Record<string, Partial<Record<AnnounceType, FeedItem[]>>> = {};
const contractRecords: Record<string, Record<string, unknown>[]> = {};
let origin = '';

const mock = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/EPROCRssFeedWeb/egpannouncerss.xml') {
    const type = url.searchParams.get('anounceType') as AnnounceType;
    const items = (feeds[url.searchParams.get('deptId') ?? '']?.[type] ?? [])
      .map(
        i =>
          // a non-downloadable link ("other"), distinct per announcement
          `<item><title>${i.title}</title><link>${origin}/doc/${i.id}/${type}/${i.at ?? 'undated'}</link>` +
          `<description>${i.id}, ${i.title}</description>${i.at ? `<pubDate>${new Date(i.at).toUTCString()}</pubDate>` : ''}</item>`
      )
      .join('');
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return void res.end(`<?xml version="1.0" encoding="windows-874"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>${items}</channel></rss>`);
  }
  if (url.pathname === '/api/3/action/datastore_search') {
    const records = contractRecords[url.searchParams.get('resource_id') ?? ''] ?? [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return void res.end(JSON.stringify({ success: true, result: { total: records.length, fields: [], records } }));
  }
  res.writeHead(404);
  res.end();
});

interface Res { status: number; json: any; text: string; headers: Headers }
const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  (env as { EGP_RSS_BASE_URL: string }).EGP_RSS_BASE_URL = `${origin}/EPROCRssFeedWeb/egpannouncerss.xml`;
  (env as { DATA_GO_TH_BASE_URL: string }).DATA_GO_TH_BASE_URL = origin;

  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([Work.init(), Tag.init(), GovSite.init(), Account.init()]);

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function call(method: string, p: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  const get = (p: string) => call('GET', p);
  const code = (r: Res) => r.json?.error?.code;

  // =========================================================== 1. the pure rule
  const ev = (announceType: AnnounceType, at: string): StatusEvent => ({ status: STATUS_BY_ANNOUNCE_TYPE[announceType], announceType, changedAt: new Date(at) });
  const D = (day: number) => `2026-03-${String(day).padStart(2, '0')}T03:00:00Z`;
  const brandNew = applyAnnouncement([], 'D0', new Date(D(10)));
  record(brandNew.recorded && brandNew.status === 'BIDDING' && brandNew.history.length === 1, 'rule: the first announcement of a work starts its history and sets its status');
  const later = applyAnnouncement([ev('D0', D(10))], 'W0', new Date(D(20)));
  record(later.recorded && later.status === 'AWARDED' && later.history.map(e => e.announceType).join() === 'D0,W0', 'rule: a newer announcement moves the status forward and goes at the end of the history');
  const lateOld = applyAnnouncement([ev('D0', D(10)), ev('W0', D(20))], 'B0', new Date(D(1)));
  record(lateOld.recorded && lateOld.status === 'AWARDED' && lateOld.history.map(e => e.announceType).join() === 'B0,D0,W0', 'rule: an OLDER announcement read late is filed in its place in time and does not change the status');
  const known = applyAnnouncement([ev('B0', D(1)), ev('D0', D(10)), ev('W0', D(20))], 'B0', new Date(D(1)));
  record(!known.recorded && known.status === 'AWARDED' && known.history.length === 3, 'rule: an announcement already in the history changes nothing (re-reading a feed is free)');
  const reinvite = applyAnnouncement([ev('D0', D(10)), ev('D1', D(20))], 'D0', new Date(D(30)));
  record(reinvite.recorded && reinvite.status === 'BIDDING' && reinvite.history.map(e => e.announceType).join() === 'D0,D1,D0', 'rule: a NEW invitation after a cancellation (same type, later date) is a new event and wins');
  const oldInvite = applyAnnouncement([ev('D0', D(10)), ev('D1', D(20))], 'D0', new Date(D(10)));
  record(!oldInvite.recorded && oldInvite.status === 'CANCELLED', 'rule: the OLD invitation, still listed in its feed, does not undo the cancellation');
  const twice = applyAnnouncement([ev('D2', D(25))], 'D2', new Date(D(30)));
  record(twice.recorded && twice.status === 'AMENDED' && twice.history.length === 2, 'rule: a second amendment (same type, later date) is logged as another event');
  const undated = applyAnnouncement([ev('D0', D(10))], 'D0', null);
  record(!undated.recorded, 'rule: an item with no publish date is known by its type alone');
  const undatedNew = applyAnnouncement([ev('D0', D(10))], 'W0', null, new Date(D(29)));
  record(undatedNew.recorded && undatedNew.status === 'AWARDED' && undatedNew.history[1].changedAt.getTime() === new Date(D(29)).getTime(), 'rule: a new item with no publish date counts from now');
  const tie = applyAnnouncement([ev('W0', D(20))], 'D0', new Date(D(20)));
  record(tie.history.map(e => e.announceType).join() === 'D0,W0' && tie.status === 'AWARDED', 'rule: two announcements at the same moment are ordered by the usual order of a project\'s life');
  const damaged: StatusEvent[] = [ev('B0', D(1)), ev('D0', D(10)), ev('W0', D(20)), ev('B0', D(1)), ev('D0', D(10))];
  const healed = applyAnnouncement(damaged, 'D0', new Date(D(10)));
  record(healed.status === 'AWARDED' && !healed.recorded, 'rule: a work whose status an older version of the poll had pushed back is put right by the next announcement read');
  record(isChronological(lateOld.history) && !isChronological([ev('W0', D(20)), ev('D0', D(10))]), 'rule: isChronological tells an ordered history from an unordered one');
  const before = JSON.stringify([ev('D0', D(10))]);
  const input = [ev('D0', D(10))];
  applyAnnouncement(input, 'W0', new Date(D(20)));
  record(JSON.stringify(input) === before, 'rule: the history passed in is never modified');
  const repaired = repairHistory(damaged);
  record(repaired.map(e => e.announceType).join() === 'B0,D0,W0' && isChronological(repaired), 'repair: a history with repeats comes back with each announcement once, in order');
  record(repairHistory([ev('W0', D(20)), ev('B0', D(1)), ev('D0', D(10))]).map(e => e.announceType).join() === 'B0,D0,W0', 'repair: a history out of order is put in order');
  record(repairHistory([ev('D2', D(25)), ev('D2', D(30))]).length === 2 && repairHistory([]).length === 0, 'repair: two amendments on different days are both kept; an empty history stays empty');

  // ================================================== 2. the detail API (GET /works/:id)
  const siteX = await createGovSite({ name: 'กรมทางหลวง', nameEn: 'Department of Highways', shortCode: 'DOHX', deptId: '8001' });
  const tags = {
    method: await Tag.create({ name: 'วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', facet: 'method' }),
    agency: await Tag.create({ name: 'แขวงทางหลวงที่ 1', facet: 'agency' }),
    category: await Tag.create({ name: 'งานก่อสร้าง', facet: 'category' })
  };
  const siteTag = (await Tag.findOne({ facet: 'site', siteId: siteX._id }))!;
  const at = (iso: string) => new Date(iso);
  const full = await Work.create({
    siteId: siteX._id, projectId: '69000000001', title: 'ก่อสร้างถนนสายบางปะอิน', description: 'สรุปจากเอกสาร TOR',
    status: 'AWARDED', announceType: 'W0', pubDate: at('2026-03-20T03:00:00Z'),
    budget: 4_800_000, budgetBasis: 'awarded', contractNumber: 'C-001', contractDate: at('2026-04-01T00:00:00Z'), winnerName: 'บริษัท ทดสอบ จำกัด', winnerTin: '0105500000001',
    fiscalYear: 2569, fiscalYearSource: 'document', deadlineAt: at('2026-03-15T09:00:00Z'), deadlineStartAt: at('2026-03-12T02:00:00Z'), deadlineHasTime: true,
    tags: [siteTag._id, tags.method._id, tags.agency._id, tags.category._id],
    torFiles: [
      { announceType: 'B0', linkType: 'pdf', sourceUrl: 'https://example.test/doc1', storageKey: 'a1b2c3.pdf', filename: 'tor.pdf', downloadedAt: at('2026-03-02T00:00:00Z'), role: 'primary' },
      { announceType: 'B0', linkType: 'zip', sourceUrl: 'https://example.test/zip1', storageKey: 'd4e5f6.pdf', filename: 'annex.pdf', downloadedAt: at('2026-03-02T00:00:00Z'), role: 'attachment' },
      { announceType: 'D0', linkType: 'html', sourceUrl: 'https://example.test/page', downloadedAt: at('2026-03-11T00:00:00Z') },
      { announceType: 'D0', linkType: 'pdf', sourceUrl: 'https://example.test/old', storageKey: '0ld0ld.pdf', filename: 'old.pdf', supersededAt: at('2026-03-12T00:00:00Z') }
    ],
    statusHistory: [
      { status: 'DRAFT_TOR', announceType: 'B0', changedAt: at('2026-03-01T03:00:00Z') },
      { status: 'BIDDING', announceType: 'D0', changedAt: at('2026-03-10T03:00:00Z') },
      { status: 'AWARDED', announceType: 'W0', changedAt: at('2026-03-20T03:00:00Z') }
    ]
  });
  const bare = await Work.create({ siteId: siteX._id, projectId: '69000000002', title: 'งานที่ไม่มีรายละเอียดอื่น', status: 'PLANNED', announceType: 'P0', statusHistory: [{ status: 'PLANNED', announceType: 'P0', changedAt: at('2026-02-01T03:00:00Z') }], budgetMissingReason: 'no-document' });
  const hidden = await Work.create({ siteId: siteX._id, projectId: '69000000003', title: 'งานที่ถูกซ่อน', status: 'BIDDING', announceType: 'D0', ingestionRelevance: 'not-related', statusHistory: [{ status: 'BIDDING', announceType: 'D0', changedAt: at('2026-03-10T03:00:00Z') }] });

  const detail = await get(`/works/${full._id}`);
  const d = detail.json?.data;
  record(detail.status === 200 && detail.json.success === true && d._id === String(full._id), 'detail: GET /works/:id answers 200 in the success envelope, with no sign-in (FR-5.1)', `${detail.status}`);
  record(d.title === 'ก่อสร้างถนนสายบางปะอิน' && d.projectId === '69000000001' && d.description === 'สรุปจากเอกสาร TOR', 'detail: title, project number and the TOR summary');
  record(d.siteId?.name === 'กรมทางหลวง' && d.siteId?.shortCode === 'DOHX' && d.siteId?._id === String(siteX._id), 'detail: the agency (its government site: name, short code, id)');
  const tagsOf = (facet: string) => (d.tags as any[]).filter(t => t.facet === facet).map(t => t.name);
  record(sameList(tagsOf('method'), ['วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)']) && sameList(tagsOf('agency'), ['แขวงทางหลวงที่ 1']) && sameList(tagsOf('category'), ['งานก่อสร้าง']) && sameList(tagsOf('site'), ['กรมทางหลวง']), 'detail: the method, agency, category and site tags, each with its name and facet');
  record(d.tags.every((t: any) => t._id && t.name && t.facet && !('aliases' in t)), 'detail: tags carry only id, name and facet');
  record(d.budget === 4_800_000 && d.budgetBasis === 'awarded', 'detail: the price, and that it is a winning bid (not a reference price)');
  record(d.status === 'AWARDED' && d.announceType === 'W0', 'detail: the current status and the announcement type it comes from');
  record(d.pubDate === '2026-03-20T03:00:00.000Z' && d.deadlineAt === '2026-03-15T09:00:00.000Z' && d.deadlineStartAt === '2026-03-12T02:00:00.000Z' && d.deadlineHasTime === true && d.contractDate === '2026-04-01T00:00:00.000Z', 'detail: the dates (published, submission window, contract), as ISO timestamps');
  record(d.fiscalYear === 2569 && d.fiscalYearSource === 'document' && d.contractNumber === 'C-001' && d.winnerName === 'บริษัท ทดสอบ จำกัด', 'detail: fiscal year (and where it came from), contract number and winner');
  record(Array.isArray(d.torFiles) && d.torFiles.length === 4, 'detail: the TOR list (every document, including the one that was replaced)', `${d.torFiles?.length}`);
  const pdf = d.torFiles[0];
  record(pdf.announceType === 'B0' && pdf.linkType === 'pdf' && pdf.sourceUrl === 'https://example.test/doc1' && pdf.storageKey === 'a1b2c3.pdf' && pdf.filename === 'tor.pdf' && pdf.role === 'primary', 'detail: each TOR file says its announcement, kind, source link, stored name and role');
  record(d.torFiles[1].role === 'attachment' && !d.torFiles[2].storageKey && d.torFiles[2].linkType === 'html' && !!d.torFiles[3].supersededAt, 'detail: attachments, page-only links (nothing to download) and replaced documents are all marked');
  record(!('searchText' in d) && !('excludedTags' in d) && !/searchText|excludedTags|passwordHash/.test(detail.text), 'detail: internal fields are never sent');
  const minimal = (await get(`/works/${bare._id}`)).json.data;
  record(minimal.title && minimal.status === 'PLANNED' && Array.isArray(minimal.tags) && Array.isArray(minimal.torFiles) && minimal.torFiles.length === 0 && minimal.budget === undefined && minimal.budgetMissingReason === 'no-document', 'detail: a work with nothing optional still answers, with empty lists and the reason it has no price');
  record(sameList(d.statusHistory.map((e: any) => e.announceType), ['B0', 'D0', 'W0']), 'detail: the status history lists every announcement (FR-5.4)');
  record(d.statusHistory.every((e: any, i: number, a: any[]) => i === 0 || a[i - 1].changedAt <= e.changedAt), 'detail: the status history is oldest first');
  record(d.statusHistory[d.statusHistory.length - 1].status === d.status, 'detail: the current status is the last entry of the history');
  record(d.statusHistory.every((e: any) => e.status && e.announceType && e.changedAt), 'detail: each history entry has its status, announcement type and date');

  const listItem = (await get(`/works?siteId=${siteX._id}&pageSize=50`)).json.data.items.find((w: any) => w._id === String(full._id));
  record(listItem.status === d.status && listItem.announceType === d.announceType && listItem.title === d.title, 'detail and search agree: the same work shows the same status and title in both (FR-4.3)');

  // not found / malformed
  const unknown = await get(`/works/${new Types.ObjectId()}`);
  record(unknown.status === 404 && code(unknown) === 'NOT_FOUND', 'not found: an id that exists nowhere -> 404 NOT_FOUND', `${unknown.status}`);
  record(unknown.json.error.message === 'This work is no longer available.', 'not found: the message is the one the SRS asks for ("This work is no longer available.")', unknown.json.error.message);
  const hiddenRes = await get(`/works/${hidden._id}`);
  record(hiddenRes.status === 404 && hiddenRes.text === unknown.text.replace(/"id":"[^"]*"/, ''), 'not found: a work hidden by the topic filter looks exactly like one that does not exist', hiddenRes.text);
  record((await get(`/works/${String(full._id).toUpperCase()}`)).status === 200, 'id: the hex digits may be in upper case');
  const malformed = ['abc', '123', 'null', 'undefined', 'true', '0'.repeat(23), '0'.repeat(25), 'g'.repeat(24), `${full._id}x`, `x${full._id}`, `${full._id}%20`, '%20', 'a'.repeat(300), '..%2F..%2Fetc%2Fpasswd', '%7B%22%24ne%22%3Anull%7D', '%24ne', '%24where', '%E0%B8%81%E0%B8%A3%E0%B8%A1', '%00', '-1', '1e24', '0x' + 'f'.repeat(22)];
  for (const id of malformed) {
    const r = await get(`/works/${id}`);
    record(r.status === 400 && code(r) === 'VALIDATION_ERROR' && !!r.json.error.fields?.id, `malformed: /works/${decodeURIComponent(id).slice(0, 26)} -> 400 VALIDATION_ERROR naming "id"`, `${r.status} ${code(r) ?? ''}`);
  }
  record((await get(`/works/${full._id}?id[$ne]=x&status=HACKED`)).json.data.status === 'AWARDED', 'query: extra query parameters on the detail URL change nothing');
  record(!/stack|at \w+ \(|node_modules|mongoose|CastError/i.test((await get('/works/abc')).text), 'malformed: the error does not expose internals');
  const torBad = await get('/works/abc/tor/0');
  const torUnknown = await get(`/works/${new Types.ObjectId()}/tor/0`);
  record(torBad.status === 400 && torUnknown.status === 404, 'tor: the document route reads the id the same way (400 malformed, 404 unknown)', `${torBad.status}/${torUnknown.status}`);
  record((await get(`/works/${hidden._id}/tor/0`)).status === 404, 'tor: a hidden work has no downloadable files either');

  // ====================== 3. each announcement type gives its status (FR-4.3) -- through real polls
  const poll = (site: IGovSite) => runRssPoll(site, 'scheduler');
  const row = async (site: IGovSite, projectId: string) => (await Work.findOne({ siteId: site._id, projectId }).lean())!;
  const sig = (w: { statusHistory: StatusEvent[] }) => w.statusHistory.map(e => `${e.announceType}@${e.changedAt.toISOString().slice(5, 10)}`).join(' ');
  const mkSite = (shortCode: string, deptId: string, announceTypes: AnnounceType[]) => createGovSite({ name: `Site ${shortCode}`, shortCode, deptId, announceTypes, requestsPerMinute: 600 });
  const idOf = (n: number) => `72${String(n).padStart(9, '0')}`;

  const siteTypes = await mkSite('TYPES', '9001', ['P0', '15', 'B0', 'D0', 'D1', 'D2', 'W0', 'W1', 'W2']);
  const SRS_TABLE: Record<AnnounceType, WorkStatus> = { P0: 'PLANNED', '15': 'PLANNED', B0: 'DRAFT_TOR', D0: 'BIDDING', D1: 'CANCELLED', D2: 'AMENDED', W0: 'AWARDED', W1: 'CANCELLED', W2: 'AMENDED' };
  const types = Object.keys(SRS_TABLE) as AnnounceType[];
  feeds['9001'] = {};
  types.forEach((t, i) => (feeds['9001'][t] = [{ id: idOf(i), title: `Project for ${t}`, at: D(10 + i) }]));
  const first = await poll(siteTypes);
  record(first.status === 'success' && first.newCount === 9, 'status: one poll creates a work for each of the 9 announcement types', `${first.status} new=${first.newCount} ${first.errorLog.join('|')}`);
  for (const [i, t] of types.entries()) {
    const w = await row(siteTypes, idOf(i));
    record(w.status === SRS_TABLE[t] && w.announceType === t && w.statusHistory.length === 1 && w.statusHistory[0].status === SRS_TABLE[t] && w.statusHistory[0].changedAt.getTime() === new Date(D(10 + i)).getTime(), `status: ${t} -> ${SRS_TABLE[t]}, with one history entry dated by the announcement (SRS FR-4.3)`, `${w.status} ${sig(w)}`);
  }
  record(types.every(t => STATUS_BY_ANNOUNCE_TYPE[t] === SRS_TABLE[t]), 'status: the code\'s mapping table is exactly the one in the SRS');
  const again = await poll(siteTypes);
  record(again.newCount === 0 && again.updatedCount === 0 && again.status === 'success', 'status: reading the same feeds again changes nothing (nothing "updated")', `new=${again.newCount} updated=${again.updatedCount}`);
  record((await Promise.all(types.map(async (_, i) => (await row(siteTypes, idOf(i))).statusHistory.length))).every(n => n === 1), 'status: ...and adds no history');

  // ============================ 4. latest announcement wins, however the feeds are read (FR-4.3, FR-5.4)
  // a. an old announcement that every feed keeps listing must not pull the status back
  const siteLife = await mkSite('LIFE', '9002', ['B0', 'D0', 'W0']);
  const X = idOf(100);
  feeds['9002'] = { B0: [{ id: X, title: 'Road project X', at: D(1) }], D0: [{ id: X, title: 'Road project X', at: D(10) }], W0: [{ id: X, title: 'Road project X', at: D(20) }] };
  const run1 = await poll(siteLife);
  let w = await row(siteLife, X);
  record(w.status === 'AWARDED' && sig(w) === 'B0@03-01 D0@03-10 W0@03-20' && run1.newCount === 1, 'lifecycle: the first poll reads the three announcements and ends AWARDED with the history in order', `${w.status} ${sig(w)}`);
  const polls: string[] = [];
  let updatedTotal = 0;
  for (let n = 0; n < 3; n += 1) {
    const r = await poll(siteLife);
    updatedTotal += r.updatedCount;
    polls.push(`${(await row(siteLife, X)).status}/${(await row(siteLife, X)).statusHistory.length}`);
  }
  w = await row(siteLife, X);
  record(polls.every(p => p === 'AWARDED/3') && w.status === 'AWARDED', 'lifecycle: three more polls of feeds that still list the OLD draft and invitation leave it AWARDED with 3 history entries, not growing', polls.join(' '));
  record(updatedTotal === 0, 'lifecycle: ...and report nothing as updated', `${updatedTotal}`);

  // b. a newer type's feed stops listing the work
  const Y = idOf(101);
  feeds['9002'] = { B0: [{ id: Y, title: 'Road project Y', at: D(1) }], D0: [{ id: Y, title: 'Road project Y', at: D(10) }], W0: [{ id: Y, title: 'Road project Y', at: D(20) }] };
  await poll(siteLife);
  feeds['9002'] = { B0: [{ id: Y, title: 'Road project Y', at: D(1) }], D0: [{ id: Y, title: 'Road project Y', at: D(10) }], W0: [] };
  await poll(siteLife);
  w = await row(siteLife, Y);
  record(w.status === 'AWARDED' && w.announceType === 'W0' && w.statusHistory.length === 3, 'lifecycle: when the winner feed no longer lists the work but the older feeds still do, it stays AWARDED', `${w.status} ${sig(w)}`);

  // c. an older announcement that only shows up later
  const Z = idOf(102);
  feeds['9002'] = { B0: [], D0: [{ id: Z, title: 'Road project Z', at: D(10) }], W0: [{ id: Z, title: 'Road project Z', at: D(20) }] };
  await poll(siteLife);
  record(sig(await row(siteLife, Z)) === 'D0@03-10 W0@03-20', 'lifecycle: a work first seen part-way through its life starts with what was published');
  feeds['9002'] = { B0: [{ id: Z, title: 'Road project Z', at: D(1) }], D0: [{ id: Z, title: 'Road project Z', at: D(10) }], W0: [{ id: Z, title: 'Road project Z', at: D(20) }] };
  await poll(siteLife);
  w = await row(siteLife, Z);
  record(w.status === 'AWARDED' && sig(w) === 'B0@03-01 D0@03-10 W0@03-20', 'lifecycle: the draft TOR that turns up later is filed FIRST in the history and does not change the status', `${w.status} ${sig(w)}`);

  // d. the feeds read in the opposite order (an admin can order the types as they like)
  const siteBack = await mkSite('BACK', '9003', ['W0', 'D0', 'B0']);
  const R = idOf(103);
  feeds['9003'] = { B0: [{ id: R, title: 'Road project R', at: D(1) }], D0: [{ id: R, title: 'Road project R', at: D(10) }], W0: [{ id: R, title: 'Road project R', at: D(20) }] };
  await poll(siteBack);
  w = await row(siteBack, R);
  record(w.status === 'AWARDED' && sig(w) === 'B0@03-01 D0@03-10 W0@03-20', 'order: with the types read newest-first (W0, D0, B0) the work still ends AWARDED and its history is in order', `${w.status} ${sig(w)}`);
  await poll(siteBack);
  record(sig(await row(siteBack, R)) === 'B0@03-01 D0@03-10 W0@03-20' && (await row(siteBack, R)).status === 'AWARDED', 'order: and stays that way on the next poll');

  // e. cancelled, then invited again
  const siteRebid = await mkSite('REBID', '9004', ['D0', 'D1']);
  const Q = idOf(104);
  feeds['9004'] = { D0: [{ id: Q, title: 'Road project Q', at: D(10) }], D1: [] };
  await poll(siteRebid);
  feeds['9004'] = { D0: [{ id: Q, title: 'Road project Q', at: D(10) }], D1: [{ id: Q, title: 'Road project Q', at: D(20) }] };
  await poll(siteRebid);
  w = await row(siteRebid, Q);
  record(w.status === 'CANCELLED' && sig(w) === 'D0@03-10 D1@03-20', 'cancel: a cancellation moves the work to CANCELLED, and the old invitation still in the feed does not undo it', `${w.status} ${sig(w)}`);
  await poll(siteRebid);
  record((await row(siteRebid, Q)).status === 'CANCELLED' && (await row(siteRebid, Q)).statusHistory.length === 2, 'cancel: ...poll after poll');
  feeds['9004'] = { D0: [{ id: Q, title: 'Road project Q', at: D(30) }, { id: Q, title: 'Road project Q', at: D(10) }], D1: [{ id: Q, title: 'Road project Q', at: D(20) }] };
  await poll(siteRebid);
  w = await row(siteRebid, Q);
  record(w.status === 'BIDDING' && sig(w) === 'D0@03-10 D1@03-20 D0@03-30', 'cancel: a NEW invitation published after the cancellation puts the work back to BIDDING, as a new history entry', `${w.status} ${sig(w)}`);
  await poll(siteRebid);
  record(sig(await row(siteRebid, Q)) === 'D0@03-10 D1@03-20 D0@03-30', 'cancel: ...and it settles (no further entries)');

  // f. a second amendment
  const siteAmend = await mkSite('AMEND', '9005', ['D2']);
  const A = idOf(105);
  feeds['9005'] = { D2: [{ id: A, title: 'Road project A', at: D(25) }] };
  await poll(siteAmend);
  feeds['9005'] = { D2: [{ id: A, title: 'Road project A', at: D(30) }, { id: A, title: 'Road project A', at: D(25) }] };
  await poll(siteAmend);
  w = await row(siteAmend, A);
  record(w.status === 'AMENDED' && sig(w) === 'D2@03-25 D2@03-30', 'amend: a second amendment is logged as its own event, and the first is not logged again', `${w.status} ${sig(w)}`);

  // g. announcements with no publish date
  const siteBlank = await mkSite('BLANK', '9006', ['D0', 'W0']);
  const N = idOf(106);
  feeds['9006'] = { D0: [{ id: N, title: 'Road project N' }], W0: [] };
  await poll(siteBlank);
  await poll(siteBlank);
  w = await row(siteBlank, N);
  record(w.status === 'BIDDING' && w.statusHistory.length === 1, 'no date: an announcement with no publish date is recorded once, however often it is read', sig(w));
  feeds['9006'] = { D0: [{ id: N, title: 'Road project N' }], W0: [{ id: N, title: 'Road project N' }] };
  await poll(siteBlank);
  w = await row(siteBlank, N);
  record(w.status === 'AWARDED' && w.statusHistory.length === 2 && isChronological(w.statusHistory), 'no date: a later undated announcement still moves the status on', `${w.status} ${w.statusHistory.length}`);

  // h. the same item listed twice in one feed
  const siteDup = await mkSite('DUP', '9007', ['D0']);
  const U = idOf(107);
  feeds['9007'] = { D0: [{ id: U, title: 'Road project U', at: D(10) }, { id: U, title: 'Road project U', at: D(10) }] };
  const dup = await poll(siteDup);
  w = await row(siteDup, U);
  record(w.statusHistory.length === 1 && dup.newCount === 1, 'duplicates: the same announcement twice in one feed is one event');

  // the detail API shows what the polls produced
  const viaApi = (await get(`/works/${(await row(siteLife, X))._id}`)).json.data;
  record(viaApi.status === 'AWARDED' && viaApi.statusHistory.length === 3 && sameList(viaApi.statusHistory.map((e: any) => e.announceType), ['B0', 'D0', 'W0']), 'detail: the polled work shows AWARDED and its three events in order');
  const viaApiBack = (await get(`/works/${(await row(siteBack, R))._id}`)).json.data;
  record(viaApiBack.status === viaApiBack.statusHistory[viaApiBack.statusHistory.length - 1].status && viaApiBack.announceType === 'W0', 'detail: the status is the last history entry\'s status (read newest-first)');
  const viaList = (await get(`/works?siteId=${siteRebid._id}`)).json.data.items[0];
  record(viaList.status === 'BIDDING', 'search: the listing shows the same status as the detail page for the re-invited work');

  // ================================ 5. data.go.th enrichment never changes a status (FR-4.3, FR-2.x)
  const siteEnrich = await createGovSite({ name: 'Site ENRICH', shortCode: 'ENRICH', deptId: '9008', announceTypes: ['B0', 'D0', 'W0', 'D1'], requestsPerMinute: 600, dataGoThResourceId: 'resource-1' });
  const E = [idOf(110), idOf(111), idOf(112), idOf(113)];
  feeds['9008'] = {
    B0: [{ id: E[0], title: 'Enrich draft', at: D(1) }],
    D0: [{ id: E[1], title: 'Enrich open', at: D(2) }],
    W0: [{ id: E[2], title: 'Enrich awarded', at: D(3) }],
    D1: [{ id: E[3], title: 'Enrich cancelled', at: D(4) }]
  };
  await poll(siteEnrich);
  const snapshot = async () => JSON.stringify(await Promise.all(E.map(async id => { const x = await row(siteEnrich, id); return [x.status, x.announceType, sig(x)]; })));
  const beforeEnrich = await snapshot();
  contractRecords['resource-1'] = [
    ...E.map((id, i) => ({ proj_no: id, proj_name: `Contract ${i}`, proj_mny: 1_000_000 + i, contrct_price: 900_000 + i, corp_name: `Winner ${i}`, win_tin: `01055000000${i}`, contrct_num: `CN-${i}`, contrct_date: '2026-04-01', status: 'CANCELLED', proj_status: 'DRAFT_TOR', announce_type: 'D1', statusHistory: [] })),
    { proj_no: '79999999999', proj_name: 'Not one of ours', proj_mny: 5, corp_name: 'Nobody' }
  ];
  const enrichRun = await runDataGoThEnrichment(siteEnrich, 'scheduler');
  record(enrichRun.status === 'success' && enrichRun.updatedCount === 4, 'enrichment: the data.go.th run enriches the four works it knows', `${enrichRun.status} updated=${enrichRun.updatedCount} ${enrichRun.errorLog.join('|')}`);
  const afterEnrich = await snapshot();
  record(afterEnrich === beforeEnrich, 'enrichment: ...and not one status, announcement type or history entry changed, even though the records carry status-like columns', afterEnrich === beforeEnrich ? '' : `${beforeEnrich} -> ${afterEnrich}`);
  const enriched = await row(siteEnrich, E[2]);
  record(enriched.budget === 1_000_002 && enriched.winnerName === 'Winner 2' && enriched.contractNumber === 'CN-2' && !!enriched.enrichedAt, 'enrichment: ...while the price, winner and contract details were filled in');
  record((await Work.countDocuments({ projectId: '79999999999' })) === 0, 'enrichment: a record for a project we do not have creates nothing');
  record((await row(siteEnrich, E[3])).status === 'CANCELLED' && (await row(siteEnrich, E[0])).status === 'DRAFT_TOR', 'enrichment: a cancelled work stays cancelled, a draft stays a draft');
  await runDataGoThEnrichment(siteEnrich, 'scheduler');
  record((await snapshot()) === beforeEnrich, 'enrichment: and a second run changes nothing either');

  // ===================================== 6. no API can set a status by hand (FR-4.3: "no manual override path")
  const mk = (email: string, role: AccountRole, extra: Record<string, unknown> = {}) =>
    Account.create({ email, passwordHash: 'Password123', name: `Name ${email.split('@')[0]}`, type: 'individual', status: 'active', role, ...extra });
  const cookieFor = async (a: { _id: unknown }) => `${SESSION_COOKIE_NAME}=${(await createSession(a._id as never, {})).rawToken}`;
  const superCookie = await cookieFor(await mk('super@example.com', 'superadmin'));
  const tagAdminCookie = await cookieFor(await mk('tagadmin@example.com', 'admin', { permissions: ['tag:manage'] }));
  const pollAdminCookie = await cookieFor(await mk('polladmin@example.com', 'admin', { permissions: ['poll:manage'] }));
  const vendorCookie = await cookieFor(await mk('vendor@example.com', 'user'));
  const target = (await row(siteLife, X))._id;
  const targetBefore = async () => { const t = (await Work.findById(target).lean())!; return JSON.stringify([t.status, t.announceType, t.statusHistory.length, t.tags.length]); };
  const frozen = await targetBefore();
  const attempts: [string, string, unknown][] = [];
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const p of [`/works/${target}`, `/works/${target}/status`, `/admin/works/${target}`, `/admin/works/${target}/status`, `/admin/works/${target}/status-history`]) {
      attempts.push([method, p, { status: 'CANCELLED', announceType: 'D1', statusHistory: [] }]);
    }
  }
  let refused = 0;
  const refusedBy: string[] = [];
  for (const cookie of [undefined, vendorCookie, pollAdminCookie, tagAdminCookie, superCookie]) {
    for (const [method, p, body] of attempts) {
      const r = await call(method, p, { cookie, body });
      if (r.status >= 400) refused += 1;
      else refusedBy.push(`${method} ${p} -> ${r.status}`);
    }
  }
  record(refused === attempts.length * 5 && (await targetBefore()) === frozen, `no override: ${attempts.length * 5} attempts to write a status (every method, every plausible URL, as visitor, vendor, Poll Admin, Tag Admin and Super Admin) are all refused and change nothing`, refusedBy.slice(0, 3).join(' | '));
  for (const [label, body] of [
    ['status only', { status: 'CANCELLED' }],
    ['tags plus status', { tagIds: [], status: 'CANCELLED' }],
    ['tags plus announceType', { tagIds: [], announceType: 'D1' }],
    ['tags plus statusHistory', { tagIds: [], statusHistory: [{ status: 'CANCELLED', announceType: 'D1', changedAt: new Date().toISOString() }] }],
    ['tags plus a nested update operator', { tagIds: [], $set: { status: 'CANCELLED' } }],
    ['tags plus dotted key', { tagIds: [], 'statusHistory.0.status': 'CANCELLED' }],
    ['tags plus prototype key', JSON.parse('{"tagIds":[],"__proto__":{"status":"CANCELLED"}}')]
  ] as [string, unknown][]) {
    const r = await call('PUT', `/admin/works/${target}/tags`, { cookie: superCookie, body });
    record((r.status === 400 || r.status === 200) && (await targetBefore()).startsWith('["AWARDED","W0",3'), `no override: PUT /admin/works/:id/tags with ${label} leaves status and history alone`, `${r.status} ${code(r) ?? ''}`);
  }
  const strict = await call('PUT', `/admin/works/${target}/tags`, { cookie: superCookie, body: { tagIds: [], status: 'CANCELLED' } });
  record(strict.status === 400 && code(strict) === 'VALIDATION_ERROR', 'no override: the tags endpoint refuses any field it does not know (400), so a status cannot ride along');
  const pollBody = await call('POST', `/admin/gov-sites/${siteLife._id}/poll`, { cookie: superCookie, body: { source: 'rss', status: 'CANCELLED' } });
  record(pollBody.status === 400, 'no override: the poll endpoint takes no status either (400)', `${pollBody.status}`);
  const adminListStatus = await call('GET', '/admin/works?status=CANCELLED', { cookie: superCookie });
  record(adminListStatus.status === 400 && (await targetBefore()) === frozen, 'no override: "status" on the admin list is not even a filter');

  // every route that can change a work, found by reading the app's own route table
  type Layer = { route?: { path: string; methods: Record<string, boolean> }; name?: string; handle?: { stack?: Layer[] }; regexp?: RegExp };
  const routes: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) routes.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const mount = layer.regexp!.source.replace('^', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(((app as unknown as { _router: { stack: Layer[] } })._router.stack), '');
  const mutating = routes.filter(r => !/^(GET|HEAD|OPTIONS) /.test(r));
  const workWriters = mutating.filter(r => /\/works?\b/i.test(r));
  record(sameList(workWriters, ['PUT /api/v1/admin/works/:id/tags']), 'no override: the only route anywhere that writes to a work is PUT /admin/works/:id/tags (tags only)', workWriters.join(' | '));
  record(mutating.every(r => !/status/i.test(r.split(' ')[1])), 'no override: no write route anywhere has "status" in its path', mutating.filter(r => /status/i.test(r)).join(' | '));
  record(routes.length > 40, 'no override: the route table was read in full', `${routes.length} routes`);

  // the model itself refuses a status it does not know
  const bogus = (extra: Record<string, unknown>) => Work.create({ siteId: siteX._id, projectId: `bogus-${Math.random()}`, title: 'x', status: 'BIDDING', announceType: 'D0', ...extra }).then(() => 'accepted', () => 'refused');
  record((await bogus({ status: 'HACKED' })) === 'refused' && (await bogus({ announceType: 'ZZ' })) === 'refused', 'model: a work cannot be saved with a status or announcement type outside the SRS list');
  record((await bogus({ statusHistory: [{ status: 'HACKED', announceType: 'D0', changedAt: new Date() }] })) === 'refused' && (await bogus({ statusHistory: [{ status: 'BIDDING', announceType: 'ZZ', changedAt: new Date() }] })) === 'refused', 'model: nor a history entry with one');
  record((await bogus({})) === 'accepted', 'model: a normal work is still accepted');
  await Work.deleteMany({ projectId: /^bogus-/ }); // throwaway rows of the three tests above

  // =========== 7. `npm run backfill:status-history` repairs works the older poll had damaged
  const siteOld = await mkSite('OLDBUG', '9009', ['D0']);
  const insertRaw = (projectId: string, status: string, announceType: string, history: [string, string][]) =>
    Work.collection.insertOne({
      siteId: siteOld._id, projectId, title: `Legacy ${projectId}`, status, announceType, tags: [], excludedTags: [], torFiles: [],
      statusHistory: history.map(([type, day]) => ({ status: STATUS_BY_ANNOUNCE_TYPE[type as AnnounceType], announceType: type, changedAt: new Date(day) })),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z')
    });
  await insertRaw('L1', 'BIDDING', 'D0', [['B0', D(1)], ['D0', D(10)], ['W0', D(20)], ['B0', D(1)], ['D0', D(10)], ['W0', D(20)], ['B0', D(1)], ['D0', D(10)]]); // repeats, status pulled back
  await insertRaw('L2', 'AWARDED', 'W0', [['W0', D(20)], ['B0', D(1)], ['D0', D(10)]]); // out of order only
  await insertRaw('L3', 'BIDDING', 'D0', [['D0', D(10)], ['D1', D(20)]]); // history fine, status wrong
  await insertRaw('L4', 'AWARDED', 'W0', [['B0', D(1)], ['D0', D(10)], ['W0', D(20)]]); // already right
  await insertRaw('L5', 'BIDDING', 'D0', []); // no history to go by
  const root = path.join(__dirname, '../..');
  const backfill = (...args: string[]): Promise<string> =>
    new Promise(resolve => {
      const child = spawn('npx', ['tsx', path.join(root, 'src/scripts/backfillStatusHistory.ts'), ...args], { cwd: root, env: { ...process.env, MONGODB_URI } });
      let output = '';
      child.stdout.on('data', c => (output += c));
      child.stderr.on('data', c => (output += c));
      child.on('close', () => resolve(output));
    });
  const legacy = async (id: string) => (await Work.collection.findOne({ projectId: id })) as unknown as { status: string; announceType: string; statusHistory: StatusEvent[]; updatedAt: Date };
  const dry = await backfill('--dry-run');
  record(/\[dry run\]/.test(dry) && /2 history\(ies\) put in order, 2 status\(es\) corrected/.test(dry), 'backfill: a dry run reports what it would do (2 histories, 2 statuses)', dry.split('\n').find(l => l.startsWith('Done')) ?? dry.slice(0, 200));
  record((await legacy('L1')).statusHistory.length === 8 && (await legacy('L1')).status === 'BIDDING', 'backfill: ...and writes nothing');
  const ran = await backfill();
  record(/Done: 2 history\(ies\) put in order, 2 status\(es\) corrected/.test(ran), 'backfill: the real run puts 2 histories in order and corrects 2 statuses', ran.split('\n').find(l => l.startsWith('Done')) ?? ran.slice(0, 200));
  const l1 = await legacy('L1');
  record(l1.status === 'AWARDED' && l1.announceType === 'W0' && sig(l1) === 'B0@03-01 D0@03-10 W0@03-20', 'backfill: a work with repeats and a pulled-back status ends with each announcement once and AWARDED', `${l1.status} ${sig(l1)}`);
  record(sig(await legacy('L2')) === 'B0@03-01 D0@03-10 W0@03-20' && (await legacy('L2')).status === 'AWARDED', 'backfill: an out-of-order history is put in order');
  record((await legacy('L3')).status === 'CANCELLED' && (await legacy('L3')).announceType === 'D1' && (await legacy('L3')).statusHistory.length === 2, 'backfill: a wrong status is corrected from the history (BIDDING -> CANCELLED)');
  record((await legacy('L4')).updatedAt.getTime() === new Date('2026-01-01T00:00:00Z').getTime(), 'backfill: a work that was already right is not touched');
  record((await legacy('L5')).status === 'BIDDING' && (await legacy('L5')).statusHistory.length === 0, 'backfill: a work with no history is left alone');
  const rerun = await backfill();
  record(/Done: 0 history\(ies\) put in order, 0 status\(es\) corrected/.test(rerun), 'backfill: running it again changes nothing', rerun.split('\n').find(l => l.startsWith('Done')) ?? '');
  await Work.collection.deleteMany({ siteId: siteOld._id, projectId: 'L5' }); // no history: not part of the invariant below

  // =============== 8. the invariant, over every work this check created and every poll it ran
  const everyWork = await Work.find({}).lean();
  const broken = everyWork.filter(x => {
    const h = x.statusHistory as StatusEvent[];
    const last = h[h.length - 1];
    return !isChronological(h) || !last || last.status !== x.status || last.announceType !== x.announceType || h.some(e => STATUS_BY_ANNOUNCE_TYPE[e.announceType] !== e.status);
  });
  record(everyWork.length >= 20 && broken.length === 0, `invariant: all ${everyWork.length} works have an in-order history, whose last entry is the work's status, and every entry's status is the one its announcement type gives`, broken.map(x => `${x.projectId}:${x.status}`).join(' '));

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
