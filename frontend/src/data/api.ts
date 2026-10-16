import { API_BASE } from '../lib/config';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(code: string, message: string, status: number, details: unknown = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class OfflineError extends ApiError {
  constructor() {
    super('offline', 'Нет подключения к сети. Изменения в аккаунте сохраняются только онлайн.', 0);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1] as string) : '';
}

let csrfReady: Promise<void> | null = null;

/** Ensures the CSRF cookie exists before the first unsafe request. */
export function ensureCsrf(): Promise<void> {
  if (csrfToken()) return Promise.resolve();
  csrfReady ??= fetch(`${API_BASE}/auth/csrf/`, { credentials: 'same-origin' }).then(() => undefined);
  return csrfReady;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const unsafe = method !== 'GET' && method !== 'HEAD';
  if (unsafe) await ensureCsrf();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(unsafe ? { 'X-CSRFToken': csrfToken() } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new OfflineError();
  }
  if (response.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.code ?? 'http_error', err?.message ?? `Ошибка сервера (${response.status}).`, response.status, err?.details);
  }
  return payload as T;
}

/** True when a Foodo server answers at the configured API base (false on the static site). */
export async function serverAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/health/`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return false;
    const data = (await r.json()) as { status?: string };
    return data.status === 'ok' || data.status === 'degraded';
  } catch {
    return false;
  }
}
