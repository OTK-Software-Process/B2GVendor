import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { logger } from '../utils/logger';

// Network-level egress control (ASVS V13.2.5, docker-compose.yml): in the
// container stack the API and the worker sit on an internal network with NO
// route to the internet. The only way out is the egress proxy, which allows the
// same hosts as utils/outbound.ts and nothing else.
//
// Node's fetch() ignores HTTPS_PROXY on its own, so when the variable is set this
// installs undici's EnvHttpProxyAgent as the process-wide dispatcher: every
// fetch() then goes through the proxy, except the hosts in NO_PROXY (MongoDB,
// ClamAV and the other internal services). Outside Docker (npm run dev) the
// variable is unset and nothing changes.
export function proxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || undefined;
}

export function installEgressProxy(): void {
  const proxy = proxyUrl();
  if (!proxy) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  let host = proxy;
  try {
    host = new URL(proxy).host;
  } catch {
    // keep the raw value for the log line
  }
  logger.info('egress', `outbound HTTP goes through the egress proxy at ${host}`);
}
