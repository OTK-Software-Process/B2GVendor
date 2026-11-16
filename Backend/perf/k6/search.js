// k6: search latency (NFR-N4.2 / SRS "Search Latency"): faceted search results
// return within 1.5 s at p95 for typical queries, on the seeded data set.
//
//   k6 run -e BASE_URL=http://localhost:4100/api/v1 -e STATE_FILE=perf/.state/perf-state.json perf/k6/search.js
//   (npm run perf does this for you, against a throwaway stack)
//
// Load: ramps to RATE searches/second (default 5 = 300 a minute, a busy hour for 7 agencies) and holds it for DURATION
// (default 60s). "Typical" = the mix the search page produces: free text (Thai,
// incl. typos), text + government site, site + status, a followed tag, sorted
// by date / budget / deadline, first pages.
import http from 'k6/http';
import { check } from 'k6';
import { withConnectionRetry } from './lib.js';

const BASE = __ENV.BASE_URL || 'http://localhost:4100/api/v1';
const state = JSON.parse(open(__ENV.STATE_FILE || '/state/perf-state.json'));
const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || '60s';

export const options = {
  scenarios: {
    search: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 40,
      maxVUs: 300,
      stages: [
        { target: RATE, duration: '15s' },
        { target: RATE, duration: DURATION }
      ]
    }
  },
  thresholds: {
    'http_req_duration{name:search}': ['p(95)<1500'],
    // A run that made (almost) no requests must not "pass" on empty data.
    'http_reqs{name:search}': [`count>=${Math.floor(RATE * 30)}`],
    'http_req_failed{name:search}': ['rate<0.01'],
    checks: ['rate>0.99']
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max']
};

const pick = list => list[Math.floor(Math.random() * list.length)];
const SORTS = ['date', 'date', 'date', 'budget-desc', 'budget-asc', 'deadline'];
const STATUSES = ['BIDDING', 'AWARDED', 'DRAFT_TOR', 'PLANNED'];

// (k6's JavaScript runtime has no URLSearchParams)
function queryString(params) {
  return Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
}

function typicalQuery() {
  const p = {};
  const roll = Math.random();
  if (roll < 0.55) {
    p.q = pick(state.searchTerms);
  } else if (roll < 0.75) {
    p.q = pick(state.searchTerms);
    p.siteId = pick(state.siteIds);
  } else if (roll < 0.9) {
    p.siteId = pick(state.siteIds);
    p.status = pick(STATUSES);
  } else {
    p.tag = pick([...state.tagIds.category, ...state.tagIds.keyword]);
  }
  p.sort = pick(SORTS);
  const page = Math.random() < 0.8 ? 1 : 2 + Math.floor(Math.random() * 3);
  if (page > 1) p.page = String(page);
  return queryString(p);
}

export default function () {
  const url = `${BASE}/works?${typicalQuery()}`;
  const res = withConnectionRetry(() => http.get(url, { tags: { name: 'search' } }));
  check(res, {
    'search 200': r => r.status === 200,
    'search returns a result page': r => {
      try {
        const body = r.json();
        return body.success === true && Array.isArray(body.data.items);
      } catch (_) {
        return false;
      }
    }
  });
}
