import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// Encrypted, authenticated connections to the services behind the API (ASVS
// V12.3.1, V13.2.1, docs/Security.md section 1).
//
// A deployment turns this on with REQUIRE_SECURE_BACKENDS=true
// (docker-compose.prod.yml does). The local Docker stack and `npm run dev` keep it
// off, so MongoDB and a mail catcher can still run without certificates there.
// When it is on, the process refuses to start with a MongoDB address that has no
// login or no TLS, and it refuses to send mail without TLS: it never falls back to
// an unencrypted connection.

/** What a MongoDB connection string says about login and encryption. Never holds the password. */
export interface MongoUriFacts {
  scheme: 'mongodb' | 'mongodb+srv';
  hasCredentials: boolean;
  tls: boolean;
  /** Options that switch certificate checking off, by name. */
  insecureOptions: string[];
}

const URI_PATTERN = /^(mongodb(?:\+srv)?):\/\/(?:([^:@/?]*)(?::([^@/?]*))?@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/i;

const TRUE = /^(true|1|yes)$/i;
const FALSE = /^(false|0|no)$/i;

/** Reads a MongoDB connection string. Returns null when it is not one. */
export function describeMongoUri(uri: string): MongoUriFacts | null {
  const match = URI_PATTERN.exec(uri.trim());
  if (!match) return null;

  const scheme = match[1].toLowerCase() as MongoUriFacts['scheme'];
  const user = match[2] ?? '';
  const password = match[3] ?? '';

  // Option names are case-insensitive in MongoDB connection strings.
  const options = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(match[6] ?? '')) options.set(name.toLowerCase(), value);

  const tlsOption = options.get('tls') ?? options.get('ssl');
  // mongodb+srv:// is encrypted unless it says otherwise; mongodb:// only when it asks for it.
  const tls = scheme === 'mongodb+srv' ? !(tlsOption !== undefined && FALSE.test(tlsOption)) : tlsOption !== undefined && TRUE.test(tlsOption);

  const insecureOptions: string[] = [];
  for (const name of ['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames']) {
    const value = options.get(name);
    if (value !== undefined && TRUE.test(value)) insecureOptions.push(name);
  }
  const sslValidate = options.get('sslvalidate');
  if (sslValidate !== undefined && FALSE.test(sslValidate)) insecureOptions.push('sslvalidate');

  return { scheme, hasCredentials: user !== '' && password !== '', tls, insecureOptions };
}

/**
 * Why a MongoDB connection string is not acceptable for a hardened deployment.
 * The messages name the problem, never the address (it holds the password).
 */
export function mongoUriProblems(uri: string): string[] {
  const facts = describeMongoUri(uri);
  if (!facts) return ['MONGODB_URI is not a mongodb:// or mongodb+srv:// address'];

  const problems: string[] = [];
  if (!facts.hasCredentials) problems.push('MONGODB_URI has no username and password: MongoDB must require a login (a user per service)');
  if (!facts.tls) problems.push('MONGODB_URI does not use TLS: add tls=true (and tlsCAFile=... for a private certificate authority)');
  for (const option of facts.insecureOptions) problems.push(`MONGODB_URI sets ${option}, which switches certificate checking off`);
  return problems;
}

export interface SmtpSettings {
  host: string;
  port?: number;
  user?: string;
  pass?: string;
}

/**
 * The options for the mail transport (nodemailer).
 *
 *  - Port 465 is TLS from the first byte.
 *  - Any other port starts in the clear and upgrades with STARTTLS. With
 *    `requireSecure` the upgrade is MANDATORY: a server that does not offer it
 *    makes the send fail, and the credentials and the message are never sent in
 *    the clear. Without it the upgrade is only used when offered (a local mail
 *    catcher).
 *  - Whenever TLS is used it is TLS 1.2 or newer, and the server's certificate must
 *    be valid for its host name.
 */
export function smtpTransportOptions(settings: SmtpSettings, options: { requireSecure: boolean; proxy?: string }): SMTPTransport.Options {
  const port = settings.port ?? 587;
  const implicitTls = port === 465;

  return {
    host: settings.host,
    port,
    secure: implicitTls,
    requireTLS: options.requireSecure && !implicitTls,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
    // In the container stack the only way out is the egress proxy (config/egressProxy.ts):
    // SMTP goes through it as an HTTP CONNECT tunnel, to the SMTP host only. TLS is
    // negotiated end to end through the tunnel, so the proxy sees only ciphertext.
    ...(options.proxy ? { proxy: options.proxy } : {})
  };
}
