import path from 'node:path';
import os from 'node:os';
import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';

// The production deployment as CONFIGURED (ASVS V3.5.4, V4.1.2, V12.1.1, V12.1.2,
// V12.2.1, V12.2.2, V12.3.1, V13.2.1-V13.2.3, V13.3.1, V13.3.2; docs/Deployment.md).
//
// This reads the files, needs no server and starts no container: the merged compose
// files (what `docker compose` would run), the Dockerfiles, the Caddyfile, the MongoDB
// scripts and the secrets generator. docker/verify-deployment.sh is the one that RUNS
// the stack and probes it (TLS versions, ciphers, redirects, who is root, what each
// MongoDB user may do).
// Run: npm run check:deployment-config

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}
const read = (relative: string): string => readFileSync(path.join(repoRoot, relative), 'utf8');

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; cwd?: string } = {}): SpawnSyncReturns<string> {
  return spawnSync(command, args, { cwd: options.cwd ?? repoRoot, env: options.env ?? process.env, input: options.input, encoding: 'utf8', timeout: 120_000 });
}

// ------------------------------------------------------------------ the merged compose files

interface ComposeService {
  ports?: { host_ip?: string; published?: string | number; target: number }[];
  networks?: Record<string, unknown>;
  secrets?: { source: string }[];
  environment?: Record<string, string | null>;
  command?: string[];
  entrypoint?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  read_only?: boolean;
  privileged?: boolean;
  network_mode?: string;
  pid?: string;
  volumes?: { source?: string; target: string }[];
  sysctls?: Record<string, string>;
  build?: { args?: Record<string, string> };
  healthcheck?: { test: string[] };
  tmpfs?: string[];
}
type Compose = { services: Record<string, ComposeService>; secrets: Record<string, { file: string }> };

const stackEnv = { APP_HOST: 'app.example.test', API_HOST: 'api.example.test', ACME_EMAIL: 'ops@example.test', SECRETS_DIR: '/srv/secrets' };

// `docker compose config` of the base and production files, with the settings given. The base
// file's env_file entries point at Backend/.env and B2GVendor/.env, which hold real credentials
// and may not exist (CI): they are replaced with an empty file, and compose is never asked to
// expand env files into its output (--no-env-resolution).
function composeConfig(dir: string, environment: Record<string, string>): SpawnSyncReturns<string> {
  const empty = path.join(dir, 'empty.env');
  writeFileSync(empty, '');
  const override = path.join(dir, 'override.yml');
  writeFileSync(override, ['services:', ...['backend', 'ingestion-worker', 'frontend'].flatMap(name => [`  ${name}:`, `    env_file: !override ["${empty}"]`])].join('\n') + '\n');

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(stackEnv)) delete env[name];
  Object.assign(env, environment);
  return run('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml', '-f', override, 'config', '--no-env-resolution', '--format', 'json'], { env });
}

function checkCompose(dir: string): void {
  const probe = run('docker', ['compose', 'version']);
  if (probe.status !== 0) {
    console.log('(docker compose is not available: the compose checks are skipped)');
    return;
  }
  // The host names and the ACME email are required, never guessed: leave out each in turn.
  for (const name of Object.keys(stackEnv).filter(variable => variable !== 'SECRETS_DIR')) {
    const others = Object.fromEntries(Object.entries(stackEnv).filter(([variable]) => variable !== name));
    const refused = composeConfig(dir, others);
    record(refused.status !== 0 && new RegExp(`required variable ${name} is missing`).test(refused.stderr), `compose refuses to start without ${name}: it is required, not guessed`, refused.status === 0 ? 'it started' : refused.stderr.slice(0, 90));
  }

  const merged = composeConfig(dir, stackEnv);
  const compose: Compose | null = merged.status === 0 ? (JSON.parse(merged.stdout) as Compose) : null;
  if (!compose) {
    record(false, 'the production compose files merge into a valid configuration', merged.stderr.slice(0, 200));
    return;
  }
  record(true, 'the production compose files merge into a valid configuration');
  const services = compose.services;

  // 1. ports: only the edge is public (V12.2.1: nothing else is reachable without TLS)
  const published: string[] = [];
  for (const [name, service] of Object.entries(services)) for (const port of service.ports ?? []) published.push(`${name}:${port.host_ip ?? ''}:${port.target}`);
  const expectedPorts = ['alertmanager:127.0.0.1:9093', 'edge::443', 'edge::80'].sort();
  record(JSON.stringify(published.sort()) === JSON.stringify(expectedPorts), 'only the edge publishes ports (80 and 443); the one other is Alertmanager, on 127.0.0.1', published.join(' '));

  // 2. nothing privileged, no host namespaces, and the Docker socket only for the log shipper
  const risky = Object.entries(services).filter(([, s]) => s.privileged === true || s.network_mode === 'host' || s.pid === 'host').map(([n]) => n);
  record(risky.length === 0, 'no service is privileged or uses the host network or process namespace', risky.join(','));
  const socketUsers = Object.entries(services).filter(([, s]) => (s.volumes ?? []).some(v => v.source === '/var/run/docker.sock')).map(([n]) => n);
  record(JSON.stringify(socketUsers) === JSON.stringify(['alloy']), 'only Alloy (the log shipper, read-only) mounts the Docker socket', socketUsers.join(','));

  // 3. MongoDB: a login, TLS, no way in from outside
  const mongo = services.mongo;
  const mongoCommand = (mongo.command ?? []).join(' ');
  record(/--auth\b/.test(mongoCommand), 'MongoDB requires authentication (--auth)');
  record(/--tlsMode=requireTLS/.test(mongoCommand), 'MongoDB requires TLS (--tlsMode=requireTLS): no plain connections');
  record(/--tlsDisabledProtocols=TLS1_0,TLS1_1/.test(mongoCommand), 'MongoDB disables TLS 1.0 and 1.1');
  record(/--tlsCertificateKeyFile=/.test(mongoCommand) && /--tlsCAFile=/.test(mongoCommand), 'MongoDB is given a server certificate and its authority');
  record((mongo.ports ?? []).length === 0 && Object.keys(mongo.networks ?? {}).join() === 'internal', 'MongoDB publishes no port and is on the internal network only (no route to the internet)', Object.keys(mongo.networks ?? {}).join());
  record(mongo.environment?.MONGO_INITDB_ROOT_PASSWORD_FILE === '/run/secrets/mongo_root_password' && mongo.environment?.MONGO_INITDB_ROOT_PASSWORD === undefined, 'the MongoDB root password comes from a secret file, not from a value');
  record(mongo.environment?.MONGO_INITDB_ROOT_USERNAME !== 'root' && mongo.environment?.MONGO_INITDB_ROOT_USERNAME !== 'admin', 'the MongoDB root user is not named root or admin (V13.2.3: no default credential)', String(mongo.environment?.MONGO_INITDB_ROOT_USERNAME));
  record(mongo.healthcheck?.test.includes('--tls') === true, 'the MongoDB health check speaks TLS');
  record(mongo.cap_drop?.join() === 'ALL' && (mongo.security_opt ?? []).includes('no-new-privileges:true'), 'MongoDB drops all capabilities except the few its entrypoint needs, and cannot gain privileges', (mongo.cap_add ?? []).join(','));

  // 4. secrets: each service gets exactly what it needs (V13.3.2)
  const secretsOf = (name: string): string => (services[name].secrets ?? []).map(s => s.source).sort().join(' ');
  const expectedSecrets: Record<string, string> = {
    mongo: 'mongo_api_password mongo_ca_pem mongo_root_password mongo_server_pem mongo_worker_password',
    backend: 'data_go_th_api_key mfa_encryption_key mongo_api_uri mongo_ca_pem smtp_pass',
    'ingestion-worker': 'data_go_th_api_key google_credentials mongo_ca_pem mongo_worker_uri openrouter_api_key smtp_pass',
    frontend: '',
    edge: ''
  };
  for (const [name, expected] of Object.entries(expectedSecrets)) {
    record(secretsOf(name) === expected, `${name} is given ${expected === '' ? 'no secret' : 'exactly: ' + expected}`, secretsOf(name));
  }
  const apiUriOnlyForApi = !(services['ingestion-worker'].secrets ?? []).some(s => s.source === 'mongo_api_uri') && !(services.backend.secrets ?? []).some(s => s.source === 'mongo_worker_uri');
  record(apiUriOnlyForApi, 'each service gets only ITS OWN MongoDB address (the API cannot use the worker\'s login, nor the worker the API\'s)');
  record(!['backend', 'ingestion-worker', 'frontend', 'edge'].some(name => (services[name].secrets ?? []).some(s => s.source === 'mongo_root_password')), 'no application service is given the MongoDB root password');
  // The key that protects every authenticator seed goes to the API alone: the worker, the
  // website, the edge and the database never need to read a seed.
  const mfaKeyHolders = Object.entries(services).filter(([, service]) => (service.secrets ?? []).some(s => s.source === 'mfa_encryption_key')).map(([name]) => name);
  record(mfaKeyHolders.join() === 'backend', 'only the API is given the key that encrypts authenticator seeds (mfa_encryption_key)', mfaKeyHolders.join(','));

  // 5. the secret files compose mounts are the ones the generator makes and checks
  const generator = read('docker/secrets/generate.sh');
  const listed = (variable: string): string[] => (new RegExp(`^${variable}="([^"]+)"`, 'm').exec(generator)?.[1] ?? '').split(' ').filter(Boolean).sort();
  const generatorNames = [...listed('generated'), ...listed('provided')].sort();
  const composeNames = Object.keys(compose.secrets).sort();
  record(JSON.stringify(generatorNames) === JSON.stringify(composeNames), 'the secrets compose defines are exactly the ones docker/secrets/generate.sh creates and checks', composeNames.join(' '));
  record(Object.values(compose.secrets).every(secret => secret.file.startsWith('/srv/secrets/')), 'every secret is a file under SECRETS_DIR');

  // 6. the application services: secrets only as files, the secure-backends switch on
  for (const name of ['backend', 'ingestion-worker']) {
    const environment = services[name].environment ?? {};
    record(environment.REQUIRE_SECURE_BACKENDS === 'true', `${name}: REQUIRE_SECURE_BACKENDS=true (no MongoDB without a login and TLS, no mail without TLS)`);
    const direct = ['MONGODB_URI', 'SMTP_PASS', 'OPENROUTER_API_KEY', 'DATA_GO_TH_API_KEY', 'MFA_ENCRYPTION_KEY', 'GOOGLE_APPLICATION_CREDENTIALS_JSON'].filter(variable => variable in environment);
    record(direct.length === 0, `${name}: no secret is passed as a value`, direct.join(','));
    const fileVariables = Object.keys(environment).filter(variable => variable.endsWith('_FILE'));
    const secretNames = new Set((services[name].secrets ?? []).map(s => s.source));
    const dangling = fileVariables.filter(variable => !secretNames.has(String(environment[variable]).replace('/run/secrets/', '')));
    record(fileVariables.length >= 3 && dangling.length === 0, `${name}: every NAME_FILE variable points at a secret this service was given`, dangling.join(','));
    record(environment.APP_URL === 'https://app.example.test', `${name}: APP_URL (the base of every emailed link) is https and the website's host`, String(environment.APP_URL));
  }
  const backendEnvironment = services.backend.environment ?? {};
  record(backendEnvironment.CORS_ORIGIN === 'https://app.example.test', 'the API allows exactly the website\'s origin (CORS_ORIGIN)', String(backendEnvironment.CORS_ORIGIN));
  record(backendEnvironment.COOKIE_SAMESITE === 'lax' && backendEnvironment.NODE_ENV === 'production', 'the session cookie is SameSite=Lax and Secure (production), valid across the sibling hosts');
  record(backendEnvironment.MFA_REQUIRED_FOR_STAFF === 'true' && backendEnvironment.MFA_ENCRYPTION_KEY_FILE === '/run/secrets/mfa_encryption_key', 'the API requires two-step sign-in for staff in production, with its key from a secret file (a value in Backend/.env cannot switch it off)');

  // 7. hardening of what we build and run
  for (const name of ['backend', 'ingestion-worker', 'frontend', 'edge']) {
    const service = services[name];
    record(service.cap_drop?.join() === 'ALL' && (service.security_opt ?? []).includes('no-new-privileges:true') && service.read_only === true, `${name}: every capability dropped, no privilege escalation, read-only file system`);
  }
  const frontend = services.frontend;
  record((frontend.ports ?? []).length === 0 && Object.keys(frontend.networks ?? {}).join() === 'internal', 'the website publishes no port, and has no route to the internet (it is reached only through the edge)');
  record(frontend.build?.args?.NEXT_PUBLIC_API_URL === 'https://api.example.test/api/v1', 'the website is built to call the API at its own https host name', frontend.build?.args?.NEXT_PUBLIC_API_URL);
  record((services.proxy.ports ?? []).length === 0, 'the old localhost:4000 API gateway is not published');

  // 8. the edge
  const edge = services.edge;
  record(edge.environment?.APP_HOST === 'app.example.test' && edge.environment?.API_HOST === 'api.example.test' && edge.environment.APP_HOST !== edge.environment.API_HOST, 'the edge serves the website and the API on different host names');
  record(edge.environment?.TLS_ISSUER === 'ops@example.test', 'by default the edge asks Let\'s Encrypt for certificates (TLS_ISSUER is the ACME email, not "internal")', String(edge.environment?.TLS_ISSUER));
  record(edge.sysctls?.['net.ipv4.ip_unprivileged_port_start'] === '0', 'the edge runs as a normal user yet may bind ports 80 and 443 (unprivileged-port sysctl)');
  record((edge.volumes ?? []).some(v => v.target === '/data') && (edge.volumes ?? []).some(v => v.target === '/etc/caddy/Caddyfile'), 'the edge keeps its certificates in a volume (re-issuing is rate limited) and reads the Caddyfile');
}

// ------------------------------------------------------------------ the Dockerfiles

function finalUser(dockerfile: string): string | null {
  const lines = dockerfile.split('\n');
  let lastFrom = 0;
  lines.forEach((line, index) => {
    if (/^FROM\s/i.test(line.trim())) lastFrom = index;
  });
  const users = lines.slice(lastFrom).map(line => /^USER\s+(\S+)/i.exec(line.trim())?.[1]).filter(Boolean);
  return users.length ? (users[users.length - 1] as string) : null;
}

function checkDockerfiles(): void {
  for (const file of ['Backend/Dockerfile', 'B2GVendor/Dockerfile', 'docker/edge/Dockerfile']) {
    const user = finalUser(read(file));
    record(user !== null && user !== 'root' && user !== '0', `${file}: the image's last stage runs as a user that is not root`, user ?? 'no USER line: root');
  }
  record(/mkdir -p \/app\/storage && chown node:node \/app\/storage/.test(read('Backend/Dockerfile')), 'Backend/Dockerfile: the TOR storage folder belongs to the unprivileged user (a new volume inherits it)');
  record(/mkdir -p \.next\/cache && chown node:node \.next\/cache/.test(read('B2GVendor/Dockerfile')), 'B2GVendor/Dockerfile: Next.js\'s cache folder belongs to the unprivileged user');
  record(/setcap -r \/usr\/bin\/caddy/.test(read('docker/edge/Dockerfile')), 'docker/edge/Dockerfile: the Caddy binary\'s file capability is removed (it would not start with all capabilities dropped)');
}

// ------------------------------------------------------------------ the Caddyfile

function checkCaddyfile(): void {
  const text = read('docker/edge/Caddyfile');
  const code = text.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

  record(/protocols tls1\.2 tls1\.3/.test(code) && !/tls1\.[01]\b/.test(code.replace(/tls1\.[23]/g, '')), 'TLS 1.2 and 1.3 only (V12.1.1)');

  const ciphers = (/^\s*ciphers\s+(.+)$/m.exec(code)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const mozillaIntermediateInGo = [
    'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256'
  ];
  record(JSON.stringify([...ciphers].sort()) === JSON.stringify([...mozillaIntermediateInGo].sort()), 'the TLS 1.2 cipher suites are exactly Mozilla\'s intermediate set that Go can offer, every one ECDHE (V12.1.2)', ciphers.length + ' suites');
  record(ciphers.every(cipher => /^TLS_ECDHE_/.test(cipher) && /(GCM|CHACHA20)/.test(cipher)), 'every suite is forward secret and authenticated encryption: no CBC, 3DES, RC4 or RSA key exchange');

  record(/\{\$APP_HOST\}\s*\{[^}]*reverse_proxy frontend:3000/s.test(code), 'the website host proxies to the frontend');
  record(/\{\$API_HOST\}\s*\{[^}]*reverse_proxy backend:4000/s.test(code), 'the API host proxies to the backend');
  record(/\{\$APP_HOST\}/.test(code) && /\{\$API_HOST\}/.test(code) && !/\{\$APP_HOST\}\s*,\s*\{\$API_HOST\}/.test(code), 'the website and the API are separate site blocks on separate host names (V3.5.4)');

  const apiHttpBlock = /http:\/\/\{\$API_HOST\}\s*\{([^}]*)\}/s.exec(code)?.[1] ?? '';
  record(/respond\s+"[^"]*"\s+4\d\d/.test(apiHttpBlock) && !/redir/.test(apiHttpBlock), 'plain HTTP to the API is answered with an error, never a redirect (V4.1.2)', apiHttpBlock.trim().replace(/\s+/g, ' ').slice(0, 90));
  record(!/\bredir\b/.test(code), 'there is no redirect directive anywhere: the website\'s HTTP -> HTTPS redirect is Caddy\'s automatic one');
  record(!/auto_https\s+(off|disable_redirects|disable_certs)/.test(code), 'Caddy\'s automatic HTTPS and its redirect are not switched off');
  record(/\{\$TLS_ISSUER\}/.test(code) && !/\btls\s+internal\b/.test(code) && !/local_certs|skip_install_trust|insecure_skip_verify|tls_insecure/.test(code), 'certificates come from TLS_ISSUER (the ACME email: Let\'s Encrypt), and no test CA or insecure option is hard-coded (V12.2.2)');
  record(/email \{\$ACME_EMAIL\}/.test(code), 'the ACME account email is set');
  record(/admin off/.test(code), 'Caddy\'s admin API is off');
  record(/protocols h1 h2/.test(code), 'HTTP/1.1 and HTTP/2 only (no HTTP/3, which would need UDP 443)');
  record(/read_header\s+\d+s/.test(code), 'a slow-header timeout is set');
  record(!/header\s+(\S+\s+)?Strict-Transport/i.test(code), 'the edge adds no HSTS of its own: the website and the API each already send it');
}

// ------------------------------------------------------------------ MongoDB scripts

function checkMongoScripts(): void {
  const init = read('docker/mongo/init-users.sh');
  const roles = [...init.matchAll(/role:\s*'([^']+)'/g)].map(m => m[1]);
  record(roles.length === 1 && roles[0] === 'readWrite', 'MongoDB users are created with the readWrite role and nothing else', roles.join(','));
  record(/db: \$\(_js_escape "\$MONGO_INITDB_DATABASE"\)/.test(init) && !/\badmin\b/.test(init.replace(/#.*$/gm, '')), 'the role is on the application database only, never admin');
  record(/for b2g_service in api worker/.test(init), 'one user per service: b2g_api and b2g_worker');
  record(/\$\(<\s*"\/etc\/mongo-init\/\$\{b2g_service\}_password"\)/.test(init), 'each password is read from its secret file');
  record(!/(password|pwd)\s*[:=]\s*['"][^'"$]{3,}['"]/i.test(init), 'no literal password is written in the script');

  const entry = read('docker/mongo/entrypoint.sh');
  record(/install -m 0400 -o mongodb -g mongodb "\$secrets\/mongo_server_pem"/.test(entry), 'the TLS private key is copied where only the mongodb user can read it (mode 0400)');
  record(/exec docker-entrypoint\.sh "\$@"/.test(entry), 'the official entrypoint then runs mongod, which drops to the unprivileged mongodb user');
}

// ------------------------------------------------------------------ the secrets generator

function generator(dir: string, args: string[], input?: string): SpawnSyncReturns<string> {
  return run('bash', [path.join(repoRoot, 'docker/secrets/generate.sh'), ...args], { env: { ...process.env, SECRETS_DIR: dir }, input });
}

function mode(file: string): string {
  return (statSync(file).mode & 0o777).toString(8);
}

function checkGenerator(parent: string): void {
  if (run('openssl', ['version']).status !== 0) {
    console.log('(openssl is not available: the secrets generator checks are skipped)');
    return;
  }
  const dir = path.join(parent, 'secrets');

  const created = generator(dir, []);
  record(created.status === 0, 'docker/secrets/generate.sh creates the MongoDB secrets and the two-step sign-in key', created.stderr.slice(0, 120));
  const files = ['mongo_root_password', 'mongo_api_password', 'mongo_worker_password', 'mongo_api_uri', 'mongo_worker_uri', 'mongo_ca_pem', 'mongo_server_pem', 'mfa_encryption_key'];
  record(files.every(file => existsSync(path.join(dir, file))), 'every generated file exists');
  record(mode(dir) === '700', 'the secrets directory is private to its owner (0700)', mode(dir));
  record(!files.some(file => (statSync(path.join(dir, file)).mode & 0o022) !== 0), 'no secret file is writable by group or others');

  const passwords = ['mongo_root_password', 'mongo_api_password', 'mongo_worker_password'].map(file => readFileSync(path.join(dir, file), 'utf8').trim());
  record(passwords.every(password => password.length >= 32 && /^[A-Za-z0-9]+$/.test(password)), 'passwords are at least 32 characters of letters and digits (safe inside a connection address)', passwords.map(p => p.length).join(','));
  record(new Set(passwords).size === 3, 'the root, API and worker passwords are all different (V13.2.3: no shared or default credential)');

  const apiUri = readFileSync(path.join(dir, 'mongo_api_uri'), 'utf8').trim();
  const workerUri = readFileSync(path.join(dir, 'mongo_worker_uri'), 'utf8').trim();
  record(apiUri.startsWith(`mongodb://b2g_api:${passwords[1]}@mongo:27017/b2gvendor?`) && workerUri.startsWith(`mongodb://b2g_worker:${passwords[2]}@mongo:27017/b2gvendor?`), 'each address holds its own service\'s user and password');
  record(/[?&]tls=true(&|$)/.test(apiUri) && /tlsCAFile=\/run\/secrets\/mongo_ca_pem/.test(apiUri), 'each address demands TLS and names the certificate authority');
  record(!apiUri.includes(passwords[0]) && !workerUri.includes(passwords[0]), 'neither address contains the root password');

  const caPem = readFileSync(path.join(dir, 'mongo_ca_pem'), 'utf8');
  const serverPem = readFileSync(path.join(dir, 'mongo_server_pem'), 'utf8');
  record(!/PRIVATE KEY/.test(caPem), 'the authority file that clients get holds the certificate only');
  record(/PRIVATE KEY/.test(serverPem) && /BEGIN CERTIFICATE/.test(serverPem), 'the server file holds certificate and key together, as mongod needs');
  record(mode(path.join(dir, 'ca', 'ca.key')) === '600', 'the authority\'s private key is kept apart and readable only by its owner', mode(path.join(dir, 'ca', 'ca.key')));
  const subject = run('openssl', ['x509', '-in', path.join(dir, 'mongo_server_pem'), '-noout', '-ext', 'subjectAltName,extendedKeyUsage']).stdout;
  record(/DNS:mongo/.test(subject) && /TLS Web Server Authentication/.test(subject), 'the server certificate is for the host name "mongo" and for server authentication only', subject.replace(/\s+/g, ' ').trim());

  // the seed-encryption key: base64 of exactly 32 random bytes, different on each deployment
  const mfaKey = readFileSync(path.join(dir, 'mfa_encryption_key'), 'utf8').trim();
  record(Buffer.from(mfaKey, 'base64').length === 32 && Buffer.from(mfaKey, 'base64').toString('base64') === mfaKey, 'mfa_encryption_key is base64 of exactly 32 bytes (AES-256)', `${Buffer.from(mfaKey, 'base64').length} bytes`);
  record(!passwords.includes(mfaKey) && !apiUri.includes(mfaKey), 'the seed-encryption key is its own secret (not a password, not in a connection address)');

  // idempotent: running it again never replaces a secret
  const before = files.map(file => readFileSync(path.join(dir, file), 'utf8'));
  const again = generator(dir, []);
  const after = files.map(file => readFileSync(path.join(dir, file), 'utf8'));
  record(again.status === 0 && JSON.stringify(before) === JSON.stringify(after), 'running it again keeps every existing secret (it never overwrites)');

  // provider secrets
  const stored = generator(dir, ['set', 'smtp_pass'], 'smtp-secret-value\n');
  record(stored.status === 0 && readFileSync(path.join(dir, 'smtp_pass'), 'utf8') === 'smtp-secret-value\n' && !stored.stdout.includes('smtp-secret-value'), '"set" stores a value from standard input, and never prints it');
  record(generator(dir, ['set', 'smtp_pass'], '\n').status !== 0, '"set" refuses an empty value');
  record(generator(dir, ['set', 'mongo_root_password'], 'x\n').status !== 0, '"set" refuses a name that is not a provider secret (it must not be able to replace the generated ones)');
  generator(dir, ['set', 'openrouter_api_key', '--unused']);
  generator(dir, ['set', 'data_go_th_api_key', '--unused']);
  const keyFile = path.join(parent, 'service-account.json');
  writeFileSync(keyFile, '{"type":"service_account"}\n');
  generator(dir, ['set', 'google_credentials', '--from-file', keyFile]);

  const good = generator(dir, ['check']);
  record(good.status === 0 && /All good/.test(good.stdout), 'check accepts a complete, sound set of secrets', good.stdout.split('\n').filter(l => /FAIL/.test(l)).join(' | '));

  // check must NOTICE each way a deployment could be weakened
  const rejects = (label: string, expected: RegExp, tamper: () => void, restore: () => void): void => {
    tamper();
    const result = generator(dir, ['check']);
    record(result.status !== 0 && expected.test(result.stdout), `check notices: ${label}`, result.stdout.split('\n').filter(l => /FAIL/.test(l)).join(' | ').slice(0, 110));
    restore();
  };
  const backup = (name: string): string => readFileSync(path.join(dir, name), 'utf8');
  const put = (name: string, value: string): void => writeFileSync(path.join(dir, name), value);

  let saved = backup('mongo_api_password');
  rejects('a short password', /shorter than 32/, () => put('mongo_api_password', 'short\n'), () => put('mongo_api_password', saved));
  rejects('a default credential (admin)', /default credential/, () => put('mongo_root_password', 'admin\n'), () => put('mongo_root_password', passwords[0] + '\n'));
  rejects('two users sharing one password', /repeats another password/, () => put('mongo_worker_password', passwords[1] + '\n'), () => put('mongo_worker_password', passwords[2] + '\n'));
  saved = backup('mongo_api_uri');
  rejects('an address without TLS', /does not match/, () => put('mongo_api_uri', apiUri.replace('&tls=true', '') + '\n'), () => put('mongo_api_uri', saved));
  rejects('an address that carries the wrong password', /does not match/, () => put('mongo_worker_uri', workerUri.replace(passwords[2], passwords[0]) + '\n'), () => put('mongo_worker_uri', workerUri + '\n'));
  saved = backup('mongo_ca_pem');
  rejects('a private key inside the authority file that clients receive', /contains a private key/, () => put('mongo_ca_pem', saved + serverPem.slice(serverPem.indexOf('-----BEGIN PRIVATE KEY'))), () => put('mongo_ca_pem', saved));
  const other = path.join(parent, 'other-secrets');
  generator(other, []);
  rejects('a server certificate that the authority did not sign', /does not verify/, () => put('mongo_server_pem', readFileSync(path.join(other, 'mongo_server_pem'), 'utf8')), () => put('mongo_server_pem', serverPem));
  saved = backup('mfa_encryption_key');
  rejects('a seed-encryption key of the wrong length', /mfa_encryption_key must be base64 of exactly 32 bytes/, () => put('mfa_encryption_key', 'dG9vLXNob3J0\n'), () => put('mfa_encryption_key', saved));
  rejects('a missing seed-encryption key', /mfa_encryption_key is missing/, () => rmSync(path.join(dir, 'mfa_encryption_key')), () => put('mfa_encryption_key', saved));
  rejects('a missing secret', /smtp_pass is missing/, () => rmSync(path.join(dir, 'smtp_pass')), () => put('smtp_pass', 'smtp-secret-value\n'));
  chmodSync(path.join(dir, 'smtp_pass'), 0o644);
  rejects('a secret file that everyone may write', /writable by everyone/, () => chmodSync(path.join(dir, 'smtp_pass'), 0o666), () => chmodSync(path.join(dir, 'smtp_pass'), 0o644));
  record(generator(dir, ['check']).status === 0, 'after each tampering was undone, check passes again');

  // renewal keeps the authority and the passwords, and issues a new certificate
  const oldServerPem = backup('mongo_server_pem');
  const renewed = generator(dir, ['renew-mongo-cert']);
  record(renewed.status === 0 && backup('mongo_server_pem') !== oldServerPem && backup('mongo_ca_pem') === caPem && backup('mongo_api_password').trim() === passwords[1], 'renew-mongo-cert issues a new server certificate without touching the authority or any password');
  record(generator(dir, ['check']).status === 0, 'and the renewed certificate verifies against the same authority');
}

// ------------------------------------------------------------------ settings files and ignore rules

function checkSettingsFiles(): void {
  const uncommented = (relative: string): string[] => read(relative).split('\n').filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => line.split('=')[0]);
  const production = uncommented('Backend/.env.production.example');
  const secretVariables = ['MONGODB_URI', 'SMTP_PASS', 'OPENROUTER_API_KEY', 'DATA_GO_TH_API_KEY', 'MFA_ENCRYPTION_KEY'];
  record(!production.some(name => secretVariables.includes(name) || name.endsWith('_FILE')), 'Backend/.env.production.example sets no secret and no NAME_FILE (compose provides those)', production.filter(n => secretVariables.includes(n)).join(','));
  record(!production.includes('NODE_ENV') && !production.includes('CORS_ORIGIN') && !production.includes('APP_URL'), 'Backend/.env.production.example leaves NODE_ENV, APP_URL and CORS_ORIGIN to compose, so they cannot disagree with APP_HOST');
  const rootExample = read('.env.example');
  record(/# APP_HOST=/.test(rootExample) && /# API_HOST=/.test(rootExample) && /# ACME_EMAIL=/.test(rootExample), '.env.example documents APP_HOST, API_HOST and ACME_EMAIL');

  const git = run('git', ['check-ignore', '--no-index', '-v', 'secrets/mongo_root_password', 'Backend/.env.production.example', 'docker/secrets/generate.sh']);
  if (git.error || git.status === 128) {
    console.log('(not a git checkout: the ignore rules are not checked)');
    return;
  }
  const ignored = git.stdout.split('\n').filter(Boolean).filter(line => !line.includes(':!')).map(line => line.split('\t')[1]);
  record(ignored.includes('secrets/mongo_root_password'), 'git ignores the secrets folder at the repository root');
  record(!ignored.includes('Backend/.env.production.example') && !ignored.includes('docker/secrets/generate.sh'), 'git does not ignore the production settings template or docker/secrets/generate.sh');
}

function main(): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'b2g-deploy-'));
  try {
    checkCompose(dir);
    checkDockerfiles();
    checkCaddyfile();
    checkMongoScripts();
    checkGenerator(dir);
    checkSettingsFiles();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
