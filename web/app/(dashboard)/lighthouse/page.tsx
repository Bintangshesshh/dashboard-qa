"use client";

// /lighthouse (PRD §10.4): form config (numberOfRuns, URL tambahan, budget per
// kategori) → test_files.config. Config lhci digenerate saat run, bukan disimpan
// sebagai file repo (lihat server/runner.mjs:lhConfig).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, artifactUrl, fmtDate, pct, type LighthouseRow, type Project, type Session, type TestFile } from "../../../lib/playbook";

type Budgets = Record<string, { minScore: number }>;
type LhConfig = { urls?: string[]; numberOfRuns?: number; budgets?: Budgets };

const CATEGORIES = [
  { key: "categories:performance", label: "Performance" },
  { key: "categories:accessibility", label: "Accessibility" },
  { key: "categories:best-practices", label: "Best practices" },
  { key: "categories:seo", label: "SEO" },
];

const resolvedUrl = (p: Project | undefined, env: string) =>
  !p ? "" : env === "local" ? p.local_url ?? "" : env === "staging" ? p.staging_url ?? "" : p.base_url;

export default function LighthousePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState("");
  const [env, setEnv] = useState("local");
  const [fileId, setFileId] = useState("");
  const [rows, setRows] = useState<LighthouseRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Draft form (dipisah dari `selected` supaya bisa Reset tanpa reload).
  const [runs, setRuns] = useState(1);
  const [extraUrls, setExtraUrls] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    api.projects().then(p => { setProjects(p); if (p[0]) setProjectId(p[0].id); })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "lh" })
      .then(f => { setFiles(f); setFileId(f[0]?.id ?? ""); })
      .catch(e => setError(e.message));
    api.lighthouse({ project: projectId, limit: 20 }).then(setRows).catch(e => setError(e.message));
  }, [projectId]);

  const selected = useMemo(() => files.find(f => f.id === fileId), [files, fileId]);
  const project = projects.find(p => p.id === projectId);
  const target = resolvedUrl(project, env);
  // B4 (PRD §10.3/A30): production wajib ketik ulang nama project.
  const [confirmName, setConfirmName] = useState("");
  const productionOk = env !== "production" || confirmName.trim() === (project?.name ?? "");

  // Muat config terpilih ke draft form.
  useEffect(() => {
    const cfg: LhConfig = (() => { try { return JSON.parse(selected?.config ?? "{}"); } catch { return {}; } })();
    setRuns(cfg.numberOfRuns ?? 1);
    setExtraUrls((cfg.urls ?? []).join("\n"));
    setScores(Object.fromEntries(CATEGORIES.map(c => [c.key, cfg.budgets?.[c.key]?.minScore ?? 0.6])));
  }, [selected]);

  // URL yang benar-benar diaudit — cermin lhConfig(): URL sesi dulu, lalu tambahan, dedupe.
  const audited = useMemo(
    () => [...new Set([...(target ? [target] : []), ...extraUrls.split("\n").map(s => s.trim()).filter(Boolean)])],
    [target, extraUrls],
  );

  const saveConfig = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const config: LhConfig = {
        urls: extraUrls.split("\n").map(s => s.trim()).filter(Boolean),
        numberOfRuns: runs,
        budgets: Object.fromEntries(CATEGORIES.map(c => [c.key, { minScore: scores[c.key] ?? 0.6 }])),
      };
      const updated = await api.patchTestFile(selected.id, { config: JSON.stringify(config) });
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      setNotice("Config disimpan.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const start = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!target) throw new Error(`Project ini belum punya URL untuk env ${env}`);
      if (env === "production" && !productionOk) throw new Error(`Ketik nama project (${project?.name}) untuk konfirmasi production.`);
      let s = session;
      if (!s || s.project_id !== projectId || s.env !== env) {
        const created = await api.createSession(projectId, env, env === "production" ? confirmName : undefined);
        s = created.session;
        setSession(s);
      }
      if (!fileId) throw new Error("Pilih config Lighthouse dulu.");
      await api.createRun(s.id, fileId);
      location.href = `/reports/${s.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pb-head">
        <div>
          <div className="eyebrow">Lighthouse</div>
          <h1>Audit performa.</h1>
          <p className="pb-lead">Skor per kategori dari run final terbaru. Budget di bawah ambang ditandai warn.</p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-card" style={{ marginBottom: 14 }}>{notice}</div>}

      <div className="pb-grid two">
        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Jalankan audit</h2>
          <div className="pb-grid" style={{ gap: 12 }}>
            <label className="pb-field">
              Project
              <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="pb-field">
              Environment
              <select className="pb-select" value={env} onChange={e => setEnv(e.target.value)}>
                <option value="local">local</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="pb-field">
              Config
              <select className="pb-select" value={fileId} onChange={e => setFileId(e.target.value)}>
                {files.length === 0 && <option value="">(tidak ada config)</option>}
                {files.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
              Target {env}: <span className="pb-mono">{target || "belum diisi di project"}</span>
            </p>
            {env === "production" && (
              <label className="pb-field">
                Ketik <strong>{project?.name}</strong> untuk konfirmasi production
                <input className="pb-input" value={confirmName} onChange={e => setConfirmName(e.target.value)} />
              </label>
            )}
            <button className="pb-btn primary" onClick={start} disabled={busy || !fileId || !target || !productionOk}>
              {busy ? "Menjalankan…" : "Run Lighthouse"}
            </button>
          </div>
        </section>

        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Config</h2>
          <div className="pb-grid" style={{ gap: 12 }}>
            <label className="pb-field">
              numberOfRuns
              <input className="pb-input" type="number" min={1} max={10}
                value={runs} onChange={e => setRuns(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            </label>
            <label className="pb-field">
              URL tambahan (satu per baris)
              <textarea className="pb-input pb-mono" rows={3} value={extraUrls}
                placeholder={"https://contoh.test/halaman-lain"} onChange={e => setExtraUrls(e.target.value)} />
            </label>
            <div className="pb-grid two">
              {CATEGORIES.map(c => (
                <label className="pb-field" key={c.key}>
                  {c.label} — min skor
                  <input className="pb-input" type="number" min={0} max={1} step={0.05}
                    value={scores[c.key] ?? 0.6}
                    onChange={e => setScores(s => ({ ...s, [c.key]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} />
                </label>
              ))}
            </div>
            <div className="pb-row">
              <button className="pb-btn primary" onClick={saveConfig} disabled={busy || !selected}>Simpan config</button>
              <span className="pb-muted" style={{ fontSize: 12 }}>Config digenerate saat run; file repo tidak diubah.</span>
            </div>
          </div>
        </section>
      </div>

      <section className="pb-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>URL yang akan diaudit ({audited.length})</h2>
        {audited.length === 0
          ? <p className="pb-empty">Belum ada URL: pilih env dengan URL terisi, atau tambah URL di config.</p>
          : <ul className="pb-mono" style={{ margin: 0, paddingLeft: 18 }}>
            {audited.map((u, i) => <li key={u}>{u}{i === 0 && target === u && <span className="pb-muted"> — dari env {env}</span>}</li>)}
          </ul>}
      </section>

      <section className="pb-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Skor per URL</h2>
        {rows.length === 0
          ? <p className="pb-empty">Belum ada hasil Lighthouse untuk project ini.</p>
          : (
            <table className="pb-table">
              <thead><tr><th>Waktu</th><th>Sesi</th><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Budget gagal</th><th /></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="mono">{fmtDate(r.queued_at)}</td>
                    <td><Link href={`/reports/${r.session_id}`}>{r.session_label}</Link></td>
                    <td className="mono">{r.url}</td>
                    <td>{pct(r.performance)}</td>
                    <td>{pct(r.accessibility)}</td>
                    <td>{pct(r.best_practices)}</td>
                    <td>{pct(r.seo)}</td>
                    <td className="mono">{r.lcp_ms ? `${Math.round(r.lcp_ms)}ms` : "—"}</td>
                    <td className="mono">{r.budget_failed ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.report_path
                        ? <a className="pb-btn sm" href={artifactUrl(r.run_id, r.report_path)} target="_blank" rel="noreferrer">Report</a>
                        : <span className="pb-muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </>
  );
}
