import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import path from 'node:path';

// HTTPS + HTTP/2 in front of the local frontend, for production-like page-load
// measurements (npm run perf:h2-proxy).
//
// Production serves the site over HTTPS (APP_URL must be https), where every
// mainstream reverse proxy / CDN speaks HTTP/2: all of a page's requests share
// one multiplexed connection. The local `next start` / standalone server only
// speaks HTTP/1.1, so a browser opens at most 6 connections and queues the rest
// -- with ~10 JavaScript chunks on a 4G latency that is a test-setup artifact.
// This proxy removes it:
//
//   https://localhost:3443  ->  http://127.0.0.1:3100   (PERF_H2_PORT / PERF_H2_TARGET)
//
// It uses a throw-away self-signed certificate (made with openssl, kept in
// perf/.state/), so Lighthouse needs PERF_LIGHTHOUSE_INSECURE=1 (Chrome's
// --ignore-certificate-errors). Local testing only.

const port = Number(process.env.PERF_H2_PORT ?? 3443);
const target = new URL(process.env.PERF_H2_TARGET ?? 'http://127.0.0.1:3100');
const certDir = path.join(__dirname, '.state', 'h2-cert');
const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');

if (!existsSync(keyFile) || !existsSync(certFile)) {
  mkdirSync(certDir, { recursive: true });
  const made = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=localhost', '-keyout', keyFile, '-out', certFile],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
  );
  if (made.status !== 0) {
    console.error(`Could not create a self-signed certificate with openssl: ${made.stderr || made.error}`);
    process.exit(2);
  }
}

// Headers that belong to one HTTP/1.1 connection and are forbidden in HTTP/2.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings']);

const server = http2.createSecureServer({ key: readFileSync(keyFile), cert: readFileSync(certFile), allowHTTP1: true }, (req, res) => {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!name.startsWith(':') && !HOP_BY_HOP.has(name)) headers[name] = value;
  }
  headers.host = target.host;
  headers['x-forwarded-proto'] = 'https';

  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers },
    upRes => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(upRes.headers)) if (!HOP_BY_HOP.has(name)) out[name] = value;
      res.writeHead(upRes.statusCode ?? 502, out);
      upRes.pipe(res);
    }
  );
  upstream.on('error', err => {
    if (!res.headersSent) res.writeHead(502);
    res.end(String(err));
  });
  req.pipe(upstream);
});

server.listen(port, () => console.log(`HTTP/2 + TLS proxy: https://localhost:${port} -> ${target.origin} (self-signed; Ctrl+C to stop)`));
