// FR-N1.8: "retries with backoff on transient failures". Used around the
// two external network calls in the ingestion pipeline (e-GP RSS fetch,
// data.go.th datastore_search) -- NOT around per-item DB writes, which
// either succeed or are logged as a failed item (see ingestion.service.ts).
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
