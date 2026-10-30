/** Typed API client — account sessions and CSRF-protected mutations */

import type { AuthStatus, Category, Suite, Case, Run, LogsResponse, User, UserRole } from './types';

const BASE = process.env.NEXT_PUBLIC_API || '';
let csrfToken = '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function setCsrfToken(token?: string) {
  csrfToken = token || '';
}

export async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(BASE + path, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    let text = await response.text();
    try { text = JSON.parse(text).error || text; } catch { /* raw text */ }
    throw new ApiError(text || 'Request failed: ' + response.status, response.status);
  }
  if (response.status === 204) return null as T;
  return response.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function authRequest(path: string, body: Record<string, string>) {
  setCsrfToken('');
  const result = await request<AuthStatus>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (result.authenticated) setCsrfToken(result.csrfToken);
  return result;
}

export function register(name: string, email: string, password: string) {
  return authRequest('/api/auth/register', { name, email, password });
}

export function login(email: string, password: string) {
  return authRequest('/api/auth/login', { email, password });
}

export function checkAuth() {
  return request<AuthStatus>('/api/auth').then(status => {
    setCsrfToken(status.authenticated ? status.csrfToken : '');
    return status;
  });
}

export function logout() {
  return request<null>('/api/auth/logout', { method: 'POST' }).finally(() => setCsrfToken(''));
}

// ─── Users (administrator only) ──────────────────────────────────────────────

export function listUsers() {
  return request<User[]>('/api/users');
}

export function updateUser(id: string, body: Partial<{ name: string; role: UserRole }>) {
  return request<User>('/api/users/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteUser(id: string) {
  return request<null>('/api/users/' + id, { method: 'DELETE' });
}

// ─── Categories ──────────────────────────────────────────────────────────────

export function listCategories() {
  return request<Category[]>('/api/categories');
}

export function createCategory(body: { name: string; description?: string }) {
  return request<Category>('/api/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCategory(id: string, body: Partial<{ name: string; description: string }>) {
  return request<Category>('/api/categories/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteCategory(id: string) {
  return request<null>('/api/categories/' + id, { method: 'DELETE' });
}

// ─── Suites ──────────────────────────────────────────────────────────────────

export function listSuites() {
  return request<Suite[]>('/api/suites');
}

export function createSuite(body: { name: string; targetUrl: string; description?: string; categoryId?: string | null }) {
  return request<Suite>('/api/suites', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateSuite(id: string, body: Partial<{ name: string; targetUrl: string; description: string; categoryId: string | null }>) {
  return request<Suite>('/api/suites/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteSuite(id: string) {
  return request<null>('/api/suites/' + id, { method: 'DELETE' });
}

// ─── Cases ───────────────────────────────────────────────────────────────────

export function listCases(suiteId: string) {
  return request<Case[]>('/api/suites/' + suiteId + '/cases');
}

export function createCase(suiteId: string, body: { name: string; code: string; enabled?: boolean }) {
  return request<Case>('/api/suites/' + suiteId + '/cases', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCase(id: string, body: Partial<{ name: string; code: string; enabled: boolean }>) {
  return request<Case>('/api/cases/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteCase(id: string) {
  return request<null>('/api/cases/' + id, { method: 'DELETE' });
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export function listRuns(params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  return request<Run[]>('/api/runs' + (qs ? '?' + qs : ''));
}

export async function listRunsPage(params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  const headers = new Headers();
  const response = await fetch(BASE + '/api/runs' + (qs ? '?' + qs : ''), {
    credentials: 'include',
    headers,
  });
  if (!response.ok) throw new ApiError('Could not load runs', response.status);
  const runs = await response.json() as Run[];
  const total = Number(response.headers.get('X-Total-Count'));
  return { runs, total: Number.isFinite(total) ? total : runs.length };
}

export function getRun(id: string) {
  return request<Run>('/api/runs/' + id);
}

export function startRun(body: { suiteId: string; mode: string; headed: boolean; caseIds?: string[] }) {
  return request<Run>('/api/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function cancelRun(id: string) {
  return request<Run>('/api/runs/' + id + '/cancel', { method: 'POST' });
}

export function getRunLogs(id: string, after = 0) {
  return request<LogsResponse>('/api/runs/' + id + '/logs?after=' + after);
}

export function downloadLogsUrl(id: string) {
  return BASE + '/api/runs/' + encodeURIComponent(id) + '/logs/download';
}

export function artifactUrl(runId: string, path: string) {
  return BASE + '/api/runs/' + encodeURIComponent(runId) + '/artifacts/' +
    path.split('/').map(encodeURIComponent).join('/');
}

export function wsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws';
  if (typeof location !== 'undefined') {
    return location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
  }
  return 'ws://127.0.0.1:3001/ws';
}
