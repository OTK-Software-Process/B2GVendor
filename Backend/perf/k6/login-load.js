// k6: logins under load (bcrypt, 12 rounds) must not slow other requests to a crawl.
//
// Two phases, same browse traffic in both:
//   browse_baseline  0-20 s : BROWSE_RATE req/s of ordinary page traffic only
//   browse_under_logins + logins  20 s on : the same browse traffic WHILE
//                       LOGIN_RATE sign-ins/second (default 10) hit /auth/login
// The browse requests' p95 during the login storm must stay under 1 s (and the
// sign-ins must keep succeeding). Each sign-in comes from its own client
// address (X-Forwarded-For; the API runs in production mode behind a proxy and
// trusts one hop), so it is many users signing in, not one IP being rate-limited.
import http from 'k6/http';
import { check } from 'k6';
import { withConnectionRetry } from './lib.js';

const BASE = __ENV.BASE_URL || 'http://localhost:4100/api/v1';
const state = JSON.parse(open(__ENV.STATE_FILE || '/state/perf-state.json'));
const LOGIN_RATE = Number(__ENV.LOGIN_RATE || 10);
const BROWSE_RATE = Number(__ENV.BROWSE_RATE || 20);
const DURATION = __ENV.DURATION || '60s';

export const options = {
  scenarios: {
    browse_baseline: { executor: 'constant-arrival-rate', exec: 'browse', rate: BROWSE_RATE, timeUnit: '1s', duration: '20s', preAllocatedVUs: 20, maxVUs: 200 },
    browse_under_logins: { executor: 'constant-arrival-rate', exec: 'browse', rate: BROWSE_RATE, timeUnit: '1s', duration: DURATION, startTime: '20s', preAllocatedVUs: 20, maxVUs: 400 },
    logins: { executor: 'constant-arrival-rate', exec: 'login', rate: LOGIN_RATE, timeUnit: '1s', duration: DURATION, startTime: '20s', preAllocatedVUs: 20, maxVUs: 400 }
  },
  thresholds: {
    'http_req_duration{scenario:browse_baseline}': ['p(95)<500'],
    'http_req_duration{scenario:browse_under_logins}': ['p(95)<1000'],
    'http_req_failed{scenario:browse_under_logins}': ['rate<0.01'],
    'checks{check:login ok}': ['rate>0.99'],
    'http_reqs{scenario:browse_under_logins}': [`count>=${BROWSE_RATE * 30}`]
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max']
};

const pick = list => list[Math.floor(Math.random() * list.length)];

export function browse() {
  const roll = Math.random();
  let url;
  let name;
  if (roll < 0.5) [url, name] = [`${BASE}/works?page=${1 + Math.floor(Math.random() * 5)}`, 'browse-list'];
  else if (roll < 0.85) [url, name] = [`${BASE}/works/${pick(state.workIds)}`, 'browse-detail'];
  else [url, name] = [`${BASE}/gov-sites`, 'browse-sites'];
  const res = withConnectionRetry(() => http.get(url, { tags: { name } }));
  check(res, { 'browse ok': r => r.status === 200 });
}

let ipCounter = 0;
export function login() {
  ipCounter += 1;
  const ip = `10.${(__VU >> 8) & 255}.${__VU & 255}.${ipCounter % 250 + 1}`;
  const user = pick(state.vendorLogins);
  const res = withConnectionRetry(() =>
    http.post(`${BASE}/auth/login`, JSON.stringify({ email: user.email, password: user.password }), {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      tags: { name: 'login' }
    })
  );
  check(res, { 'login ok': r => r.status === 200 });
}
