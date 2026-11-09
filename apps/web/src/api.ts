/**
 * Thin API client. The UI never computes money or dates: every figure is a server string.
 * Session: the access token lives in memory only; the refresh token is kept in localStorage so the
 * installed app stays signed in (mitigated by a strict CSP and single-use rotation with reuse detection).
 */
export interface ApiErrorBody { code: string; message: string; correlationId?: string }
export class ApiError extends Error {
  code: string; status: number;
  constructor(status: number, body: ApiErrorBody) { super(body.message); this.code = body.code; this.status = status; }
}

const RT_KEY = 'sg.refresh';
const USER_KEY = 'sg.user';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export interface SessionUser { id: string; fullName: string }
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export function currentUser(): SessionUser | null {
  try { return JSON.parse(store.get(USER_KEY) ?? 'null'); } catch { return null; }
}
export const hasSession = () => !!store.get(RT_KEY);

function saveTokens(t: { accessToken: string; refreshToken: string }) {
  accessToken = t.accessToken;
  store.set(RT_KEY, t.refreshToken);
}

export function clearSession() {
  accessToken = null;
  store.set(RT_KEY, null);
  store.set(USER_KEY, null);
}

async function refresh(): Promise<boolean> {
  const rt = store.get(RT_KEY);
  if (!rt) return false;
  refreshing ??= (async () => {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!r.ok) { clearSession(); return false; }
    saveTokens(await r.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, retry = true): Promise<T> {
  if (!accessToken && hasSession() && !path.startsWith('/auth/')) await refresh();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/') && (await refresh())) return api(method, path, body, false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? { code: 'HTTP_ERROR', message: res.statusText });
  return data as T;
}

export async function requestCode(phone: string) {
  return api<{ sent: boolean; devCode?: string }>('POST', '/auth/otp/request', { phone });
}

export async function verifyCode(phone: string, code: string, fullName?: string) {
  const r = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>('POST', '/auth/otp/verify', { phone, code, fullName: fullName || undefined });
  saveTokens(r);
  store.set(USER_KEY, JSON.stringify(r.user));
  return r.user;
}

export async function logout() {
  const rt = store.get(RT_KEY);
  if (rt) await api('POST', '/auth/logout', { refreshToken: rt }).catch(() => {});
  clearSession();
}

/** Saudi mobile normaliser: accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX, Arabic-Indic digits. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  const m = /^(?:00966|966|0)?(5\d{8})$/.exec(d);
  return m ? `+966${m[1]}` : null;
}
