import mongoose from 'mongoose';

const MONGODB_URI = process.env.CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/b2gvendor-tag-lifecycle-check';
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, '');
if (!/check/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" doesn't contain "check" and this script drops it.`);
  process.exit(2);
}
process.env.MONGODB_URI = MONGODB_URI;

const PASSWORD = 'Password123';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

async function main(): Promise<void> {
  const [
    { createApp },
    { Account },
    { AuditLog },
    { GovSite },
    { Follow },
    { Tag },
    { Work },
    { SESSION_COOKIE_NAME }
  ] = await Promise.all([
    import('../../src/app'),
    import('../../src/models/account.model'),
    import('../../src/models/auditLog.model'),
    import('../../src/models/govSite.model'),
    import('../../src/models/follow.model'),
    import('../../src/models/tag.model'),
    import('../../src/models/work.model'),
    import('../../src/config/cookie')
  ]);

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

  async function makeAccount(email: string, role: 'user' | 'admin' | 'superadmin') {
    return Account.create({
      email,
      passwordHash: PASSWORD,
      name: email,
      type: 'individual',
      status: 'active',
      role,
      permissions: role === 'admin' ? ['tag:manage'] : []
    });
  }

  async function loginCookie(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    const first = res.setCookie?.split(';')[0] ?? '';
    if (!first.startsWith(`${SESSION_COOKIE_NAME}=`)) throw new Error(`login failed for ${email}`);
    return first;
  }

  await makeAccount('admin@example.com', 'admin');
  await makeAccount('superadmin@example.com', 'superadmin');
  const adminCookie = await loginCookie('admin@example.com');
  const superCookie = await loginCookie('superadmin@example.com');

  const createdTags = new Map<string, string>();
  for (const [facet, name] of [
    ['agency', 'กรมทดสอบ'],
    ['method', 'วิธีทดสอบ'],
    ['category', 'งานก่อสร้าง'],
    ['keyword', 'Road Safety']
  ] as const) {
    const response = await call('POST', '/admin/tags', adminCookie, { name, facet });
    const tagId = response.json?.data?._id;
    record(response.status === 201 && response.json.data.facet === facet, `create ${facet} tag`, String(response.status));
    if (tagId) {
      createdTags.set(facet, tagId);
      const log = await AuditLog.findOne({ entityType: 'tag', entityId: tagId, action: 'tag.create' }).lean();
      record(!!log, `audit log records ${facet} tag creation`);
    }
  }

  const siteResponse = await call('POST', '/admin/gov-sites', superCookie, {
    name: 'Test Government Site',
    shortCode: 'TST',
    deptId: 'tag-lifecycle-check'
  });
  const site = siteResponse.json?.data;
  const siteTag = site ? await Tag.findOne({ siteId: site._id, facet: 'site' }) : null;
  record(siteResponse.status === 201 && !!siteTag, 'create site facet through government-site setup', String(siteResponse.status));
  if (siteTag) {
    createdTags.set('site', siteTag._id.toString());
    const log = await AuditLog.findOne({ entityType: 'tag', entityId: siteTag._id.toString(), action: 'tag.create' }).lean();
    record(!!log, 'audit log records automatic site-tag creation');
  }

  const facetNames = (await call('GET', '/tags')).json?.data?.map((tag: { facet: string }) => tag.facet) ?? [];
  record(
    ['site', 'agency', 'method', 'category', 'keyword'].every(facet => facetNames.includes(facet)),
    'all tag facets are represented in the public taxonomy',
    facetNames.join(', ')
  );

  const keywordId = createdTags.get('keyword')!;
  const thaiTagId = createdTags.get('category')!;
  const caseDuplicate = await call('POST', '/admin/tags/check-duplicates', adminCookie, {
    name: 'rOaD   sAfEtY',
    facet: 'keyword'
  });
  record(
    caseDuplicate.status === 200 && caseDuplicate.json.data.exact.some((tag: { tagId: string }) => tag.tagId === keywordId),
    'check-duplicates flags case and spacing variations as exact duplicates'
  );
  const thaiSpacing = await call('POST', '/admin/tags/check-duplicates', adminCookie, {
    name: 'งาน ก่อสร้าง',
    facet: 'category'
  });
  record(
    thaiSpacing.status === 200 && thaiSpacing.json.data.exact.some((tag: { tagId: string }) => tag.tagId === thaiTagId),
    'check-duplicates flags Thai spacing variations as exact duplicates'
  );
  const thaiNearDuplicate = await call('POST', '/admin/tags/check-duplicates', adminCookie, {
    name: 'งานก่อสร้า',
    facet: 'category'
  });
  record(
    thaiNearDuplicate.status === 200 && thaiNearDuplicate.json.data.similar.some((tag: { tagId: string }) => tag.tagId === thaiTagId),
    'check-duplicates flags near-duplicate Thai names'
  );

  const vendor = await makeAccount('vendor@example.com', 'user');
  const vendorCookie = await loginCookie(vendor.email);
  const work = await Work.create({
    siteId: site._id,
    projectId: 'TAG-LIFECYCLE-1',
    title: 'Tag lifecycle test work',
    status: 'BIDDING',
    announceType: 'B0',
    statusHistory: [{ status: 'BIDDING', announceType: 'B0' }],
    tags: [siteTag!._id, thaiTagId]
  });

  const follow = await call('POST', `/follows/tags/${thaiTagId}`, vendorCookie);
  record(follow.status === 200, 'a user can follow an active tag', String(follow.status));
  const followedBeforeRetire = await call('GET', '/follows/tags', vendorCookie);
  record(followedBeforeRetire.json.data.some((tag: { _id: string }) => tag._id === thaiTagId), 'active followed tag appears in follows');

  const retire = await call('PATCH', `/admin/tags/${thaiTagId}/retire`, adminCookie);
  record(retire.status === 200 && retire.json.data.retired === true, 'admin can retire a tag', String(retire.status));
  const retireLog = await AuditLog.findOne({ entityType: 'tag', entityId: thaiTagId, action: 'tag.retire' }).lean();
  record(!!retireLog, 'audit log records tag retirement');

  const followedAfterRetire = await call('GET', '/follows/tags', vendorCookie);
  record(!followedAfterRetire.json.data.some((tag: { _id: string }) => tag._id === thaiTagId), 'retired tag disappears from follows');
  record(await Follow.exists({ accountId: vendor._id, tagId: thaiTagId }), 'retirement preserves the follow record as history');
  const publicCategories = await call('GET', '/tags?facet=category');
  record(!publicCategories.json.data.some((tag: { _id: string }) => tag._id === thaiTagId), 'retired tag disappears from public tag filters');

  const filteredWorks = await call('GET', `/works?tag=${thaiTagId}`);
  record(filteredWorks.status === 200 && filteredWorks.json.data.total === 0, 'retired tag no longer matches public work search filters');
  const workAfterRetire = await Work.findById(work._id);
  record(workAfterRetire?.tags.some(id => id.equals(thaiTagId)), 'retirement preserves the tag on its existing work');
  const adminRetiredTags = await call('GET', '/admin/tags?facet=category&includeRetired=true', adminCookie);
  record(adminRetiredTags.json.data.some((tag: { _id: string; retired: boolean }) => tag._id === thaiTagId && tag.retired), 'admin history retains the retired tag');

  const reactivate = await call('PATCH', `/admin/tags/${thaiTagId}/reactivate`, adminCookie);
  record(reactivate.status === 200 && reactivate.json.data.retired === false, 'admin can reactivate a tag', String(reactivate.status));
  const reactivateLog = await AuditLog.findOne({ entityType: 'tag', entityId: thaiTagId, action: 'tag.reactivate' }).lean();
  record(!!reactivateLog, 'audit log records tag reactivation');
  record((await call('GET', '/tags?facet=category')).json.data.some((tag: { _id: string }) => tag._id === thaiTagId), 'reactivated tag returns to public filters');
  record((await call('GET', '/follows/tags', vendorCookie)).json.data.some((tag: { _id: string }) => tag._id === thaiTagId), 'reactivated followed tag returns to follows');

  const reassignment = await call('PUT', `/admin/works/${work._id}/tags`, adminCookie, {
    tagIds: [createdTags.get('method')]
  });
  record(reassignment.status === 200, 'admin can reassign work tags with PUT /admin/works/:id/tags', String(reassignment.status));
  const updatedWork = await Work.findById(work._id);
  record(
    !!updatedWork &&
      updatedWork.tags.some(id => id.equals(siteTag!._id)) &&
      updatedWork.tags.some(id => id.equals(createdTags.get('method')!)) &&
      !updatedWork.tags.some(id => id.equals(thaiTagId)),
    'tag reassignment updates the work while preserving its site tag'
  );
  const workAudit = await AuditLog.findOne({
    entityType: 'work',
    entityId: work._id.toString(),
    action: 'work.tags_update'
  }).lean();
  record(
    !!workAudit &&
      (workAudit.metadata?.tagsAdded as { name: string }[])?.some(tag => tag.name === 'วิธีทดสอบ') &&
      (workAudit.metadata?.tagsRemoved as { name: string }[])?.some(tag => tag.name === 'งานก่อสร้าง'),
    'audit log records tag reassignment and added/removed tag names'
  );

  const merge = await call('POST', `/admin/tags/${thaiTagId}/merge`, adminCookie, {});
  record(merge.status === 404, 'tags are never merged; the merge endpoint does not exist', String(merge.status));

  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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
