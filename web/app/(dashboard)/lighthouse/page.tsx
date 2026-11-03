"use client";

// /lighthouse (PRD §10.4): config (numberOfRuns, URL tambahan, budget per kategori)
// → test_files.config. Config lhci digenerate saat run, bukan disimpan di repo.
// Layout menumpuk: Project → Config → Terminal → Run → Hasil.
import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import LhConfigEditor, { LH_CATEGORIES, extraUrlsOf, lhConfigError, parseLhConfig } from "../../_components/lh-config-editor";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, groupProjects, pct, runStatusLabel,
  type LighthouseResult, type LogEntry, type Project, type Run, type TestFile,
} from "../../../lib/playbook";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];


type Env = "local" | "staging" | "production";
const ENVS: Env[] = ["local", "staging", "production"];

// Target ikut env. Kosong = project belum mengisi URL untuk env itu.
const resolvedUrl = (p: Project | undefined, e: Env) =>
  !p ? "" : e === "local" ? p.local_url ?? "" : e === "staging" ? p.staging_url ?? "" : p.base_url;

export default function LighthousePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [projectId, setProjectId] = useState("");
  // Default local: kasus utama menguji web yang jalan di laptop sendiri.
  const [env, setEnv] = useState<Env>("local");
  // Konfirmasi production: ketik nama project. Guard sama ada di server.
  const [confirmName, setConfirmName] = useState("");

  // Draft config berupa string JSON apa adanya; editor bersama yang mengubahnya.
  const [config, setConfig] = useState("");
  const [saving, setSaving] = useState(false);
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
  const target = resolvedUrl(project, env);
  const productionOk = env !== "production" || confirmName.trim() === (project?.name ?? "");
  const running = !!run && !FINAL.includes(run.status);

  // Muat config hanya saat file berganti. Kalau bergantung pada `selected`,
  // autosave yang menulis balik akan mereset ketikan user.
  useEffect(() => {
    setConfig(selected?.config ?? "");
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

  const dirty = !!selected && config !== (selected.config ?? "");

  // Validasi client sebelum simpan: server tetap memeriksa hal yang sama.
  const validate = () => {
    if (!project) return "Project tidak ditemukan.";
    const cfg = parseLhConfig(config);
    return lhConfigError({
      target,
      extra: extraUrlsOf(cfg, project),
      runs: cfg.numberOfRuns ?? 1,
      scores: Object.fromEntries(LH_CATEGORIES.map(c => [
        c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100),
      ])),
    });
  };

  const saveConfig = async () => {
    if (!selected) return;
    const msg = validate();
    if (msg) { setError(msg); return; }
    setSaving(true); setError("");
    try {
      const updated = await api.patchTestFile(selected.id, { config });
      setFiles([updated]);
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
  }, [config, dirty, selected?.id]);

  const saveState = saving ? "Menyimpan…" : dirty ? "Belum disimpan" : selected ? "Tersimpan" : "";

  const start = async () => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error(`Project ini belum punya URL untuk env ${env}`);
      if (env === "production" && confirmName.trim() !== project?.name)
        throw new Error(`Ketik nama project (${project?.name}) untuk konfirmasi production.`);
      if (!selected) throw new Error("Project ini belum punya konfigurasi Lighthouse.");
      const msg = validate();
      if (msg) throw new Error(msg);
      // Flush autosave yang masih menunggu supaya run memakai config terbaru.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; await saveConfig(); }
      // Konfirmasi production diketik user; guard yang sama ada di server.
      const created = await api.createSession(projectId, env, env === "production" ? confirmName : undefined);
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
        </div>
        <div className="pb-filters">
          <span className="pb-save-state" aria-live="polite">{saveState}</span>
          <button className="pb-btn primary" onClick={start}
            disabled={starting || running || !selected || !target || !productionOk}>
            {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
          </button>
          {running && <button className="pb-btn" onClick={stop}>Stop</button>}
        </div>
      </div>
      {error && <div className="pb-err" role="alert">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", gap: 16 }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId}
              onChange={e => { setProjectId(e.target.value); setConfirmName(""); }}>
              {groupProjects(projects).map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="pb-field">
            Environment
            <select className="pb-select" value={env}
              onChange={e => { setEnv(e.target.value as Env); setConfirmName(""); }}>
              {ENVS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Target {env}: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
          {env === "local" && (
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Env local dijalankan dari mesin server dashboard. Kalau dashboard dihosting,
            isi local_url dengan URL tunnel (cloudflared/ngrok) ke web lokal, bukan 127.0.0.1.
          </p>
          )}
        </div>
        {env === "production" && (
          <label className="pb-field" style={{ marginTop: 12 }}>
            Ketik <strong>{project?.name ?? "nama project"}</strong> untuk konfirmasi production
            <input className="pb-input" value={confirmName} onChange={e => setConfirmName(e.target.value)} />
          </label>
        )}
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-card-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Konfigurasi</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada konfigurasi"}</div>
          </div>
        </div>
        {selected && project ? (
          <LhConfigEditor project={project} value={config} target={target}
            disabled={running} onChange={setConfig} idPrefix="lh-page" />
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
            <div className="pb-table-wrap"><table className="pb-table">
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
            </table></div>
          )}
          <div className="pb-row" style={{ marginTop: 12 }}>
            <Link className="pb-btn sm" href={`/reports/${run.session_id}`}>Detail sesi</Link>
          </div>
        </section>
      )}
    </>
  );
}
