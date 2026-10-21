// QA Dashboard derivations over the real backend payloads (server/index.mjs).
// The ui/ mock (seed 20261020) is gone: every number here comes from /api/runs + /api/suites.

export type Case = { id: string; name: string; code: string; enabled: boolean };
export type Suite = { id: string; name: string; description: string; targetUrl: string; cases: Case[] };
export type Summary = { passed: number; failed: number; skipped: number; total: number; durationMs: number };
export type Run = {
  id: string;
  suiteId: string;
  suiteName: string;
  targetUrl: string;
  mode: string;
  headed: boolean;
  status: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  artifacts?: string[];
  reportUrl?: string;
  docsStatus?: string;
  summary?: Summary;
};

export type Row = {
  id: string;
  project: string;
  suite: string;
  mode: string;
  status: "passed" | "failed" | "running";
  startedAt: string;
  durationMs: number | null;
  passed: number;
  failed: number;
  flaky: number;
  spec: string | null;
  browser: string | null;
  message: string | null;
  run: Run;
};

export const MODE: Record<string, string> = { pw: "Playwright", lh: "Lighthouse", both: "Playwright + Lighthouse" };
export const PROJECTS = ["jaja", "masdis", "ebh"];
export const TITLES: Record<string, [string, string]> = {
  overview: ["Overview", "Quality signals across every project at a glance."],
  runs: ["Runs", "Every execution with duration, mode and report link."],
  failures: ["Failures", "Triage what broke and open the failing run."],
  projects: ["Projects", "Per-project health, volume and last activity."],
};

// Projects are encoded in the suite name prefix (co-jaja checkout -> jaja).
export const projectOf = (r: Run) => {
  const name = r.suiteName || "";
  const hit = PROJECTS.find(p => name.includes(p));
  if (hit) return hit;
  const head = name.split(/[\s/_-]+/).filter(Boolean)[0];
  return head || "unassigned";
};

// No backend field for these yet; kept explicit so the UI never invents a value.
const SPEC = /([\w./-]+\.(?:spec|test)\.[cm]?[jt]sx?):(\d+)/;
const BROWSER = /\b(chromium|firefox|webkit)\b/i;
const specOf = (run: Run) => run.error?.match(SPEC);
const browserOf = (run: Run) => run.error?.match(BROWSER)?.[1].toLowerCase() ?? null;
const firstLine = (run: Run) => run.error?.split("\n").find(l => l.trim())?.trim() ?? null;

export const toRow = (run: Run): Row => ({
  id: run.id,
  project: projectOf(run),
  suite: run.suiteName || "—",
  mode: MODE[run.mode] ?? run.mode,
  status: run.status === "passed" || run.status === "failed" ? run.status : "running",
  startedAt: run.startedAt,
  durationMs: run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null,
  passed: run.summary?.passed ?? 0,
  failed: run.summary?.failed ?? 0,
  flaky: 0, // backend has no flaky counter; retried-and-passed needs a retry record
  spec: specOf(run)?.[0] ?? null,
  browser: browserOf(run),
  message: firstLine(run),
  run,
});

export type Stats = { total: number; passed: number; failed: number; flaky: number; rate: number; avg: number };

export const stats = (rows: Row[]): Stats => {
  const total = rows.reduce((n, r) => n + r.passed + r.failed, 0);
  const passed = rows.reduce((n, r) => n + r.passed, 0);
  const durations = rows.map(r => r.durationMs).filter((n): n is number => n !== null);
  return {
    total,
    passed,
    failed: rows.reduce((n, r) => n + r.failed, 0),
    flaky: rows.reduce((n, r) => n + r.flaky, 0),
    rate: total ? Math.round((passed / total) * 1000) / 10 : 0,
    avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
  };
};

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const dur = (ms: number | null) =>
  ms === null ? "—" : `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`;
export const statusLabel = (s: string) => s[0].toUpperCase() + s.slice(1);

export const days = (range: number, now = Date.now()) =>
  Array.from({ length: range }, (_, i) => {
    const d = new Date(now - (range - 1 - i) * 864e5);
    return { key: d.toDateString(), label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) };
  });

export const within = (rows: Row[], range: number, project: string, now = Date.now()) => {
  const since = now - range * 864e5;
  return rows.filter(r => Date.parse(r.startedAt) >= since && (project === "all" || r.project === project));
};
