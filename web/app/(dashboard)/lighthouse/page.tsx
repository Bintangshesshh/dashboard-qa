"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, artifactUrl, fmtDate, pct, type LighthouseRow, type Project, type Session, type TestFile } from "../../../lib/playbook";

export default function LighthousePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState("");
  const [env, setEnv] = useState("local");
  const [fileId, setFileId] = useState("");
  const [rows, setRows] = useState<LighthouseRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const selected = files.find(f => f.id === fileId);
  const urls: string[] = (() => {
    try { return JSON.parse(selected?.config ?? "{}")?.urls ?? []; } catch { return []; }
  })();

  const start = async () => {
    setBusy(true); setError("");
    try {
      let s = session;
      if (!s || s.project_id !== projectId || s.env !== env) {
        const created = await api.createSession(projectId, env);
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
      <div className="pb-head"><h1>Lighthouse</h1></div>
      {error && <div className="pb-err">{error}</div>}

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
            <button className="pb-btn primary" onClick={start} disabled={busy || !fileId}>
              {busy ? "Menjalankan…" : "Run Lighthouse"}
            </button>
          </div>
        </section>

        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>URL yang diaudit</h2>
          {urls.length === 0 ? <p className="pb-empty">Config ini belum punya daftar URL.</p> : (
            <ul className="pb-mono" style={{ margin: 0, paddingLeft: 18 }}>
              {urls.map(u => <li key={u}>{u}</li>)}
            </ul>
          )}
        </section>
      </div>

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
