// FR-N1.8: "retries with backoff on transient failures". Used around the
// two external network calls in the ingestion pipeline (e-GP RSS fetch,
// data.go.th datastore_search) -- NOT around per-item DB writes, which
// either succeed or are logged as a failed item (see ingestion.service.ts).
//
// Waits baseDelayMs, then 2x, 4x ... between attempts. A stopped poll
// (`signal` aborted, see pollJob.service.ts's time limit) gives up at once
// instead of sleeping through the remaining attempts.
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.signal?.aborted) break;
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && !options.signal?.aborted) {
        await sleep(baseDelayMs * 2 ** attempt, options.signal);
      }
    }
  }
  throw lastError ?? options.signal?.reason ?? new Error('Retry stopped before the first attempt');
}

// Resolves after `ms`, or as soon as `signal` is aborted (never rejects).
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
