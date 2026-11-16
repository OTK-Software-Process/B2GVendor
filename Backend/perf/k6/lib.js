// Shared by the k6 scripts.
import { Counter } from 'k6/metrics';

// A request that never reached the API (status 0: "dial: i/o timeout", seen
// now and then when k6 runs in Docker Desktop and talks to the host through
// host.docker.internal) is retried, at most twice, and counted here instead of
// as a server failure: the server never saw it, so it says nothing about the
// server. Every answer the server DID give -- errors, 5xx, slow ones -- still
// counts against the thresholds. With a local k6 binary this stays at 0.
export const connectionRetries = new Counter('connection_retries');

export function withConnectionRetry(send) {
  let res = send();
  for (let attempt = 0; attempt < 2 && res.status === 0; attempt++) {
    connectionRetries.add(1);
    res = send();
  }
  return res;
}
