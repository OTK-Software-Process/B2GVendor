const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const SESSION_INVALID_EVENT = 'b2g:session-invalid';

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  // Structured context from the server, e.g. the existing tags a new tag collides with.
  details?: unknown;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success) {
    // The session died mid-use (expired/revoked) or the account got suspended.
    // Tell the app so it can drop to the signed-out state -- the admin route
    // guard then redirects to login. /auth/* is excluded: a failed login is
    // not an expired session.
    const code = body?.error?.code;
    if (
      typeof window !== 'undefined' &&
      !path.startsWith('/auth/') &&
      (code === 'NOT_AUTHENTICATED' || code === 'ACCOUNT_SUSPENDED')
    ) {
      window.dispatchEvent(new Event(SESSION_INVALID_EVENT));
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Something went wrong',
      body?.error?.fields,
      body?.error?.details
    );
  }

  return body.data as T;
}

export const api = {
  get:   <T>(p: string) => request<T>(p),
  post:  <T>(p: string, b?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) }),
  patch: <T>(p: string, b?: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) }),
  del:   <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
