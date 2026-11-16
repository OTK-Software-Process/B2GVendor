import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

// Page load (NFR-G2 / SRS "Page Load"): core public pages are interactive within
// 2.5 s on a mid-range phone over 4G.
//
// Lighthouse's default mobile profile IS that device: an emulated Moto G Power
// class phone (4x CPU slowdown) on simulated "Slow 4G" (150 ms RTT, ~1.6 Mbps).
// Each page is measured RUNS times (default 3) and the median Time to
// Interactive must be <= 2500 ms.
//
//   1. a running stack with data, e.g.:  npm run perf -- --serve   (API on :4100)
//      and the frontend built with NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
//      and started on :3100 (see perf/README.md)
//   2. npm run perf:lighthouse            (PERF_WEB_URL=http://localhost:3100)
//
// Needs Chrome/Chromium installed (Lighthouse finds it; or set CHROME_PATH).
//
// PERF_LIGHTHOUSE_THROTTLING=simulate (default) estimates the phone/4G timings
// from an unthrottled load (Lighthouse's "Lantern" model); =devtools really
// applies the same limits to the browser and reports what it observed.
// PERF_LIGHTHOUSE_INSECURE=1 accepts a self-signed certificate (the HTTP/2
// proxy: npm run perf:h2-proxy, then PERF_WEB_URL=https://localhost:3443).

const LIGHTHOUSE = 'lighthouse@12.8.2';
const BUDGET_MS = 2500;

interface PageResult {
  page: string;
  tti: number[];
  lcp: number[];
  fcp: number[];
  tbt: number[];
  score: number[];
}

// On Windows npx runs through a shell, which would split a value with spaces
// into separate arguments (only the first Chrome flag would reach Chrome).
const shellQuote = (value: string): string => (process.platform === 'win32' ? `"${value}"` : value);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function main(): Promise<void> {
  const base = (process.env.PERF_WEB_URL ?? 'http://localhost:3100').replace(/\/$/, '');
  const runs = Number(process.env.PERF_LIGHTHOUSE_RUNS ?? 3);
  const stateFile = path.join(__dirname, '.state', 'perf-state.json');
  const workId = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as { workIds: string[] }).workIds[0] : null;
  const throttling = process.env.PERF_LIGHTHOUSE_THROTTLING === 'devtools' ? 'devtools' : 'simulate';
  const chromeFlags = ['--headless=new', '--no-sandbox', ...(process.env.PERF_LIGHTHOUSE_INSECURE === '1' ? ['--ignore-certificate-errors', '--allow-insecure-localhost'] : [])].join(' ');
  const pages = ['/', '/search', `/search?q=${encodeURIComponent('ก่อสร้าง')}`, '/agencies', ...(workId ? [`/works/${workId}`] : [])];

  const outDir = path.join(__dirname, '.state', 'results', 'lighthouse');
  await fs.mkdir(outDir, { recursive: true });
  const results: PageResult[] = [];

  for (const page of pages) {
    const result: PageResult = { page, tti: [], lcp: [], fcp: [], tbt: [], score: [] };
    for (let run = 1; run <= runs; run++) {
      const out = path.join(outDir, `${page.replace(/[^a-z0-9]+/gi, '_') || 'home'}-${run}.json`);
      const lh = spawnSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['--yes', LIGHTHOUSE, `${base}${page}`, '--only-categories=performance', `--throttling-method=${throttling}`, '--output=json', `--output-path=${out}`, '--quiet', `--chrome-flags=${shellQuote(chromeFlags)}`],
        { encoding: 'utf8', shell: process.platform === 'win32', timeout: 180_000 }
      );
      if (lh.status !== 0 || !existsSync(out)) {
        console.error(`Lighthouse failed on ${page}: ${lh.stderr || lh.stdout}`);
        process.exit(2);
      }
      const report = JSON.parse(await fs.readFile(out, 'utf8'));
      const audit = (id: string): number => Math.round(report.audits[id]?.numericValue ?? NaN);
      result.tti.push(audit('interactive'));
      result.lcp.push(audit('largest-contentful-paint'));
      result.fcp.push(audit('first-contentful-paint'));
      result.tbt.push(audit('total-blocking-time'));
      result.score.push(Math.round((report.categories.performance.score ?? 0) * 100));
    }
    results.push(result);
    const tti = median(result.tti);
    console.log(`${tti <= BUDGET_MS ? 'PASS' : 'FAIL'}  ${page.padEnd(40)} interactive ${tti} ms (runs ${result.tti.join(', ')})  LCP ${median(result.lcp)}  FCP ${median(result.fcp)}  TBT ${median(result.tbt)}  score ${median(result.score)}`);
  }

  const failed = results.filter(r => median(r.tti) > BUDGET_MS);
  console.log(`\nMid-range phone over 4G (Lighthouse mobile defaults, ${throttling} throttling, ${base}), median of ${runs}: ${results.length - failed.length}/${results.length} pages interactive within ${BUDGET_MS} ms. Reports: ${outDir}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
