"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, reportUrl, type Project, type Session } from "../../../../../lib/playbook";

export default function ProjectReports() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.sessions({ project: projectId }).then(setSessions).catch(e => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    api.projects().then(ps => setProject(ps.find(p => p.id === projectId) ?? null)).catch(() => {});
    load();
  }, [projectId, load]);

  const quickCheck = async () => {
    if (!project) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await api.quickCheck(projectId, "production", project.name);
      setNotice(`Quick check jalan (${r.runIds.length} run).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Link className="pb-crumb" href="/reports">← Kembali ke Reports</Link>

      <div className="pb-head">
        <div>
          <div className="eyebrow">Reports / {project?.name ?? "…"}</div>
          <h1>{project?.name ?? "Memuat…"}</h1>
          <p className="pb-muted" style={{ margin: "4px 0 0" }}>{project?.base_url}</p>
        </div>
        <button className="pb-btn sm primary" onClick={quickCheck} disabled={!project || busy}>
          {busy ? "Menjalankan…" : "Quick check"}
        </button>
      </div>

      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-card" style={{ marginBottom: 14 }}>{notice}</div>}

      <section className="pb-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Sesi ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <p className="pb-empty">Belum ada sesi untuk project ini. Jalankan quick check atau mulai dari Playwright/Lighthouse.</p>
        ) : (
          <table className="pb-table">
            <thead><tr><th>Sesi</th><th>Status</th><th>Run</th><th>Laporan</th><th>Dibuat</th><th /></tr></thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/reports/${s.id}`}>{s.label}</Link></td>
                  <td><span className={`pb-badge ${s.status}`}>{s.status}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.run_count ? (
                      <span title={`${s.pw_count ?? 0} Playwright, ${s.lh_count ?? 0} Lighthouse`}>
                        {s.run_count} run
                        {(s.pw_count ?? 0) > 0 && <span className="pb-muted"> · pw {s.pw_count}</span>}
                        {(s.lh_count ?? 0) > 0 && <span className="pb-muted"> · lh {s.lh_count}</span>}
                        {(s.failed_count ?? 0) > 0 && <span className="pb-badge failed" style={{ marginLeft: 6 }}>{s.failed_count}</span>}
                        {(s.active_count ?? 0) > 0 && <span className="pb-badge running" style={{ marginLeft: 6 }}>jalan</span>}
                      </span>
                    ) : <span className="pb-muted">—</span>}
                  </td>
                  <td>
                    {(s.reports?.length ?? 0) === 0
                      ? <span className="pb-muted">—</span>
                      : s.reports!.map(rep => (
                        <a key={rep.id} className="pb-btn sm" href={reportUrl(rep.id)} target="_blank" rel="noreferrer"
                          title={`${rep.scope} · ${rep.status}`} style={{ marginRight: 6 }}>{rep.scope}</a>
                      ))}
                  </td>
                  <td className="mono">{fmtDate(s.created_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="pb-btn sm" href={`/reports/${s.id}`}>Detail</Link>
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
