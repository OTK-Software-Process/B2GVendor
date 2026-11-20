// Where browsers report Content-Security-Policy violations (ASVS V3.4.7): the
// CSP in src/proxy.ts names this path in both report-uri and report-to.
//
// Each report becomes ONE log line, so a blocked injected script, a broken
// third-party embed or a policy that is too strict shows up in the website's
// logs. Anyone can post here, so the endpoint is careful about what it accepts:
// a size cap, a cap on reports per request, every field cut short, and a limit
// on lines per minute so a flood cannot fill the log.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD_CHARS = 300;
const MAX_LINES_PER_MINUTE = 300;

let windowStart = Date.now();
let linesThisWindow = 0;
let droppedThisWindow = 0;

function allowLine(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    if (droppedThisWindow > 0) {
      console.warn('%s', JSON.stringify({ csp: 'reports-dropped', count: droppedThisWindow }));
    }
    windowStart = now;
    linesThisWindow = 0;
    droppedThisWindow = 0;
  }
  if (linesThisWindow >= MAX_LINES_PER_MINUTE) {
    droppedThisWindow += 1;
    return false;
  }
  linesThisWindow += 1;
  return true;
}

function field(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.slice(0, MAX_FIELD_CHARS);
}

type Raw = Record<string, unknown>;

// Two formats: report-uri posts {"csp-report": {...}} with kebab-case keys;
// report-to posts [{type: "csp-violation", body: {...}}] with camelCase keys.
function normalise(payload: unknown): Raw[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((r): r is Raw => !!r && typeof r === 'object' && (r as Raw).type === 'csp-violation')
      .map(r => (r.body && typeof r.body === 'object' ? (r.body as Raw) : {}));
  }
  if (payload && typeof payload === 'object' && (payload as Raw)['csp-report'] && typeof (payload as Raw)['csp-report'] === 'object') {
    const r = (payload as Raw)['csp-report'] as Raw;
    return [
      {
        documentURL: r['document-uri'],
        blockedURL: r['blocked-uri'],
        effectiveDirective: r['effective-directive'] ?? r['violated-directive'],
        disposition: r['disposition'],
        sourceFile: r['source-file'],
        lineNumber: r['line-number']
      }
    ];
  }
  return [];
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  for (const report of normalise(payload).slice(0, MAX_REPORTS_PER_REQUEST)) {
    if (!allowLine()) break;
    // A JSON line (control characters escaped by JSON.stringify), passed as an
    // argument to a fixed format, never as the format itself.
    console.warn(
      '%s',
      JSON.stringify({
        csp: 'violation',
        at: new Date().toISOString(),
        documentURL: field(report.documentURL),
        blockedURL: field(report.blockedURL),
        directive: field(report.effectiveDirective),
        disposition: field(report.disposition),
        sourceFile: field(report.sourceFile),
        line: field(report.lineNumber)
      })
    );
  }

  return new Response(null, { status: 204 });
}
