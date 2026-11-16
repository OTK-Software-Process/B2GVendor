// k6: concurrent "Poll Now" requests behave correctly.
//
// ADMINS different admin accounts (default 30) press Poll Now at the same
// instant -- a mix of "all sites" and single-site polls. Exactly ONE request
// may be accepted (201); every other one must be refused with 409 CONFLICT;
// none may fail any other way. perf/run.ts also checks afterwards that exactly
// one PollJob row exists. (No worker runs during the test, so the accepted job
// stays queued and the lock stays held for the whole burst.)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { withConnectionRetry } from './lib.js';

const BASE = __ENV.BASE_URL || 'http://localhost:4100/api/v1';
const state = JSON.parse(open(__ENV.STATE_FILE || '/state/perf-state.json'));
const ADMINS = Math.min(Number(__ENV.ADMINS || 30), state.adminCookies.length);

const accepted = new Counter('poll_accepted');
const conflict = new Counter('poll_conflict');
const unexpected = new Counter('poll_unexpected');
const latency = new Trend('poll_now_duration', true);

export const options = {
  scenarios: {
    burst: { executor: 'per-vu-iterations', vus: ADMINS, iterations: 1, maxDuration: '60s' }
  },
  thresholds: {
    poll_accepted: ['count==1'],
    poll_conflict: [`count==${ADMINS - 1}`],
    poll_unexpected: ['count==0'],
    poll_now_duration: ['p(95)<1500']
  }
};

export function setup() {
  return { startAt: Date.now() + 3000 }; // every VU fires at this moment
}

export default function (data) {
  const cookie = state.adminCookies[(__VU - 1) % state.adminCookies.length];
  const wait = (data.startAt - Date.now()) / 1000;
  if (wait > 0) sleep(wait);

  const allSites = __VU % 3 !== 0;
  const url = allSites ? `${BASE}/admin/gov-sites/poll-all` : `${BASE}/admin/gov-sites/${state.siteIds[__VU % state.siteIds.length]}/poll`;
  const res = withConnectionRetry(() =>
    http.post(url, allSites ? null : JSON.stringify({ source: 'both' }), {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      tags: { name: 'poll-now' }
    })
  );
  latency.add(res.timings.duration);

  accepted.add(res.status === 201 ? 1 : 0);
  conflict.add(res.status === 409 ? 1 : 0);
  unexpected.add(res.status !== 201 && res.status !== 409 ? 1 : 0);
  check(res, { 'poll now answered 201 or 409': r => r.status === 201 || r.status === 409 });
}
