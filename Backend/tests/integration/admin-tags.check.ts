import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Account, AccountRole } from '../../src/models/account.model';
import { Follow } from '../../src/models/follow.model';
import { Tag } from '../../src/models/tag.model';
import { Work } from '../../src/models/work.model';
import { SESSION_COOKIE_NAME } from '../../src/config/cookie';
import { findOrCreateAiTag } from '../../src/services/tag.service';
import { buildUserPrompt } from '../../src/integrations/ai/prompt';
import { cleanAliases, compareTagKeys, tagKey } from '../../src/utils/tagText';

// Uses its own throwaway database (dropped at the start and end) -- never
// touches the dev database.
const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-admin-tags-check';

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
    return Account.create({ email, passwordHash: PASSWORD, name: email, type: 'individual', status: 'active', role, permissions: role === 'admin' ? ['tag:manage'] : [] });
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

  // ---------------------------------------------------------------- unit: text
  record(compareTagKeys(tagKey('e-bidding'), tagKey('E Bidding'))?.kind === 'exact', 'text: "e-bidding" == "E Bidding" (case/space/punctuation ignored)');
  record(compareTagKeys(tagKey('ก่อสร้าง'), tagKey('ก่อสร้าง '))?.kind === 'exact', 'text: Thai matches ignoring trailing space');
  record(compareTagKeys(tagKey('ก่อสร้าง'), tagKey('ก้อสร้าง')) === null || compareTagKeys(tagKey('ก่อสร้าง'), tagKey('ก้อสร้าง'))?.kind !== 'exact', 'text: different Thai tone marks are NOT treated as identical');
  record(compareTagKeys(tagKey('Traffic Signal'), tagKey('Traffic Signals'))?.kind === 'similar', 'text: singular/plural is "similar"');
  record(compareTagKeys(tagKey('IT'), tagKey('IP')) === null, 'text: very short terms are never "similar"');
  record(compareTagKeys(tagKey('Bridge'), tagKey('Software')) === null, 'text: unrelated words do not match');
  record(
    JSON.stringify(cleanAliases('Road', ['  Roads ', 'road', 'ROAD', 'Street', 'street', '', ' '])) === JSON.stringify(['Roads', 'Street']),
    'text: cleanAliases trims, drops blanks, drops the name itself and de-duplicates',
    JSON.stringify(cleanAliases('Road', ['  Roads ', 'road', 'ROAD', 'Street', 'street', '', ' ']))
  );

  // ------------------------------------------------------------------- access
  const anon = await call('GET', '/admin/tags');
  record(anon.status === 401, 'visitor gets 401 on GET /admin/tags', String(anon.status));
  const asVendor = await call('POST', '/admin/tags', vendorCookie, { name: 'x', facet: 'keyword' });
  record(asVendor.status === 403, 'vendor gets 403 on POST /admin/tags', String(asVendor.status));
  record((await call('PATCH', '/admin/tags/000000000000000000000000', vendorCookie, { name: 'x' })).status === 403, 'vendor gets 403 on PATCH /admin/tags/:id');
  record((await call('POST', '/admin/tags/check-duplicates', vendorCookie, { name: 'x' })).status === 403, 'vendor gets 403 on check-duplicates');
  const emptyList = await call('GET', '/admin/tags', adminCookie);
  record(emptyList.status === 200 && Array.isArray(emptyList.json?.data) && emptyList.json.data.length === 0, 'admin gets 200 and an empty list on a fresh system');

  // ------------------------------------------------------------------- create
  const cctv = await call('POST', '/admin/tags', adminCookie, {
    name: '  กล้องวงจรปิด CCTV ',
    facet: 'keyword',
    aliases: ['CCTV', ' cctv ', 'กล้องความปลอดภัย', 'กล้องวงจรปิด CCTV']
  });
  record(cctv.status === 201, 'admin can create a tag', String(cctv.status));
  record(cctv.json?.data?.name === 'กล้องวงจรปิด CCTV', 'name is trimmed', cctv.json?.data?.name);
  record(
    JSON.stringify(cctv.json?.data?.aliases) === JSON.stringify(['CCTV', 'กล้องความปลอดภัย']),
    'aliases are cleaned: trimmed, de-duplicated, own name dropped',
    JSON.stringify(cctv.json?.data?.aliases)
  );
  const cctvId: string = cctv.json.data._id;

  const bridge = await call('POST', '/admin/tags', adminCookie, { name: 'Bridge Construction', facet: 'category', aliases: ['bridge'] });
  record(bridge.status === 201, 'admin can create a second unrelated tag', String(bridge.status));
  const bridgeId: string = bridge.json.data._id;

  // ---------------------------------------------------------- exact duplicates
  const dupName = await call('POST', '/admin/tags', adminCookie, { name: 'bridge  construction', facet: 'category' });
  record(
    dupName.status === 409 && dupName.json?.error?.code === 'DUPLICATE_TAG' && dupName.json.error.details?.matches?.[0]?.tagId === bridgeId,
    'same name (different case/spacing) is blocked with DUPLICATE_TAG and names the existing tag',
    JSON.stringify(dupName.json?.error)
  );
  const dupCrossFacet = await call('POST', '/admin/tags', adminCookie, { name: 'Bridge Construction', facet: 'keyword' });
  record(dupCrossFacet.status === 409 && dupCrossFacet.json?.error?.code === 'DUPLICATE_TAG', 'same name in ANOTHER facet is also blocked', String(dupCrossFacet.status));
  const nameIsAlias = await call('POST', '/admin/tags', adminCookie, { name: 'cctv', facet: 'keyword' });
  record(nameIsAlias.status === 409 && nameIsAlias.json?.error?.code === 'DUPLICATE_TAG', 'a new NAME equal to an existing tag\'s alias is blocked', String(nameIsAlias.status));
  const aliasIsName = await call('POST', '/admin/tags', adminCookie, { name: 'Highway', facet: 'category', aliases: ['bridge construction'] });
  record(aliasIsName.status === 409 && aliasIsName.json?.error?.code === 'DUPLICATE_TAG', 'a new ALIAS equal to an existing tag\'s name is blocked', String(aliasIsName.status));
  const aliasIsAlias = await call('POST', '/admin/tags', adminCookie, { name: 'Highway', facet: 'category', aliases: ['Bridge'] });
  record(aliasIsAlias.status === 409 && aliasIsAlias.json?.error?.code === 'DUPLICATE_TAG', 'a new ALIAS equal to an existing alias is blocked', String(aliasIsAlias.status));
  const exactWithConfirm = await call('POST', '/admin/tags', adminCookie, { name: 'BRIDGE CONSTRUCTION', facet: 'category', confirmNearDuplicate: true });
  record(exactWithConfirm.status === 409, 'confirmNearDuplicate does NOT override an exact duplicate', String(exactWithConfirm.status));

  // ---------------------------------------------------------- near duplicates
  const signals = await call('POST', '/admin/tags', adminCookie, { name: 'Traffic Signals', facet: 'keyword' });
  record(signals.status === 201, 'baseline tag "Traffic Signals" created');
  const near = await call('POST', '/admin/tags', adminCookie, { name: 'Traffic Signal', facet: 'keyword' });
  record(
    near.status === 409 && near.json?.error?.code === 'NEAR_DUPLICATE_TAG' && near.json.error.details?.matches?.[0]?.name === 'Traffic Signals',
    'a near-duplicate is warned (NEAR_DUPLICATE_TAG) and points at the similar tag',
    JSON.stringify(near.json?.error?.details?.matches?.[0])
  );
  const nearConfirmed = await call('POST', '/admin/tags', adminCookie, { name: 'Traffic Signal', facet: 'keyword', confirmNearDuplicate: true });
  record(nearConfirmed.status === 201, 'the admin can knowingly create it after confirming the warning', String(nearConfirmed.status));
  const unrelated = await call('POST', '/admin/tags', adminCookie, { name: 'Medical Equipment', facet: 'category' });
  record(unrelated.status === 201, 'an unrelated name is created with no warning', String(unrelated.status));

  // -------------------------------------------------- live duplicate pre-check
  const pre = await call('POST', '/admin/tags/check-duplicates', adminCookie, { name: 'BRIDGE construction' });
  record(pre.status === 200 && pre.json.data.exact.length === 1 && pre.json.data.exact[0].name === 'Bridge Construction', 'check-duplicates reports an exact match without creating anything');
  const preSimilar = await call('POST', '/admin/tags/check-duplicates', adminCookie, { name: 'Traffic Signalz' });
  record(preSimilar.json.data.exact.length === 0 && preSimilar.json.data.similar.length >= 1, 'check-duplicates reports similar tags', JSON.stringify(preSimilar.json.data.similar.map((m: any) => m.name)));
  const preSelf = await call('POST', '/admin/tags/check-duplicates', adminCookie, { name: 'Bridge Construction', excludeId: bridgeId });
  record(preSelf.json.data.exact.length === 0, 'check-duplicates ignores the tag being edited (excludeId)');
  const preClean = await call('POST', '/admin/tags/check-duplicates', adminCookie, { name: 'Completely Different' });
  record(preClean.json.data.exact.length === 0 && preClean.json.data.similar.length === 0, 'check-duplicates is empty for an unrelated name');
  const totalAfterChecks = await Tag.countDocuments({});
  record(totalAfterChecks === 5, 'check-duplicates created nothing (5 tags total)', String(totalAfterChecks));

  // ------------------------------------------------------------------- update
  const rename = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, { name: 'Bridge & Road Construction' });
  record(rename.status === 200 && rename.json.data.name === 'Bridge & Road Construction' && rename.json.data._id === bridgeId, 'rename keeps the same tag id', rename.json?.data?.name);
  const sameName = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, { name: 'Bridge & Road Construction', aliases: ['bridge', 'ก่อสร้างสะพาน'] });
  record(sameName.status === 200 && sameName.json.data.aliases.length === 2, 'saving a tag with its own name/aliases never conflicts with itself and replaces aliases', JSON.stringify(sameName.json?.data?.aliases));
  const renameToOther = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, { name: 'medical equipment' });
  record(renameToOther.status === 409 && renameToOther.json.error.code === 'DUPLICATE_TAG', 'renaming onto another tag\'s name is blocked', String(renameToOther.status));
  const aliasToOther = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, { aliases: ['CCTV'] });
  record(aliasToOther.status === 409 && aliasToOther.json.error.code === 'DUPLICATE_TAG', 'adding an alias that another tag already uses is blocked', String(aliasToOther.status));
  const emptyPatch = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, {});
  record(emptyPatch.status === 400, 'an empty PATCH is rejected', String(emptyPatch.status));
  const facetPatch = await call('PATCH', `/admin/tags/${bridgeId}`, adminCookie, { facet: 'keyword' });
  record(facetPatch.status === 400, 'facet cannot be changed via PATCH (strict body)', String(facetPatch.status));
  const missing = await call('PATCH', '/admin/tags/000000000000000000000000', adminCookie, { name: 'Nope Nope' });
  record(missing.status === 404, 'editing an unknown tag returns 404', String(missing.status));

  // ------------------------------------------------------------ input limits
  record((await call('POST', '/admin/tags', adminCookie, { name: '   ', facet: 'keyword' })).status === 400, 'blank name is rejected');
  record((await call('POST', '/admin/tags', adminCookie, { name: 'Zed Tag', facet: 'site' })).status === 400, 'creating a facet "site" tag is rejected');
  record((await call('POST', '/admin/tags', adminCookie, { name: 'Zed Tag', facet: 'keyword', bogus: 1 })).status === 400, 'unknown body fields are rejected');
  record((await call('POST', '/admin/tags', adminCookie, { name: 'Zed Tag', facet: 'keyword', aliases: ['ok', ' '] })).status === 400, 'a blank alias is rejected');
  const manyAliases = Array.from({ length: 31 }, (_, i) => `alias number ${i}`);
  record((await call('POST', '/admin/tags', adminCookie, { name: 'Zed Tag', facet: 'keyword', aliases: manyAliases })).status === 400, 'more than 30 aliases is rejected');

  // --------------------------------------------------------------- site tags
  const siteTag = await Tag.create({ name: 'สำนักงานตัวอย่าง', facet: 'site', aliases: ['SAMPLE'], siteId: new mongoose.Types.ObjectId() });
  const renameSite = await call('PATCH', `/admin/tags/${siteTag._id}`, adminCookie, { name: 'ชื่อใหม่' });
  record(renameSite.status === 400, 'a site tag cannot be renamed', String(renameSite.status));
  const aliasSite = await call('PATCH', `/admin/tags/${siteTag._id}`, adminCookie, { aliases: ['SAMPLE', 'SMP'] });
  record(aliasSite.status === 200 && aliasSite.json.data.aliases.includes('SMP'), 'a site tag\'s aliases can still be edited', String(aliasSite.status));
  const retireSite = await call('PATCH', `/admin/tags/${siteTag._id}/retire`, adminCookie);
  record(retireSite.status === 400, 'a site tag cannot be retired (disable the site instead)', String(retireSite.status));

  // ------------------------------------------------------------- usage counts
  await Work.collection.insertMany([
    { title: 'w1', siteId: new mongoose.Types.ObjectId(), projectId: 'P1', tags: [new mongoose.Types.ObjectId(cctvId), new mongoose.Types.ObjectId(bridgeId)] },
    { title: 'w2', siteId: new mongoose.Types.ObjectId(), projectId: 'P2', tags: [new mongoose.Types.ObjectId(cctvId)] }
  ] as any);
  await Follow.create({ accountId: vendor._id, tagId: new mongoose.Types.ObjectId(cctvId) });
  const listed = await call('GET', '/admin/tags', adminCookie);
  const cctvRow = listed.json.data.find((t: any) => t._id === cctvId);
  const bridgeRow = listed.json.data.find((t: any) => t._id === bridgeId);
  record(cctvRow?.worksCount === 2 && cctvRow?.followerCount === 1, 'list shows real usage counts (2 works, 1 follower)', JSON.stringify({ w: cctvRow?.worksCount, f: cctvRow?.followerCount }));
  record(bridgeRow?.worksCount === 1 && bridgeRow?.followerCount === 0, 'list shows 1 work / 0 followers for another tag');
  const filtered = await call('GET', '/admin/tags?facet=category', adminCookie);
  record(filtered.json.data.every((t: any) => t.facet === 'category') && filtered.json.data.length === 2, 'facet filter works', String(filtered.json.data.length));
  const searchedAlias = await call('GET', '/admin/tags?search=ความปลอดภัย', adminCookie);
  record(searchedAlias.json.data.length === 1 && searchedAlias.json.data[0]._id === cctvId, 'search matches inside aliases (Thai)');
  const searchedRegex = await call('GET', '/admin/tags?search=(', adminCookie);
  record(searchedRegex.status === 200, 'search with regex characters does not break', String(searchedRegex.status));

  // ------------------------------------------------------------- retire / reactivate
  const retire = await call('PATCH', `/admin/tags/${cctvId}/retire`, adminCookie);
  record(retire.status === 200 && retire.json.data.retired === true, 'admin can retire a tag');
  const defaultList = await call('GET', '/admin/tags', adminCookie);
  record(!defaultList.json.data.some((t: any) => t._id === cctvId), 'retired tags are hidden from the default admin list');
  const withRetired = await call('GET', '/admin/tags?includeRetired=true', adminCookie);
  record(withRetired.json.data.some((t: any) => t._id === cctvId && t.retired), 'retired tags are listed with includeRetired=true');
  const publicList = await call('GET', '/tags');
  record(!publicList.json.data.some((t: any) => t._id === cctvId), 'retired tags disappear from the PUBLIC tag list');
  const worksKept = await Work.collection.countDocuments({ tags: new mongoose.Types.ObjectId(cctvId) });
  const followKept = await Follow.countDocuments({ tagId: cctvId });
  record(worksKept === 2 && followKept === 1, 'retiring keeps existing work links and follows (nothing is deleted)');
  const editRetired = await call('PATCH', `/admin/tags/${cctvId}`, adminCookie, { name: 'Renamed' });
  record(editRetired.status === 400, 'a retired tag cannot be edited', String(editRetired.status));
  const sameNameRetired = await call('POST', '/admin/tags', adminCookie, { name: 'กล้องวงจรปิด cctv', facet: 'keyword' });
  record(
    sameNameRetired.status === 409 && sameNameRetired.json.error.details.matches[0].retired === true,
    'creating the same name as a RETIRED tag (same facet) is blocked and says it is retired',
    sameNameRetired.json?.error?.message
  );
  // The retired tag's alias is free to reuse while it stays retired...
  const reuseAlias = await call('POST', '/admin/tags', adminCookie, { name: 'Security Cameras', facet: 'keyword', aliases: ['CCTV'] });
  record(reuseAlias.status === 201, 'a retired tag\'s alias can be reused by a new tag', String(reuseAlias.status));
  // ...but that then blocks reactivating the retired one.
  const blockedReactivate = await call('PATCH', `/admin/tags/${cctvId}/reactivate`, adminCookie);
  record(blockedReactivate.status === 409 && blockedReactivate.json.error.code === 'DUPLICATE_TAG', 'reactivating is blocked when its alias has since been taken', String(blockedReactivate.status));
  await Tag.updateOne({ name: 'Security Cameras' }, { retired: true });
  const reactivate = await call('PATCH', `/admin/tags/${cctvId}/reactivate`, adminCookie);
  record(reactivate.status === 200 && reactivate.json.data.retired === false, 'a retired tag can be reactivated once nothing collides', String(reactivate.status));
  record((await call('GET', '/tags')).json.data.some((t: any) => t._id === cctvId), 'a reactivated tag is back in the public list');
  record((await call('POST', `/admin/tags/${cctvId}/merge`, adminCookie, {})).status === 404, 'there is no merge endpoint (duplicates are retired, never merged)');

  // ---------------------------------------------------- AI tagger + synonyms
  const beforeCount = await Tag.countDocuments({});
  const viaAlias = await findOrCreateAiTag('cctv', 'category');
  record(viaAlias._id.toString() === cctvId && (await Tag.countDocuments({})) === beforeCount, 'AI proposing a known SYNONYM reuses the existing tag instead of creating a duplicate');
  const viaPunctuation = await findOrCreateAiTag('  Bridge-&-Road construction ', 'keyword');
  record(viaPunctuation._id.toString() === bridgeId, 'AI proposal matches ignoring case/punctuation, and the existing facet wins');
  const viaSiteAlias = await findOrCreateAiTag('SAMPLE', 'keyword');
  record(viaSiteAlias._id.toString() !== siteTag._id.toString() && viaSiteAlias.facet === 'keyword', 'AI proposals never resolve to a SITE tag');
  const prompt = buildUserPrompt({ title: 't', documentText: 'd' } as any, [
    { id: 'a1', name: 'Camera tag', facet: 'keyword', aliases: ['CCTV', 'security camera'] },
    { id: 'b2', name: 'Plain tag', facet: 'category' }
  ]);
  record(prompt.includes('a1: Camera tag (keyword) -- also known as: CCTV, security camera'), 'AI prompt lists a tag\'s synonyms as hints');
  record(prompt.includes('b2: Plain tag (category)') && !prompt.includes('Plain tag (category) --'), 'AI prompt has no hint clause for a tag without synonyms');

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
