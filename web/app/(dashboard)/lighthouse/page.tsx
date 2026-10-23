"use client";

// /lighthouse (PRD §10.4): config (numberOfRuns, URL tambahan, budget per kategori)
// → test_files.config. Config lhci digenerate saat run, bukan disimpan di repo.
// Layout menumpuk: Project → Config → Terminal → Run → Hasil.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, fmtDate, fmtDur, pct,
  type LighthouseResult, type LogEntry, type Project, type Run, type TestFile,
} from "../../../lib/playbook";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

// Log lama/baru dari lhci menyimpan escape ANSI; buang saat render.
const stripAnsi = (s: string) => s.replace(/\u001b?\[[0-9;]*m/g, "");

type Budgets = Record<string, { minScore: number }>;
type LhConfig = { urls?: string[]; numberOfRuns?: number; budgets?: Budgets };

const CATEGORIES = [
  { key: "categories:performance", label: "Performance" },
  { key: "categories:accessibility", label: "Accessibility" },
  { key: "categories:best-practices", label: "Best practices" },
  { key: "categories:seo", label: "SEO" },
];

// Env UI disembunyikan untuk demo: audit selalu ke web online (base_url).
// ponytail: kalau perlu local/staging lagi, kembalikan resolvedUrl(env).
const liveUrl = (p: Project | undefined) => p?.base_url ?? "";

export default function LighthousePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [projectId, setProjectId] = useState("");
  const env = "production";

  // Draft config
  const [runs, setRuns] = useState(1);
  const [extraUrls, setExtraUrls] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Run + terminal
  // runId di-sessionStorage: pindah ke Overview unmount page, state reset.
  // Restore di sini biar polling + log lanjut saat balik, run backend tak hilang.
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(
    () => (typeof window !== "undefined" ? sessionStorage.getItem("lh-runId") : null),
  );
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (runId) sessionStorage.setItem("lh-runId", runId);
    else sessionStorage.removeItem("lh-runId");
  }, [runId]);

  // Run sudah final: jangan di-restore lagi saat masuk halaman.
  useEffect(() => {
    if (run && FINAL.includes(run.status)) sessionStorage.removeItem("lh-runId");
  }, [run]);

  useEffect(() => {
    api.projects().then(p => { setProjects(p); if (p[0]) setProjectId(p[0].id); })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "lh" })
      .then(setFiles).catch(e => setError(e.message));
  }, [projectId]);

  const selected = files[0] ?? null;
  const project = projects.find(p => p.id === projectId);
  const target = liveUrl(project);
  const running = !!run && !FINAL.includes(run.status);

  // Muat config terpilih ke draft form.
  useEffect(() => {
    const cfg: LhConfig = (() => { try { return JSON.parse(selected?.config ?? "{}"); } catch { return {}; } })();
    setRuns(cfg.numberOfRuns ?? 1);
    setExtraUrls((cfg.urls ?? []).join("\n"));
    setScores(Object.fromEntries(CATEGORIES.map(c => [c.key, cfg.budgets?.[c.key]?.minScore ?? 0.6])));
  }, [selected]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let after = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const [r, l] = await Promise.all([api.run(runId), api.runLogs(runId, after)]);
        if (!alive) return;
        setRun(r);
        if (l.logs.length) { after = l.nextAfter; setLogs(prev => [...prev, ...l.logs]); }
        if (l.hasMore) timer = setTimeout(tick, 0);
        else if (!FINAL.includes(r.status)) timer = setTimeout(tick, 1500);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [runId]);

  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [logs]);

  const saveConfig = async () => {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const config: LhConfig = {
        urls: extraUrls.split("\n").map(s => s.trim()).filter(Boolean),
        numberOfRuns: runs,
        budgets: Object.fromEntries(CATEGORIES.map(c => [c.key, { minScore: scores[c.key] ?? 0.6 }])),
      };
      const updated = await api.patchTestFile(selected.id, { config: JSON.stringify(config) });
      setFiles([updated]);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const start = async () => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error("Project ini belum punya URL.");
      if (!selected) throw new Error("Project ini belum punya config Lighthouse.");
      // Konfirmasi production diisi otomatis: UI tidak menampilkan env/konfirmasi.
      const created = await api.createSession(projectId, env, project?.name);
      const { runId } = await api.createRun(created.session.id, selected.id);
      setRunId(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!runId) return;
    try { setRun(await api.cancelRun(runId)); }
    catch (e) { setError((e as Error).message); }
  };

  const results = (run?.results ?? []) as LighthouseResult[];
  const done = !!run && FINAL.includes(run.status);

  return (
    <>
      <div className="pb-head">
        <div>
          <div className="eyebrow">Lighthouse</div>
          <h1>Audit performa.</h1>
          <p className="pb-lead">Pilih project, atur skor minimum, lalu jalankan. Log muncul langsung di bawah.</p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", gap: 16 }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Target: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
        </div>
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-card-head" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Config</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada config"}</div>
          </div>
          <button className="pb-btn sm primary" onClick={saveConfig} disabled={saving || !selected || running}>
            {saving ? "Menyimpan…" : "Simpan config"}
          </button>
        </div>
        {selected ? (
          <div className="pb-grid" style={{ gap: 12 }}>
            <label className="pb-field">
              numberOfRuns
              <input className="pb-input" type="number" min={1} max={10} value={runs}
                onChange={e => setRuns(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            </label>
            <label className="pb-field">
              URL tambahan (satu per baris)
              <textarea className="pb-input pb-mono" rows={3} value={extraUrls}
                placeholder="https://contoh.test/halaman-lain" onChange={e => setExtraUrls(e.target.value)} />
            </label>
            <div className="pb-grid two">
              {CATEGORIES.map(c => (
                <label className="pb-field" key={c.key}>
                  {c.label} - min skor
                  <input className="pb-input" type="number" min={0} max={1} step={0.05}
                    value={scores[c.key] ?? 0.6}
                    onChange={e => setScores(s => ({ ...s, [c.key]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} />
                </label>
              ))}
            </div>
          </div>
        ) : <p className="pb-empty">Project ini belum punya config Lighthouse.</p>}
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-card-head" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Terminal</h2>
            <div className="pb-card-sub">
              {run ? `${run.status} · ${fmtDur(run.duration_ms)} · ${fmtDate(run.finished_at ?? run.queued_at)}` : "Belum ada run."}
            </div>
          </div>
          {run && <span className={`pb-badge ${run.status}`}>{run.status}</span>}
        </div>
        <div className="pb-term" ref={termRef} style={{ maxHeight: 300, minHeight: 120 }}>
          {logs.length === 0
            ? (runId ? "Menunggu log…" : "Log run akan muncul di sini.")
            : logs.map(l => <div key={l.seq} className={l.stream === "stderr" ? "pb-log-err" : undefined}>{stripAnsi(l.text)}</div>)}
        </div>
        <div className="pb-row" style={{ marginTop: 12 }}>
          <button className="pb-btn primary" onClick={start}
            disabled={starting || running || !selected || !target}>
            {starting ? "Mengantre…" : running ? "Berjalan…" : "Run Lighthouse"}
          </button>
          {running && <button className="pb-btn" onClick={stop}>Stop</button>}
        </div>
      </section>

      {done && run && (
        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Hasil audit</h2>
              <div className="pb-card-sub">{results.length} URL diaudit</div>
            </div>
            <span className={`pb-badge ${run.status}`}>{run.status}</span>
          </div>
          {results.length === 0 ? (
            <p className="pb-empty">Tidak ada hasil Lighthouse pada run ini.</p>
          ) : (
            <table className="pb-table">
              <thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Skor tidak memenuhi</th><th /></tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id}>
                    <td className="mono">{r.url}</td>
                    <td>{pct(r.performance)}</td>
                    <td>{pct(r.accessibility)}</td>
                    <td>{pct(r.best_practices)}</td>
                    <td>{pct(r.seo)}</td>
                    <td className="mono">{r.lcp_ms ? `${Math.round(r.lcp_ms)}ms` : "-"}</td>
                    <td className="mono">{r.budget_failed ?? "-"}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.report_path
                        ? <a className="pb-btn sm" href={artifactUrl(r.run_id, r.report_path)} target="_blank" rel="noreferrer">Buka report</a>
                        : <span className="pb-muted" style={{ fontSize: 12 }}>-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pb-row" style={{ marginTop: 12 }}>
            <Link className="pb-btn sm" href={`/reports/${run.session_id}`}>Detail sesi</Link>
          </div>
        </section>
      )}
    </>
  );
}
