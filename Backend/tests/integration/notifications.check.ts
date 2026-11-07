import { createServer } from 'node:net';
import type { Server } from 'node:net';
import type { Server as HttpServer } from 'node:http';

const PASSWORD = 'Password123';
const MONGODB_URI = process.env.CHECK_MONGODB_URI
  ?? 'mongodb://127.0.0.1:27017/b2gvendor-notifications-check';
const results: string[] = [];

function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -> ${detail}` : ''}`);
}

async function startSmtp(): Promise<{ server: Server; port: number; messages: string[] }> {
  const messages: string[] = [];
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let currentMessage = '';
    let readingMessage = false;

    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);

        if (readingMessage) {
          if (line === '.') {
            messages.push(currentMessage);
            currentMessage = '';
            readingMessage = false;
            socket.write('250 Message accepted\r\n');
          } else {
            currentMessage += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          }
          continue;
        }

        const command = line.split(' ', 1)[0].toUpperCase();
        if (command === 'EHLO' || command === 'HELO') {
          socket.write('250-localhost\r\n250 SIZE 10485760\r\n');
        } else if (command === 'DATA') {
          readingMessage = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP test server did not bind to a TCP port.');
  return { server, port: address.port, messages };
}

async function closeServer(server: Server | HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function htmlBody(message: string): string {
  const htmlPartStart = message.search(/content-type:\s*text\/html\b/i);
  if (htmlPartStart < 0) return '';

  const bodyStart = message.indexOf('\r\n\r\n', htmlPartStart);
  if (bodyStart < 0) return '';

  const nextBoundary = message.indexOf('\r\n--', bodyStart + 4);
  const body = message.slice(bodyStart + 4, nextBoundary < 0 ? undefined : nextBoundary);
  const headers = message.slice(htmlPartStart, bodyStart);

  if (/content-transfer-encoding:\s*base64/i.test(headers)) {
    return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
    const binary = body
      .replace(/=\r?\n/g, '')
      .replace(/=([a-f\d]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(binary, 'binary').toString('utf8');
  }
  return body;
}

async function main(): Promise<void> {
  const smtp = await startSmtp();
  process.env.MONGODB_URI = MONGODB_URI;
  process.env.BCRYPT_ROUNDS = '10';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  let server: HttpServer | undefined;
  let mongoose: typeof import('mongoose') | undefined;
  try {
    const mongooseModule = await import('mongoose');
    mongoose = mongooseModule.default;
    await mongoose.connect(MONGODB_URI);
    await mongoose.connection.dropDatabase();

    const [
      { createApp },
      { Account },
      { Follow },
      { GovSite },
      { Notification },
      { Tag },
      { Work },
      { SESSION_COOKIE_NAME },
      { notifyNewWorkMatches, sendDailyDigests }
    ] = await Promise.all([
      import('../../src/app'),
      import('../../src/models/account.model'),
      import('../../src/models/follow.model'),
      import('../../src/models/govSite.model'),
      import('../../src/models/notification.model'),
      import('../../src/models/tag.model'),
      import('../../src/models/work.model'),
      import('../../src/config/cookie'),
      import('../../src/services/notification.service')
    ]);

    const app = createApp();
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/v1`;

    async function call(method: string, path: string, cookie?: string, body?: unknown) {
      const response = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const json: any = await response.json().catch(() => null);
      return { status: response.status, json, setCookie: response.headers.get('set-cookie') };
    }

    async function makeAccount(
      email: string,
      options: { name?: string; emailVerified?: boolean; emailNotificationsEnabled?: boolean; notificationFrequency?: 'instant' | 'daily' } = {}
    ) {
      return Account.create({
        email,
        passwordHash: PASSWORD,
        name: options.name ?? email,
        type: 'individual',
        status: 'active',
        role: 'user',
        emailVerified: options.emailVerified ?? true,
        emailNotificationsEnabled: options.emailNotificationsEnabled ?? true,
        notificationFrequency: options.notificationFrequency ?? 'instant'
      });
    }

    async function loginCookie(email: string): Promise<string> {
      const response = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
      const cookie = response.setCookie?.split(';')[0] ?? '';
      if (!cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) throw new Error(`Login failed for ${email}.`);
      return cookie;
    }

    const instant = await makeAccount('instant@example.com', { name: 'Instant <User>' });
    const daily = await makeAccount('daily@example.com', { name: '<Daily & Co>', notificationFrequency: 'daily' });
    const disabled = await makeAccount('disabled@example.com', { emailNotificationsEnabled: false });
    const unverified = await makeAccount('unverified@example.com', { emailVerified: false });
    const site = await GovSite.create({ name: 'Agency & Friends', shortCode: 'NOTIFY', deptId: 'notify' });
    const roadTag = await Tag.create({ name: 'Roads <North>', facet: 'category' });
    const bridgeTag = await Tag.create({ name: 'Roads & Bridges', facet: 'category' });

    await Follow.create([
      { accountId: instant._id, tagId: roadTag._id },
      { accountId: instant._id, tagId: bridgeTag._id },
      { accountId: daily._id, tagId: roadTag._id },
      { accountId: disabled._id, tagId: roadTag._id },
      { accountId: unverified._id, tagId: roadTag._id }
    ]);

    const firstWork = await Work.create({
      siteId: site._id,
      projectId: 'NOTIFY-001',
      title: '<script>alert(1)</script> Roadwork',
      status: 'BIDDING',
      announceType: 'D0',
      tags: [roadTag._id, bridgeTag._id]
    });
    const secondWork = await Work.create({
      siteId: site._id,
      projectId: 'NOTIFY-002',
      title: 'Bridge maintenance',
      status: 'BIDDING',
      announceType: 'D0',
      tags: [roadTag._id]
    });

    await notifyNewWorkMatches(firstWork, [roadTag._id, bridgeTag._id, roadTag._id]);
    await notifyNewWorkMatches(firstWork, [roadTag._id, bridgeTag._id]);
    await notifyNewWorkMatches(secondWork, [roadTag._id]);

    const firstInstantNotification = await Notification.findOne({ accountId: instant._id, workId: firstWork._id });
    const instantFirstWorkCount = await Notification.countDocuments({ accountId: instant._id, workId: firstWork._id });
    record(
      Boolean(firstInstantNotification) && instantFirstWorkCount === 1,
      'overlapping followed tags and a re-poll create exactly one notification per work and user',
      String(instantFirstWorkCount)
    );
    record(
      firstInstantNotification?.matchedTags.length === 2
        && new Set(firstInstantNotification.matchedTags).size === 2,
      'matching tag names are unique on the notification',
      JSON.stringify(firstInstantNotification?.matchedTags)
    );

    for (const account of [instant, daily, disabled, unverified]) {
      const count = await Notification.countDocuments({ accountId: account._id });
      record(count === 2, `${account.email} receives in-app notifications regardless of email settings`, String(count));
    }

    const instantCookie = await loginCookie(instant.email);
    record((await call('GET', '/notifications')).status === 401, 'notification listing requires login');
    const listed = await call('GET', '/notifications', instantCookie);
    const listedItems = listed.json?.data;
    const listedWorkIds = Array.isArray(listedItems) ? listedItems.map((item: { workId: string }) => item.workId) : [];
    record(
      listed.status === 200 && listedWorkIds.includes(firstWork._id.toString()) && listedWorkIds.includes(secondWork._id.toString()),
      'listing returns each notification with the corresponding work id for its link',
      JSON.stringify(listedWorkIds)
    );

    const firstListed = Array.isArray(listedItems)
      ? listedItems.find((item: { workId: string }) => item.workId === firstWork._id.toString())
      : undefined;
    const readOne = firstListed
      ? await call('PATCH', `/notifications/${firstListed.id}/read`, instantCookie)
      : { status: 0, json: null };
    record(readOne.status === 200 && readOne.json?.data?.read === true, 'marking one notification read succeeds');

    const readAll = await call('POST', '/notifications/read-all', instantCookie);
    const afterReadAll = await call('GET', '/notifications', instantCookie);
    record(
      readAll.status === 200 && readAll.json?.data?.updatedCount === 1
        && afterReadAll.json?.data?.every((item: { read: boolean }) => item.read),
      'read all marks the remaining notifications as read',
      JSON.stringify(readAll.json?.data)
    );

    const digestSent = await sendDailyDigests();
    const digestSentAgain = await sendDailyDigests();
    record(digestSent === 1 && digestSentAgain === 0, 'daily frequency sends one digest and does not resend it', `${digestSent}, then ${digestSentAgain}`);

    const mailFor = (email: string) => smtp.messages.filter(message => message.toLowerCase().includes(email));
    const instantMessages = mailFor(instant.email);
    const dailyMessages = mailFor(daily.email);
    record(instantMessages.length === 2, 'instant frequency sends one email per new work and not on a re-poll', String(instantMessages.length));
    record(dailyMessages.length === 1, 'daily frequency sends one summary email', String(dailyMessages.length));
    record(
      mailFor(disabled.email).length === 0 && mailFor(unverified.email).length === 0,
      'email-disabled and unverified users receive no email'
    );

    const digestHtml = dailyMessages[0] ? htmlBody(dailyMessages[0]) : '';
    record(
      digestHtml.includes('&lt;Daily &amp; Co&gt;')
        && digestHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt; Roadwork'),
      'digest HTML escapes the account name and work title',
      digestHtml ? '' : 'HTML part was missing from captured email'
    );
    record(
      digestHtml.includes(`/works/${firstWork._id}`)
        && digestHtml.includes(`/works/${secondWork._id}`),
      'digest work links point to each matching work'
    );
    record(
      instantMessages.every(message => htmlBody(message).includes('&lt;User&gt;'))
        && instantMessages.some(message => htmlBody(message).includes(`/works/${secondWork._id}`)),
      'instant email escapes the account name and links to its work'
    );
    const unsubscribeToken = instantMessages[0]
      ? htmlBody(instantMessages[0]).match(/\/unsubscribe\/([a-f0-9]{64})/)?.[1]
      : undefined;
    const unsubscribeResponse = unsubscribeToken
      ? await call('POST', '/account/unsubscribe', undefined, { token: unsubscribeToken })
      : { status: 0, json: null };
    const instantAfterUnsubscribe = await Account.findById(instant._id);
    record(
      unsubscribeResponse.status === 200 && instantAfterUnsubscribe?.emailNotificationsEnabled === false,
      'an email unsubscribe token works without login and disables future email notifications'
    );

    console.log(results.join('\n'));
    const failures = results.filter(line => line.startsWith('FAIL')).length;
    console.log(`\n${results.length - failures} passed, ${failures} failed`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    if (server?.listening) await closeServer(server);
    if (mongoose?.connection.readyState) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    await closeServer(smtp.server);
  }
}

main().catch(error => {
  console.error('notification check failed to run', error);
  process.exitCode = 2;
});
