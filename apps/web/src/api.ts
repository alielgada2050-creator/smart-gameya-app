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

import { API_ORIGIN, presentFile } from './platform.ts';

const RT_KEY = 'sg.refresh';
const USER_KEY = 'sg.user';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
/** Public auth endpoints never carry or refresh a session; everything else (including /auth/me) does. */
const isPublicAuth = (path: string) => /^\/auth\/(otp\/|refresh|logout|google)/.test(path);

export interface SessionUser { id: string; fullName: string }
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export function currentUser(): SessionUser | null {
  try { return JSON.parse(store.get(USER_KEY) ?? 'null'); } catch { return null; }
}
export const hasSession = () => !!store.get(RT_KEY);
/** After a rename: keep the cached session user in step and tell the shell. */
export function rememberName(fullName: string) {
  const u = currentUser();
  if (u) store.set(USER_KEY, JSON.stringify({ ...u, fullName }));
  dispatchEvent(new CustomEvent('sg:name', { detail: fullName }));
}

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
    const r = await fetch(`${API_ORIGIN}/api/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!r.ok) { clearSession(); return false; }
    saveTokens(await r.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, retry = true): Promise<T> {
  if (!accessToken && hasSession() && !isPublicAuth(path)) await refresh();
  const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !isPublicAuth(path) && (await refresh())) return api(method, path, body, false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? { code: 'HTTP_ERROR', message: res.statusText });
  return data as T;
}

/** Multipart upload (receipts, promissory notes). Returns the stored file id. */
export async function uploadFile(gamiyaId: string, purpose: 'RECEIPT' | 'PROMISSORY_NOTE', file: File): Promise<{ fileId: string }> {
  if (!accessToken && hasSession()) await refresh();
  const send = () => {
    const fd = new FormData();
    fd.append('purpose', purpose);
    fd.append('file', file);
    return fetch(`${API_ORIGIN}/api/v1/gamiyas/${gamiyaId}/files`, { method: 'POST', headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {}, body: fd });
  };
  let res = await send();
  if (res.status === 401 && (await refresh())) res = await send();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? { code: 'HTTP_ERROR', message: res.statusText });
  return data;
}

/** Open a protected file (receipt / note). The bearer token never goes in a URL; see presentFile for each platform. */
export async function openFile(fileId: string) {
  if (!accessToken && hasSession()) await refresh();
  let res = await fetch(`${API_ORIGIN}/api/v1/files/${fileId}`, { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
  if (res.status === 401 && (await refresh())) res = await fetch(`${API_ORIGIN}/api/v1/files/${fileId}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new ApiError(res.status, { code: 'FILE', message: res.statusText });
  const blob = await res.blob();
  await presentFile(blob, `${fileId}.${blob.type === 'application/pdf' ? 'pdf' : blob.type.split('/')[1] ?? 'bin'}`);
}

export async function googleSignIn(idToken: string) {
  const r = await api<any>('POST', '/auth/google', { idToken });
  if (r.accessToken) { saveTokens(r); store.set(USER_KEY, JSON.stringify(r.user)); } // store: secure storage inside the apps
  return r as { needsPhone?: boolean; linkToken?: string; suggestedName?: string; user?: SessionUser };
}

export async function requestCode(phone: string) {
  return api<{ sent: boolean; devCode?: string }>('POST', '/auth/otp/request', { phone });
}

export async function verifyCode(phone: string, code: string, fullName?: string, linkToken?: string) {
  const r = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>('POST', '/auth/otp/verify', { phone, code, fullName: fullName || undefined, linkToken });
  saveTokens(r);
  store.set(USER_KEY, JSON.stringify(r.user));
  return r.user;
}

export async function requestEmailCode(email: string) {
  return api<{ sent: boolean; devCode?: string }>('POST', '/auth/email/request', { email });
}

export async function verifyEmailCode(email: string, code: string, fullName?: string) {
  const r = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>('POST', '/auth/email/verify', { email, code, fullName: fullName || undefined });
  saveTokens(r);
  store.set(USER_KEY, JSON.stringify(r.user));
  return r.user;
}

export async function logout() {
  const rt = store.get(RT_KEY);
  if (rt) await api('POST', '/auth/logout', { refreshToken: rt }).catch(() => {});
  clearSession();
}

/**
 * Mobile normaliser for the supported countries (Arabic-Indic digits accepted):
 *  Saudi 05XXXXXXXX / +9665…   Egypt 01[0125]XXXXXXXX / +201…   UAE +9715… / 009715…
 */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  let m = /^(?:00966|966|0)?(5\d{8})$/.exec(d);
  if (m) return `+966${m[1]}`;
  m = /^(?:0020|20|0)(1[0125]\d{8})$/.exec(d);
  if (m) return `+20${m[1]}`;
  m = /^(?:00971|971)(5\d{8})$/.exec(d);
  return m ? `+971${m[1]}` : null;
}
