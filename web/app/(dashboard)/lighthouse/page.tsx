"use client";

// /lighthouse (PRD §10.4): config numberOfRuns/URL/budget → test_files.config.
// Config lhci digenerate saat run, bukan disimpan di repo. Layout menumpuk:
// Project → Config → Terminal → Run → Hasil.
import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import LhConfigEditor, { LH_CATEGORIES, extraUrlsOf, lhConfigError, parseLhConfig } from "../../_components/lh-config-editor";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, fmtTime, groupProjects, pct, readLastEnv, readLastProject, rememberEnv, rememberProject, runStatusLabel,
  type LighthouseResult, type LogEntry, type Project, type Run, type TestFile,
} from "../../../lib/playbook";
import { confirmAction, showErrorAlert, showSuccessToast } from "../../../lib/alerts";

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

  // Draft config berupa string JSON apa adanya; editor bersama yang mengubahnya.
  const [config, setConfig] = useState("");
  const [saving, setSaving] = useState(false);
  // Jam simpan terakhir supaya status tidak cuma kata "Tersimpan".
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Data run + terminal, dipisah per project seperti halaman Playwright.
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Ganti project → pasang lagi run project itu (kalau ada), terminal direset.
  useEffect(() => {
    if (!projectId) return;
    setRun(null); setLogs([]);
    setRunId(sessionStorage.getItem(`lh-run:${projectId}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ID tersimpan bisa basi (run dihapus/cancel dari halaman lain).
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || restored.current === runId) return;
    restored.current = runId;
    api.run(runId).catch(() => {
      sessionStorage.removeItem(`lh-run:${projectId}`);
      setRunId(null); setLogs([]);
    });
  }, [runId, projectId]);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      // Pakai project terakhir kalau masih aktif; kalau tidak, project pertama.
      const last = readLastProject();
      if (p.some(x => x.id === last)) setProjectId(last);
      else if (p[0]) setProjectId(p[0].id);
      // Environment ikut pilihan terakhir lintas halaman.
      const lastEnv = readLastEnv();
      if (lastEnv) setEnv(lastEnv as Env);
    }).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "lh" })
      .then(setFiles).catch(e => setError(e.message));
  }, [projectId]);

  const selected = files[0] ?? null;
  const project = projects.find(p => p.id === projectId);
  const target = resolvedUrl(project, env);
  // Server juga menolak production kalau project belum mengizinkannya; tombol
  // jangan aktif dulu supaya user tidak menunggu error yang bisa dicegah.
  const productionBlocked = env === "production" && !project?.allow_production;
  const running = !!run && !FINAL.includes(run.status);

  // Muat config hanya saat file berganti; autosave yang menulis balik tidak boleh reset ketikan.
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
      setSavedAt(new Date().toISOString());
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  // Project tanpa config: buat config default langsung dari halaman run.
  const addConfig = async () => {
    if (!project || saving) return;
    const path = `lighthouserc.${project.slug}.js`;
    if (!(await confirmAction({
      title: "Buat config Lighthouse?",
      text: `${project.name}: target utama, 1 run, budget 60.`,
      confirmButtonText: "Ya, Buat",
    }))) return;
    setSaving(true); setError("");
    try {
      const created = await api.createTestFile({
        projectId,
        tool: "lh",
        path,
        label: `${project.name} Lighthouse`,
        config: {
          urls: [],
          numberOfRuns: 1,
          budgets: Object.fromEntries(LH_CATEGORIES.map(c => [c.key, { minScore: 0.6 }])),
        },
      });
      setFiles([created]);
      setConfig(created.config ?? "");
      showSuccessToast(`${created.label} dibuat.`);
    } catch (e) { showErrorAlert("Gagal membuat config", (e as Error).message); }
    finally { setSaving(false); }
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

  const saveState = saving ? "Menyimpan…" : dirty ? "Belum disimpan"
    : selected ? (savedAt ? `Tersimpan ${fmtTime(savedAt)}` : "Tersimpan") : "";

  const start = async () => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error(`Project ini belum punya URL untuk env ${env}`);
      if (!selected) throw new Error("Project ini belum punya konfigurasi Lighthouse.");
      const msg = validate();
      if (msg) throw new Error(msg);
      // Flush autosave yang masih menunggu supaya run memakai config terbaru.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; await saveConfig(); }
      // Konfirmasi production lewat dialog; server tetap menolak project tanpa allow_production.
      const created = await api.createSession(projectId, env);
      const { runId } = await api.createRun(created.session.id, selected.id);
      sessionStorage.setItem(`lh-run:${projectId}`, runId);
      setRunId(runId);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!runId) return false;
    try { setRun(await api.cancelRun(runId)); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };

  const runNow = async () => {
    if (await start()) showSuccessToast("Audit Lighthouse dimulai.");
  };

  const stopWithConfirm = async () => {
    if (!(await confirmAction({
      icon: "warning",
      title: "Hentikan audit?",
      text: "Audit yang berjalan akan dibatalkan.",
      confirmButtonText: "Ya, Stop",
    }))) return;
    if (await stop()) showSuccessToast("Audit dihentikan.");
  };

  const results = (run?.results ?? []) as LighthouseResult[];
  const done = !!run && FINAL.includes(run.status);

  return (
    <>
      {error && <div className="pb-err" role="alert">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId}
              onChange={e => {
                const id = e.target.value;
                setProjectId(id); rememberProject(id);
              }}>
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
              onChange={e => { const v = e.target.value as Env; setEnv(v); rememberEnv(v); }}>
              {ENVS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0, flex: "1 1 260px" }}>
            Target {env}: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
          <div className="pb-row" style={{ gap: 8, marginLeft: "auto", alignItems: "center" }}>
            <span className="pb-save-state" aria-live="polite">{saveState}</span>
            <button className="pb-btn primary" onClick={runNow}
              disabled={starting || running || !selected || !target || productionBlocked}>
              {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
            </button>
            {running && <button className="pb-btn" onClick={stopWithConfirm}>Stop</button>}
          </div>
        </div>
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
        ) : (
          <div className="pb-empty">
            <p style={{ margin: 0 }}>Project ini belum punya konfigurasi Lighthouse.</p>
            <button className="pb-btn sm primary" style={{ marginTop: 10 }}
              onClick={addConfig} disabled={!project || saving}>
              {saving ? "Membuat…" : "Buat config"}
            </button>
          </div>
        )}
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
              <thead><tr><th>URL</th><th>Mode</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Skor tidak memenuhi</th><th /></tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id}>
                    <td className="mono">{r.url}</td>
                    <td>{r.form_factor === "desktop" ? "Desktop" : "Mobile"}</td>
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
                        ? <ArtifactLink href={artifactUrl(r.run_id, r.report_path) + `#${r.form_factor === "desktop" ? "desktop" : "mobile"}`}>Buka report</ArtifactLink>
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
