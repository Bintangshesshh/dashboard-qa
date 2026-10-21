/** Typed API client — replaces the global `API` pattern from page.tsx */

import type { Category, Suite, Case, Run, LogsResponse } from './types';

const BASE = process.env.NEXT_PUBLIC_API || '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function request<T = unknown>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...init.headers,
    },
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

export function createSession(token: string) {
  return request<{ ok: boolean }>('/api/session', { method: 'POST' }, token);
}

export function deleteSession(token?: string) {
  return request<{ ok: boolean }>('/api/session', { method: 'DELETE' }, token);
}

export function checkAuth(token?: string) {
  return request<Suite[]>('/api/suites', {}, token);
}

// ─── Categories ──────────────────────────────────────────────────────────────

export function listCategories(token?: string) {
  return request<Category[]>('/api/categories', {}, token);
}

export function createCategory(body: { name: string; description?: string }, token?: string) {
  return request<Category>('/api/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token);
}

export function updateCategory(id: string, body: Partial<{ name: string; description: string }>, token?: string) {
  return request<Category>('/api/categories/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, token);
}

export function deleteCategory(id: string, token?: string) {
  return request<null>('/api/categories/' + id, { method: 'DELETE' }, token);
}

// ─── Suites ──────────────────────────────────────────────────────────────────

export function listSuites(token?: string) {
  return request<Suite[]>('/api/suites', {}, token);
}

export function createSuite(body: { name: string; targetUrl: string; description?: string; categoryId?: string | null }, token?: string) {
  return request<Suite>('/api/suites', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token);
}

export function updateSuite(id: string, body: Partial<{ name: string; targetUrl: string; description: string; categoryId: string | null }>, token?: string) {
  return request<Suite>('/api/suites/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, token);
}

export function deleteSuite(id: string, token?: string) {
  return request<null>('/api/suites/' + id, { method: 'DELETE' }, token);
}

// ─── Cases ───────────────────────────────────────────────────────────────────

export function listCases(suiteId: string, token?: string) {
  return request<Case[]>('/api/suites/' + suiteId + '/cases', {}, token);
}

export function createCase(suiteId: string, body: { name: string; code: string; enabled?: boolean }, token?: string) {
  return request<Case>('/api/suites/' + suiteId + '/cases', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token);
}

export function updateCase(id: string, body: Partial<{ name: string; code: string; enabled: boolean }>, token?: string) {
  return request<Case>('/api/cases/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, token);
}

export function deleteCase(id: string, token?: string) {
  return request<null>('/api/cases/' + id, { method: 'DELETE' }, token);
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export function listRuns(params?: { limit?: number; offset?: number }, token?: string) {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  return request<Run[]>('/api/runs' + (qs ? '?' + qs : ''), {}, token);
}

export function getRun(id: string, token?: string) {
  return request<Run>('/api/runs/' + id, {}, token);
}

export function startRun(body: { suiteId: string; mode: string; headed: boolean; caseIds?: string[] }, token?: string) {
  return request<Run>('/api/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token);
}

export function cancelRun(id: string, token?: string) {
  return request<Run>('/api/runs/' + id + '/cancel', { method: 'POST' }, token);
}

export function getRunLogs(id: string, after = 0, token?: string) {
  return request<LogsResponse>('/api/runs/' + id + '/logs?after=' + after, {}, token);
}

export function downloadLogsUrl(id: string) {
  return BASE + '/api/runs/' + encodeURIComponent(id) + '/logs/download';
}

export function artifactUrl(runId: string, path: string) {
  return BASE + '/api/runs/' + encodeURIComponent(runId) + '/artifacts/' +
    path.split('/').map(encodeURIComponent).join('/');
}

export function wsUrl(token: string) {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws';
  if (typeof location !== 'undefined') {
    return location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
  }
  return 'ws://127.0.0.1:3001/ws';
}
