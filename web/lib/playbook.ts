// Klien API Playbook v5 — kontrak docs/PRD.md §7.

export type User = { id: string; username: string; role: "admin" | "viewer" };
export type Project = {
  id: string; slug: string; name: string; base_url: string;
  staging_url: string | null; local_url: string | null;
  origins: string[]; allow_production: number; active: number;
  lastRunAt: string | null;
};
export type TestFile = {
  id: string; project_id: string; tool: "pw" | "lh"; path: string;
  label: string; code: string; config: string | null; enabled: number;
};
export type Run = {
  id: string; session_id: string; test_file_id: string | null; tool: "pw" | "lh";
  status: "queued" | "running" | "uploading" | "passed" | "failed" | "cancelled" | "interrupted";
  queued_at: string; started_at: string | null; finished_at: string | null;
  finalized_at: string | null; duration_ms: number | null; exit_code: number | null;
  error: string | null; artifacts?: Artifact[];
  results?: PlaywrightResult[] | LighthouseResult[];
  console?: { seq: number; at: string; type: string; text: string; location: string | null }[];
  network?: { seq: number; at: string; url: string; status: number | null; method: string | null; failure: string | null; ms: number | null }[];
};
export type RunRow = Run & { session_label: string; env: string; has_html: number };
export type Artifact = { id: string; run_id: string; kind: string; path: string; bytes: number | null };
export type PlaywrightResult = {
  id: string; run_id: string; tc_id: string | null; file: string; title: string;
  status: "passed" | "failed" | "skipped" | "flaky"; duration_ms: number | null;
  retry: number; error: string | null;
};
export type LighthouseResult = {
  id: string; run_id: string; url: string; performance: number | null;
  accessibility: number | null; best_practices: number | null; seo: number | null;
  lcp_ms: number | null; cls: number | null; tbt_ms: number | null;
  budget_failed: string | null; warnings: string | null; report_path: string | null;
};
export type LighthouseRow = LighthouseResult & {
  run_status: Run["status"]; queued_at: string; session_id: string;
  session_label: string; env: string;
};
export type Session = {
  id: string; project_id: string; env: "local" | "staging" | "production";
  target_url: string; label: string; created_by: string | null;
  created_at: string; closed_at: string | null;
  status: "open" | "running" | "failed" | "passed" | "closed";
  runs?: Run[]; reports?: Report[];
  // Ringkasan dari GET /api/sessions (PRD §10.5).
  run_count?: number; pw_count?: number; lh_count?: number;
  failed_count?: number; active_count?: number;
};
export type Stats = {
  tcPassed: number; tcFailed: number; passRate: number | null;
  sessions: number; runs: number; failedRuns: number; avgDurationMs: number | null;
  lighthouse: {
    urls: number; performance: number | null; accessibility: number | null;
    bestPractices: number | null; seo: number | null;
  } | null;
  failures: FailureRow[];
  daily: { day: string; total: number; passed: number }[];
};
export type FailureRow = {
  id: string; session_id: string; tool: "pw" | "lh"; status: Run["status"];
  error: string | null; finished_at: string | null;
  session_label: string; env: string; project_name: string;
};

export type Report = {
  id: string; session_id: string; scope: "pw" | "lh" | "both";
  status: "queued" | "building" | "ready" | "failed" | "stale";
  run_ids: string | null; path: string | null; error: string | null;
  created_at: string; built_at: string | null;
};

// Nilai settings disimpan sebagai TEXT di SQLite; UI yang mengubah ke angka.
export type Settings = {
  session_reuse_minutes: string; log_max_bytes: string;
  artifact_retention_days: string; report_retention_days: string;
  log_retention_days: string; max_queue_length: string;
  max_upload_mb: string; range_default_days: string;
};
export type CliToken = {
  id: string; label: string | null; created_at: string;
  last_used_at: string | null; revoked_at: string | null;
};
export type AuditRow = {
  id: string; user_id: string | null; action: string; entity: string;
  entity_id: string | null; detail: string | null; created_at: string;
};


export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let msg = `Request gagal (${res.status})`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* teks mentah */ }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/me"),

  projects: () => request<Project[]>("/api/projects"),
  patchProject: (id: string, body: Partial<Pick<Project, "base_url" | "staging_url" | "local_url" | "origins" | "allow_production">>) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  settings: () => request<Settings>("/api/settings"),
  patchSettings: (body: Partial<Record<keyof Settings, number>>) =>
    request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),

  cliTokens: () => request<CliToken[]>("/api/auth/cli-token"),
  createCliToken: (label: string) =>
    request<{ id: string; token: string; label: string | null }>("/api/auth/cli-token", {
      method: "POST", body: JSON.stringify({ label }),
    }),
  revokeCliToken: (id: string) =>
    request<null>(`/api/auth/cli-token/${id}`, { method: "DELETE" }),

  audit: (limit = 50) => request<AuditRow[]>(`/api/audit?limit=${limit}`),

  testFiles: (q: { project?: string; tool?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.project) p.set("project", q.project);
    if (q.tool) p.set("tool", q.tool);
    const s = p.toString();
    return request<TestFile[]>("/api/test-files" + (s ? "?" + s : ""));
  },
  patchTestFile: (id: string, body: Partial<Pick<TestFile, "code" | "config" | "label" | "enabled">>) =>
    request<TestFile>(`/api/test-files/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  sessions: (q: { project?: string; status?: string; from?: string; to?: string; range?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return request<Session[]>("/api/sessions" + (s ? "?" + s : ""));
  },
  stats: (q: { project?: string; range?: number; failures?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.project) p.set("project", q.project);
    if (q.range) p.set("range", String(q.range));
    if (q.failures) p.set("failures", String(q.failures));
    const s = p.toString();
    return request<Stats>("/api/stats" + (s ? "?" + s : ""));
  },
  session: (id: string) => request<Session>(`/api/sessions/${id}`),
  createSession: async (projectId: string, env: string, confirm?: string) => {
    const res = await fetch("/api/sessions", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, env, confirm }),
    });
    const body = await res.json().catch(() => ({}));
    // 409 = sesi terbuka sudah ada → pakai itu, bukan error.
    if (res.status === 409 && body?.sessionId) {
      const session = await request<Session>(`/api/sessions/${body.sessionId}`);
      return { sessionId: body.sessionId as string, targetUrl: session.target_url, session };
    }
    if (!res.ok) throw new ApiError(body?.error ?? `Request gagal (${res.status})`, res.status);
    return body as { sessionId: string; targetUrl: string; session: Session };
  },
  closeSession: (id: string) => request<Session>(`/api/sessions/${id}/close`, { method: "POST" }),
  deleteSession: (id: string) => request<null>(`/api/sessions/${id}`, { method: "DELETE" }),
  deleteRun: (id: string) => request<null>(`/api/runs/${id}`, { method: "DELETE" }),

  // PRD §10.2/A43: satu klik → smoke Playwright + Lighthouse budget default.
  quickCheck: (projectId: string, env: string, confirm?: string) =>
    request<{ sessionId: string; runIds: string[] }>("/api/quick-check", {
      method: "POST", body: JSON.stringify({ projectId, env, confirm }),
    }),

  createRun: (sessionId: string, testFileId: string) =>
    request<{ runId: string }>(`/api/sessions/${sessionId}/runs`, {
      method: "POST", body: JSON.stringify({ testFileId }),
    }),
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  runs: (q: { project?: string; tool?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.project) p.set("project", q.project);
    if (q.tool) p.set("tool", q.tool);
    if (q.limit) p.set("limit", String(q.limit));
    const s = p.toString();
    return request<RunRow[]>("/api/runs" + (s ? "?" + s : ""));
  },
  lighthouse: (q: { project?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.project) p.set("project", q.project);
    if (q.limit) p.set("limit", String(q.limit));
    const s = p.toString();
    return request<LighthouseRow[]>("/api/lighthouse" + (s ? "?" + s : ""));
  },
  runLogs: (id: string, after = 0) => request<{ logs: LogEntry[]; hasMore: boolean; nextAfter: number }>(
    `/api/runs/${id}/logs?after=${after}`),
  cancelRun: (id: string) => request<Run>(`/api/runs/${id}/cancel`, { method: "POST" }),

  createReport: (sessionId: string, scope: "pw" | "lh" | "both") =>
    request<{ reportId: string; runIds: string[] }>(`/api/sessions/${sessionId}/reports`, {
      method: "POST", body: JSON.stringify({ scope }),
    }),
  report: (id: string) => request<Report>(`/api/reports/${id}`),
};

export type LogEntry = { seq: number; stream: string; text: string; at: string };

export const artifactUrl = (runId: string, path: string) =>
  `/artifacts/${runId}/${path.split("/").map(encodeURIComponent).join("/")}`;

export const reportUrl = (reportId: string, path = "index.html") =>
  `/artifacts/reports/${reportId}/${path}`;

export const fmtDur = (ms: number | null) => {
  if (ms == null) return "—";
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
};
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
