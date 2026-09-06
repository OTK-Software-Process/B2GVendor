const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
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
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Something went wrong',
      body?.error?.fields
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
