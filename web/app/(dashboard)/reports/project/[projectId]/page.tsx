"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, reportUrl, runStatusLabel, type Project, type Session } from "../../../../../lib/playbook";
import { ArtifactLink } from "../../../../_components/report-link";

export default function ProjectReports() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [projectError, setProjectError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.sessions({ project: projectId }).then(setSessions).catch(e => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    // all=true: halaman project arsip tetap harus terbuka.
    api.projects({ all: true })
      .then(ps => {
        const found = ps.find(p => p.id === projectId) ?? null;
        setProject(found);
        if (!found) setProjectError("Project tidak ditemukan");
      })
      .catch(e => setProjectError(e.message));
    load();
  }, [projectId, load]);

  const quickCheck = async () => {
    if (!project) return;
    setBusy(true); setError(""); setNotice("");
    // Urutan env: staging, lalu production (situs asli, wajib konfirmasi user),
    // lalu local. local_url bukan default karena biasanya menunjuk dev server dashboard.
    const env = project.staging_url ? "staging" : project.base_url ? "production" : "local";
    let confirm: string | undefined;
    if (env === "production") {
      const typed = window.prompt(`Ketik nama project (${project.name}) untuk konfirmasi production:`);
      if (typed !== project.name) { setBusy(false); setNotice("Quick check production dibatalkan."); return; }
      confirm = typed;
    }
    try {
      const r = await api.quickCheck(projectId, env, confirm, "project");
      setNotice(`Quick check jalan (${r.runIds.length} run).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      {projectError && <div className="pb-err">{projectError}</div>}

      <div className="pb-head">
        <div>
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
                  <td><span className={`pb-badge ${s.status}`}>{runStatusLabel(s.status)}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.run_count ? (
                      <span title={`${s.pw_count ?? 0} Playwright, ${s.lh_count ?? 0} Lighthouse`}>
                        {s.run_count} run
                        {(s.pw_count ?? 0) > 0 && <span className="pb-muted"> · pw {s.pw_count}</span>}
                        {(s.lh_count ?? 0) > 0 && <span className="pb-muted"> · lh {s.lh_count}</span>}
                        {(s.failed_count ?? 0) > 0 && <span className="pb-badge failed" style={{ marginLeft: 6 }}>{s.failed_count}</span>}
                        {(s.active_count ?? 0) > 0 && <span className="pb-badge running" style={{ marginLeft: 6 }}>jalan</span>}
                      </span>
                    ) : <span className="pb-muted">-</span>}
                  </td>
                  <td>
                    {(s.reports?.length ?? 0) === 0
                      ? <span className="pb-muted">-</span>
                      : s.reports!.map(rep => {
                        const canOpen = rep.status === "ready" || (rep.status === "stale" && !!rep.path);
                        const title = [rep.scope, rep.status, rep.mode ?? "-", fmtDate(rep.built_at)].join(" | ");
                        // ArtifactLink mengecek file dulu: report yang sudah dibuang
                        // retensi tampil sebagai teks, bukan tombol ke {"error":"Not found"}.
                        return canOpen
                          ? <span key={rep.id} style={{ marginRight: 6 }} title={title}>
                              <ArtifactLink href={reportUrl(rep.id)} missing={`${rep.scope} report hilang`}>{rep.scope}</ArtifactLink>
                            </span>
                          : <span key={rep.id} className="pb-muted mono" title={title}
                              style={{ marginRight: 6, fontSize: 11 }}>{rep.scope} {rep.status}</span>;
                      })}
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
