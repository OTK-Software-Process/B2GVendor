import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env';
import { mailTransportOptions } from '../../src/services/email.service';
import { describeMongoUri, mongoUriProblems, smtpTransportOptions } from '../../src/config/transportSecurity';

// Encrypted, authenticated connections to MongoDB and the mail server (ASVS V12.3.1,
// V13.2.1; docs/Security.md section 1). With REQUIRE_SECURE_BACKENDS the process
// refuses a MongoDB address that has no login or no TLS, and the mail transport
// never falls back to plain text.
// Run: npm run check:transport-security

const backendRoot = path.resolve(__dirname, '..', '..');
const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ------------------------------------------------------------------ MongoDB addresses

function checkMongoUris(): void {
  const good = 'mongodb://b2g_api:s3cret@mongo:27017/b2gvendor?tls=true&tlsCAFile=/run/secrets/mongo_ca_pem';
  record(mongoUriProblems(good).length === 0, 'a MongoDB address with a login and tls=true is accepted');
  record(mongoUriProblems('mongodb+srv://u:p@cluster0.example.mongodb.net/b2gvendor').length === 0, 'an Atlas (mongodb+srv) address is accepted: it is encrypted by default');

  const noLogin = mongoUriProblems('mongodb://mongo:27017/b2gvendor?tls=true');
  record(noLogin.length === 1 && /no username and password/.test(noLogin[0]), 'an address with no login is refused', noLogin.join('; '));
  const noPassword = mongoUriProblems('mongodb://b2g_api@mongo:27017/b2gvendor?tls=true');
  record(noPassword.some(p => /no username and password/.test(p)), 'a username without a password is refused');
  const noTls = mongoUriProblems('mongodb://b2g_api:s3cret@mongo:27017/b2gvendor');
  record(noTls.length === 1 && /does not use TLS/.test(noTls[0]), 'an address with a login but no TLS is refused', noTls.join('; '));
  record(mongoUriProblems('mongodb://u:p@mongo/b2gvendor?tls=false').some(p => /TLS/.test(p)), 'tls=false is refused');
  record(mongoUriProblems('mongodb+srv://u:p@cluster0.example.mongodb.net/b?tls=false').some(p => /TLS/.test(p)), 'tls=false on a mongodb+srv address is refused too');
  record(mongoUriProblems('mongodb://u:p@mongo/b2gvendor?ssl=true').length === 0, 'the older name ssl=true counts as TLS');
  record(mongoUriProblems('mongodb://u:p@mongo/b2gvendor?TLS=TRUE').length === 0, 'option names and values are not case-sensitive');

  for (const option of ['tlsInsecure=true', 'tlsAllowInvalidCertificates=true', 'tlsAllowInvalidHostnames=true', 'sslValidate=false']) {
    const problems = mongoUriProblems(`mongodb://u:p@mongo/b2gvendor?tls=true&${option}`);
    record(problems.some(p => p.includes('switches certificate checking off')), `${option} is refused: it switches certificate checking off`);
  }

  record(mongoUriProblems('postgres://u:p@db/x').length === 1, 'something that is not a MongoDB address is refused');
  const multi = describeMongoUri('mongodb://u:p@a:27017,b:27017,c:27017/b2g?replicaSet=rs0&tls=true');
  record(multi !== null && multi.hasCredentials && multi.tls, 'a replica-set address with several hosts is read correctly');

  const withSecret = mongoUriProblems('mongodb://b2g_api:HUNTER2SECRET@mongo:27017/b2gvendor').join(' ');
  record(!withSecret.includes('HUNTER2SECRET'), 'a refusal never contains the password');
}

// ------------------------------------------------- starting the process (config/env.ts)

function importEnvInChild(overrides: Record<string, string | undefined>, dir: string): { status: number | null; stdout: string; stderr: string } {
  const emptyDotenv = path.join(dir, 'empty.env');
  writeFileSync(emptyDotenv, '');
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: emptyDotenv, NODE_ENV: 'test' };
  for (const name of ['MONGODB_URI', 'MONGODB_URI_FILE', 'REQUIRE_SECURE_BACKENDS', 'SMTP_PASS', 'SMTP_PASS_FILE', 'SMTP_HOST']) delete childEnv[name];
  Object.assign(childEnv, overrides);
  const run = spawnSync(
    path.join(backendRoot, 'node_modules', '.bin', 'tsx'),
    // (with `-e` the module's exports can sit under `default`)
    ['-e', "import('./src/config/env').then(m => { const e = m.env ?? m.default.env; console.log('OK uri=' + e.MONGODB_URI + ' pass=' + (e.SMTP_PASS ?? '')); })"],
    { cwd: backendRoot, env: childEnv, encoding: 'utf8', timeout: 60_000 }
  );
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function checkStartup(dir: string): void {
  const good = 'mongodb://b2g_api:s3cret@mongo:27017/b2gvendor?tls=true';

  const off = importEnvInChild({ MONGODB_URI: 'mongodb://localhost:27017/b2gvendor' }, dir);
  record(off.status === 0, 'REQUIRE_SECURE_BACKENDS off: a plain, login-less local MongoDB address still starts (development)', off.stderr.slice(0, 120));

  const noLogin = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI: 'mongodb://mongo:27017/b2gvendor' }, dir);
  record(noLogin.status !== 0 && /no username and password/.test(noLogin.stderr), 'REQUIRE_SECURE_BACKENDS on: a MongoDB address with no login stops the process at start-up');

  const noTls = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI: 'mongodb://b2g_api:s3cret@mongo:27017/b2gvendor' }, dir);
  record(noTls.status !== 0 && /does not use TLS/.test(noTls.stderr), 'REQUIRE_SECURE_BACKENDS on: a MongoDB address with no TLS stops the process at start-up');
  record(!noTls.stderr.includes('s3cret') && !noTls.stdout.includes('s3cret'), 'and the refusal does not print the password');

  const insecure = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI: good + '&tlsAllowInvalidCertificates=true' }, dir);
  record(insecure.status !== 0 && /switches certificate checking off/.test(insecure.stderr), 'REQUIRE_SECURE_BACKENDS on: switching certificate checking off stops the process');

  const ok = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI: good }, dir);
  record(ok.status === 0 && ok.stdout.includes('OK uri=' + good), 'REQUIRE_SECURE_BACKENDS on: a MongoDB address with a login and TLS starts');

  // the same address, but delivered as a file (docker-compose.prod.yml)
  const uriFile = path.join(dir, 'mongo_uri');
  writeFileSync(uriFile, good + '\n');
  const fromFile = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI_FILE: uriFile }, dir);
  record(fromFile.status === 0 && fromFile.stdout.includes('OK uri=' + good + ' '), 'MONGODB_URI_FILE: the address is read from the file, and the checks apply to it');

  const badFile = path.join(dir, 'mongo_uri_bad');
  writeFileSync(badFile, 'mongodb://mongo:27017/b2gvendor\n');
  const badFromFile = importEnvInChild({ REQUIRE_SECURE_BACKENDS: 'true', MONGODB_URI_FILE: badFile }, dir);
  record(badFromFile.status !== 0 && /no username and password/.test(badFromFile.stderr), 'an insecure address inside a secret file is refused the same way');

  const both = importEnvInChild({ MONGODB_URI: good, MONGODB_URI_FILE: uriFile }, dir);
  record(both.status !== 0 && /both set/.test(both.stderr), 'a secret given as a variable AND as a file stops the process');

  const missing = importEnvInChild({ MONGODB_URI_FILE: path.join(dir, 'nope') }, dir);
  record(missing.status !== 0 && /cannot read/.test(missing.stderr), 'a secret file that does not exist stops the process: a service never starts without a secret it was given');

  const smtpFile = path.join(dir, 'smtp_pass');
  writeFileSync(smtpFile, 'smtp-secret-value\n');
  const smtp = importEnvInChild({ MONGODB_URI: good, SMTP_PASS_FILE: smtpFile }, dir);
  record(smtp.status === 0 && smtp.stdout.includes('pass=smtp-secret-value'), 'SMTP_PASS_FILE: the password is read from the file');
}

// --------------------------------------------------------- the mail transport options

function checkTransportOptions(): void {
  const settings = { host: 'smtp.example.com', user: 'mailer', pass: 'pw' };

  const dev = smtpTransportOptions({ ...settings, port: 587 }, { requireSecure: false });
  record(dev.requireTLS === false && dev.secure === false, 'development, port 587: STARTTLS is used when offered, not required');
  const prod587 = smtpTransportOptions({ ...settings, port: 587 }, { requireSecure: true });
  record(prod587.requireTLS === true && prod587.secure === false, 'REQUIRE_SECURE_BACKENDS, port 587: STARTTLS is mandatory');
  const prod465 = smtpTransportOptions({ ...settings, port: 465 }, { requireSecure: true });
  record(prod465.secure === true, 'port 465 is TLS from the first byte');
  const defaultPort = smtpTransportOptions({ host: 'smtp.example.com' }, { requireSecure: true });
  record(defaultPort.port === 587 && defaultPort.requireTLS === true && defaultPort.auth === undefined, 'no port given: 587 with mandatory STARTTLS, and no login when there are no credentials');
  const port25 = smtpTransportOptions({ ...settings, port: 25 }, { requireSecure: true });
  record(port25.requireTLS === true, 'port 25 with REQUIRE_SECURE_BACKENDS also requires STARTTLS');
  for (const options of [dev, prod587, prod465]) {
    const tlsOptions = options.tls as tls.ConnectionOptions;
    if (tlsOptions.minVersion !== 'TLSv1.2' || tlsOptions.rejectUnauthorized !== true) {
      record(false, 'TLS is always 1.2 or newer, with the certificate checked', JSON.stringify(tlsOptions));
      return;
    }
  }
  record(true, 'whenever TLS is used it is TLS 1.2 or newer and the server certificate is checked');
  const proxied = smtpTransportOptions({ ...settings, port: 587 }, { requireSecure: true, proxy: 'http://proxy:3128' });
  record(proxied.proxy === 'http://proxy:3128' && proxied.requireTLS === true, 'through the egress proxy the TLS rules still apply');
}

// The mail service reads the same settings the process runs with, so REQUIRE_SECURE_BACKENDS
// reaches the transport it really creates (not only the helper above).
function checkEmailServiceWiring(): void {
  const settings = env as unknown as Record<string, unknown>;
  const saved = { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.REQUIRE_SECURE_BACKENDS };
  try {
    settings.SMTP_HOST = undefined;
    record(mailTransportOptions() === null, 'email service: no SMTP_HOST means no mail transport');

    settings.SMTP_HOST = 'smtp.example.com';
    settings.SMTP_PORT = 587;
    settings.REQUIRE_SECURE_BACKENDS = false;
    record(mailTransportOptions()?.requireTLS === false, 'email service: REQUIRE_SECURE_BACKENDS off -> STARTTLS not mandatory');
    settings.REQUIRE_SECURE_BACKENDS = true;
    const secured = mailTransportOptions();
    record(secured?.requireTLS === true && (secured.tls as tls.ConnectionOptions).minVersion === 'TLSv1.2', 'email service: REQUIRE_SECURE_BACKENDS on -> STARTTLS mandatory, TLS 1.2 or newer');
    settings.SMTP_PORT = 465;
    record(mailTransportOptions()?.secure === true, 'email service: port 465 -> TLS from the first byte');
  } finally {
    settings.SMTP_HOST = saved.host;
    settings.SMTP_PORT = saved.port;
    settings.REQUIRE_SECURE_BACKENDS = saved.secure;
  }
}

// ---------------------------------------------------- the mail transport on the wire

interface SmtpTrace {
  /** Every command line received, tagged with whether it arrived in the clear or inside TLS. */
  lines: { secure: boolean; text: string }[];
  /** Raw bytes that arrived before any TLS. */
  clearBytes: string;
  protocols: string[];
  delivered: boolean;
}

// A small SMTP server that records what the client sent. `starttls` offers the
// upgrade; `implicit` makes the whole connection TLS.
function startSmtpServer(options: { starttls?: { key: string; cert: string }; implicit?: { key: string; cert: string } }): Promise<{ port: number; trace: SmtpTrace; close: () => Promise<void> }> {
  const trace: SmtpTrace = { lines: [], clearBytes: '', protocols: [], delivered: false };

  // `greet` is false right after STARTTLS: the client speaks next, the server does not greet again.
  const converse = (socket: net.Socket | tls.TLSSocket, secure: boolean, greet = true): void => {
    let buffer = '';
    let inData = false;
    socket.on('error', () => undefined);
    socket.on('data', chunk => {
      if (!secure) trace.clearBytes += chunk.toString('latin1');
      buffer += chunk.toString('latin1');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            trace.delivered = true;
            socket.write('250 queued\r\n');
          }
          continue;
        }
        trace.lines.push({ secure, text: line.startsWith('AUTH') ? 'AUTH ...' : line });
        if (/^(EHLO|HELO)/i.test(line)) {
          const capabilities = ['250-localhost', ...(options.starttls && !secure ? ['250-STARTTLS'] : []), '250 AUTH PLAIN LOGIN'];
          socket.write(capabilities.join('\r\n') + '\r\n');
        } else if (/^STARTTLS/i.test(line) && options.starttls && !secure) {
          socket.write('220 ready to start TLS\r\n');
          socket.removeAllListeners('data');
          const upgraded = new tls.TLSSocket(socket as net.Socket, { isServer: true, key: options.starttls.key, cert: options.starttls.cert, minVersion: 'TLSv1.2' });
          let noted = false;
          const noteProtocol = (): void => {
            if (noted) return;
            noted = true;
            trace.protocols.push(upgraded.getProtocol() ?? '');
          };
          upgraded.on('secure', noteProtocol);
          upgraded.on('secureConnect', noteProtocol);
          converse(upgraded, true, false);
        } else if (/^STARTTLS/i.test(line)) {
          // a server that does not offer it (or already upgraded) answers like a real one
          socket.write('502 5.5.1 STARTTLS not available\r\n');
        } else if (/^AUTH/i.test(line)) socket.write('235 ok\r\n');
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
    if (greet) socket.write('220 localhost ESMTP\r\n');
  };

  const server: net.Server = options.implicit
    ? tls.createServer({ key: options.implicit.key, cert: options.implicit.cert, minVersion: 'TLSv1.2' }, socket => {
        trace.protocols.push(socket.getProtocol() ?? '');
        converse(socket, true);
      })
    : net.createServer(socket => converse(socket, false));

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        trace,
        close: () => new Promise<void>(done => server.close(() => done()))
      })
    );
  });
}

function makeCertificate(dir: string, name: string, subjectAltName: string): { key: string; cert: string } | null {
  const keyFile = path.join(dir, `${name}.key`);
  const certFile = path.join(dir, `${name}.crt`);
  const run = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', `/CN=${name}`, '-addext', `subjectAltName=${subjectAltName}`], { encoding: 'utf8' });
  if (run.status !== 0) return null;
  return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
}

async function send(options: ReturnType<typeof smtpTransportOptions>): Promise<string | null> {
  const transporter = nodemailer.createTransport({ ...options, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 });
  try {
    await transporter.sendMail({ from: 'noreply@example.test', to: 'vendor@example.test', subject: 'check', text: 'hello' });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    transporter.close();
  }
}

async function checkMailOnTheWire(dir: string): Promise<void> {
  const credentials = { user: 'mailer', pass: 'PLAINTEXT-PASSWORD-123' };
  const base = (port: number) => ({ host: '127.0.0.1', port, ...credentials });
  const base64Credentials = Buffer.from(`\u0000${credentials.user}\u0000${credentials.pass}`).toString('base64');

  // 1. a server with no STARTTLS: the hardened transport must not send a thing
  const plain = await startSmtpServer({});
  const refused = await send(smtpTransportOptions(base(plain.port), { requireSecure: true }));
  record(refused !== null, 'REQUIRE_SECURE_BACKENDS: a mail server that offers no TLS makes the send fail', refused ?? 'sent');
  record(!plain.trace.delivered, 'and the message is never delivered in the clear');
  record(!plain.trace.lines.some(l => /^(AUTH|MAIL|RCPT|DATA)/i.test(l.text)), 'nor are the login, the sender or the recipient sent in the clear', plain.trace.lines.map(l => l.text).join(' | '));
  record(!plain.trace.clearBytes.includes(base64Credentials) && !plain.trace.clearBytes.includes(credentials.pass), 'the password never crosses the wire unencrypted');
  await plain.close();

  // development keeps working with a local mail catcher that has no TLS
  const catcher = await startSmtpServer({});
  const sentInClear = await send(smtpTransportOptions(base(catcher.port), { requireSecure: false }));
  record(sentInClear === null && catcher.trace.delivered, 'without REQUIRE_SECURE_BACKENDS (development) a plain local mail catcher still works', sentInClear ?? '');
  await catcher.close();

  const certificate = makeCertificate(dir, 'localhost', 'IP:127.0.0.1,DNS:localhost');
  if (!certificate) {
    console.log('(openssl is not available: the TLS delivery checks are skipped)');
    return;
  }
  const trusting = (options: ReturnType<typeof smtpTransportOptions>, port: number, cert: string) => ({ ...options, port, tls: { ...(options.tls as tls.ConnectionOptions), ca: [cert] } });

  // 2. STARTTLS offered: used, mandatory, and TLS 1.2 or newer
  const starttls = await startSmtpServer({ starttls: certificate });
  const upgraded = await send(trusting(smtpTransportOptions(base(587), { requireSecure: true }), starttls.port, certificate.cert));
  record(upgraded === null && starttls.trace.delivered, 'REQUIRE_SECURE_BACKENDS: a server that offers STARTTLS gets the message, after the upgrade', upgraded ?? '');
  record(!starttls.trace.lines.some(l => !l.secure && /^(AUTH|MAIL|RCPT|DATA)/i.test(l.text)), 'the login, sender, recipient and message all travel inside TLS', starttls.trace.lines.filter(l => !l.secure).map(l => l.text).join(' | '));
  record(!starttls.trace.clearBytes.includes(credentials.pass), 'the password is not in the bytes that crossed before TLS started');
  record(starttls.trace.protocols.length === 1 && /^TLSv1\.[23]$/.test(starttls.trace.protocols[0]), 'the connection negotiated TLS 1.2 or newer', starttls.trace.protocols.join(','));
  await starttls.close();

  // 3. implicit TLS (port 465 style)
  const implicit = await startSmtpServer({ implicit: certificate });
  const wrapped = await send(trusting(smtpTransportOptions(base(465), { requireSecure: true }), implicit.port, certificate.cert));
  record(wrapped === null && implicit.trace.delivered && implicit.trace.clearBytes === '', 'implicit TLS (port 465): the whole conversation is encrypted, nothing crosses in the clear', wrapped ?? '');
  record(implicit.trace.protocols.length === 1 && /^TLSv1\.[23]$/.test(implicit.trace.protocols[0]), 'implicit TLS negotiated TLS 1.2 or newer', implicit.trace.protocols.join(','));
  await implicit.close();

  // 4. a certificate for another host name is refused, even though it is trusted: no insecure fallback
  const wrongHost = makeCertificate(dir, 'other', 'DNS:other.example.test');
  if (wrongHost) {
    const mismatch = await startSmtpServer({ implicit: wrongHost });
    const refusedMismatch = await send(trusting(smtpTransportOptions(base(465), { requireSecure: true }), mismatch.port, wrongHost.cert));
    record(refusedMismatch !== null && !mismatch.trace.delivered && /altnames|does not match|Hostname\/IP/i.test(refusedMismatch), 'a certificate that is not valid for the mail server\'s host name is refused', refusedMismatch ?? 'sent');
    await mismatch.close();
  }

  // 5. an untrusted (self-signed, unknown) certificate is refused
  const untrusted = await startSmtpServer({ implicit: certificate });
  const refusedUntrusted = await send({ ...smtpTransportOptions(base(465), { requireSecure: true }), port: untrusted.port });
  record(refusedUntrusted !== null && !untrusted.trace.delivered && /self.signed|unable to verify|certificate/i.test(refusedUntrusted), 'a certificate from an authority the system does not trust is refused', refusedUntrusted ?? 'sent');
  await untrusted.close();
}

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'b2g-transport-'));
  try {
    checkMongoUris();
    checkStartup(dir);
    checkTransportOptions();
    checkEmailServiceWiring();
    await checkMailOnTheWire(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('check failed to run', err);
  process.exit(2);
});
