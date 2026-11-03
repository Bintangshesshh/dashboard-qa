"use client";

// /lighthouse (PRD §10.4): config (numberOfRuns, URL tambahan, budget per kategori)
// → test_files.config. Config lhci digenerate saat run, bukan disimpan di repo.
// Layout menumpuk: Project → Config → Terminal → Run → Hasil.
import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, pct, runStatusLabel,
  type LighthouseResult, type LogEntry, type Project, type Run, type TestFile,
} from "../../../lib/playbook";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];


type Budgets = Record<string, { minScore: number }>;

// Matches MAX_LH_URLS on the server: the session target takes one slot.
const MAX_EXTRA_URLS = 2;
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

  // Draft config. Skor disimpan 0-1 di backend, ditampilkan 0-100 di slider.
  const [runs, setRuns] = useState(1);
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  // Run + terminal, dipisah per project seperti halaman Playwright.
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runsByProject, setRunsByProject] = useState<Record<string, string>>({});

  // Ganti project → pasang lagi run project itu (kalau ada), terminal direset.
  useEffect(() => {
    if (!projectId) return;
    setRun(null); setLogs([]);
    setRunId(runsByProject[projectId] ?? sessionStorage.getItem(`lh-run:${projectId}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ID tersimpan bisa basi (run dihapus/cancel dari halaman lain).
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || restored.current === runId) return;
    restored.current = runId;
    api.run(runId).then(() => {}).catch(() => {
      sessionStorage.removeItem(`lh-run:${projectId}`);
      setRunId(null); setLogs([]);
    });
  }, [runId, projectId]);

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

  // Muat config ke form hanya saat file berganti. Kalau bergantung pada
  // `selected`, autosave yang menulis balik akan mereset ketikan user.
  useEffect(() => {
    const cfg: LhConfig = (() => { try { return JSON.parse(selected?.config ?? "{}"); } catch { return {}; } })();
    setRuns(cfg.numberOfRuns ?? 1);
    setExtraUrls(cfg.urls ?? []);
    setScores(Object.fromEntries(CATEGORIES.map(c => [c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100)])));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

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

  const extraUrlList = extraUrls.map(s => s.trim()).filter(Boolean);

  const saveConfig = async () => {
    if (!selected) return;
    if (extraUrlList.length > MAX_EXTRA_URLS) {
      setError(`Maksimal ${MAX_EXTRA_URLS} URL tambahan (target sesi memakai 1 slot dari 3).`);
      return;
    }
    setSaving(true); setError("");
    try {
      const config: LhConfig = {
        urls: extraUrlList,
        numberOfRuns: runs,
        budgets: Object.fromEntries(CATEGORIES.map(c => [c.key, { minScore: (scores[c.key] ?? 60) / 100 }])),
      };
      const updated = await api.patchTestFile(selected.id, { config: JSON.stringify(config) });
      setFiles([updated]);
      setDirty(false);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  // Autosave: berhenti mengubah form 1 dtk = tersimpan. Run tidak perlu klik Simpan.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selected || !dirty) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { saveConfig(); }, 1000);
    return () => { if (pending.current) clearTimeout(pending.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, extraUrls, scores, dirty, selected?.id]);

  const touch = () => setDirty(true);
  const saveState = saving ? "Menyimpan…" : dirty ? "Belum disimpan" : selected ? "Tersimpan" : "";

  const start = async () => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error("Project ini belum punya URL.");
      if (!selected) throw new Error("Project ini belum punya konfigurasi Lighthouse.");
      // Flush autosave yang masih menunggu supaya run memakai config terbaru.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; await saveConfig(); }
      // Konfirmasi production diisi otomatis: UI tidak menampilkan env/konfirmasi.
      const created = await api.createSession(projectId, env, project?.name);
      const { runId } = await api.createRun(created.session.id, selected.id);
      sessionStorage.setItem(`lh-run:${projectId}`, runId);
      setRunsByProject(prev => ({ ...prev, [projectId]: runId }));
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
          <h1>Audit performa.</h1>
          <p className="pb-lead">Pilih project, atur skor minimum, lalu jalankan. Log muncul langsung di bawah.</p>
        </div>
        <div className="pb-filters">
          <span className="pb-save-state" aria-live="polite">{saveState}</span>
          <button className="pb-btn primary" onClick={start}
            disabled={starting || running || !selected || !target}>
            {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
          </button>
          {running && <button className="pb-btn" onClick={stop}>Stop</button>}
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
        <div className="pb-card-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Konfigurasi</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada konfigurasi"}</div>
          </div>
        </div>
        {selected ? (
          <div className="pb-lh-form">
            <div className="pb-field">
              <span>Jumlah run per URL</span>
              <div className="pb-seg" role="group" aria-label="Jumlah run per URL">
                {[1, 2, 3, 5].map(n => (
                  <button key={n} type="button" className={runs === n ? "active" : ""}
                    aria-pressed={runs === n} disabled={running}
                    onClick={() => { setRuns(n); touch(); }}>{n}×</button>
                ))}
              </div>
              <span className="pb-hint">Lebih banyak run = skor lebih stabil, durasi lebih lama.</span>
            </div>

            <div className="pb-field">
              <span>URL tambahan ({extraUrls.filter(u => u.trim()).length}/{MAX_EXTRA_URLS})</span>
              <span className="pb-lh-urls">
                {extraUrls.map((u, i) => (
                  <span className="pb-row" key={i} style={{ gap: 8 }}>
                    <input className="pb-input pb-mono" value={u}
                      placeholder="https://contoh.test/halaman-lain" disabled={running}
                      onChange={e => {
                        const v = e.target.value;
                        setExtraUrls(list => list.map((x, j) => j === i ? v : x));
                        touch();
                      }} />
                    <button type="button" className="pb-btn sm danger" disabled={running}
                      aria-label={"Hapus URL " + (i + 1)}
                      onClick={() => { setExtraUrls(list => list.filter((_, j) => j !== i)); touch(); }}>Hapus</button>
                  </span>
                ))}
                {extraUrls.length < MAX_EXTRA_URLS && (
                  <button type="button" className="pb-btn sm" disabled={running}
                    onClick={() => { setExtraUrls(list => [...list, ""]); touch(); }}>+ Tambah URL</button>
                )}
              </span>
              <span className="pb-hint">Target utama dari project selalu ikut diaudit.</span>
            </div>

            <div className="pb-field">
              <span>Skor minimum per kategori</span>
              <div className="pb-lh-budgets">
                {CATEGORIES.map(c => (
                  <label className="pb-lh-budget" key={c.key}>
                    <span className="pb-lh-budget-top">
                      <span>{c.label}</span>
                      <output>{scores[c.key] ?? 60}%</output>
                    </span>
                    <input type="range" min={0} max={100} step={5} disabled={running}
                      value={scores[c.key] ?? 60} aria-label={"Skor minimum " + c.label}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setScores(s => ({ ...s, [c.key]: v }));
                        touch();
                      }} />
                  </label>
                ))}
              </div>
              <span className="pb-hint">Run dianggap gagal bila skor di bawah batas ini.</span>
            </div>
          </div>
        ) : <p className="pb-empty">Project ini belum punya konfigurasi Lighthouse.</p>}
      </section>

      <RunPanel
        logs={logs}
        run={run}
        live={running}
        downloadHref={runId ? `/api/runs/${runId}/logs/download` : null}
      />
      {done && run && (
        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Hasil audit</h2>
              <div className="pb-card-sub">{results.length} URL diaudit</div>
            </div>
            <span className={`pb-badge ${run.status}`}>{runStatusLabel(run.status)}</span>
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
                    <td className="mono">
                      {r.budget_failed
                        ? r.budget_failed.split(", ").map(f => (
                            <span className="pb-badge failed" key={f} title="Skor di bawah batas">{f}</span>
                          ))
                        : "-"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {r.report_path
                        ? <ArtifactLink href={artifactUrl(r.run_id, r.report_path)}>Buka report</ArtifactLink>
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
