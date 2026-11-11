"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, fmtDate, rememberProject, reportUrl, runStatusLabel, type Project, type Session } from "../../../../../lib/playbook";
import { ArtifactLink } from "../../../../_components/report-link";
import { showSuccessToast } from "../../../../../lib/alerts";

export default function ProjectReports() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [projectError, setProjectError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [shortcut, setShortcut] = useState("Ctrl+K");
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTopbar(document.getElementById("pb-reports-search-slot"));
    setShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K");
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const load = useCallback(() => {
    api.sessions({ project: projectId }).then(setSessions).catch(e => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    // all=true: halaman project arsip tetap harus terbuka.
    api.projects({ all: true })
      .then(ps => {
        const found = ps.find(p => p.id === projectId) ?? null;
        setProject(found);
        if (found?.active) rememberProject(found.id);
        if (!found) setProjectError("Project tidak ditemukan");
      })
      .catch(e => setProjectError(e.message));
    load();
  }, [projectId, load]);

  const quickCheck = async () => {
    if (!project || busy) return;
    // Urutan env: staging, production, lalu local. Server tetap memvalidasi
    // izin production sebelum membuat run.
    const env = project.staging_url ? "staging" : project.base_url ? "production" : "local";
    if (env === "production" && !project.allow_production) {
      setError("Quick check production diblokir untuk project ini.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await api.quickCheck(projectId, env, undefined, "project");
      setNotice(`Quick check jalan (${r.runIds.length} run).`);
      showSuccessToast(`Quick check jalan (${r.runIds.length} run).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const term = q.trim().toLowerCase();
  const visibleSessions = sessions.filter(s => {
    if (!term) return true;
    if (s.label.toLowerCase().includes(term) || s.created_at.toLowerCase().includes(term)) return true;
    return [s.created_at, s.last_run_at]
      .filter((value): value is string => !!value)
      .some(value => fmtDate(value).toLowerCase().includes(term) || value.toLowerCase().includes(term));
  });

  const search = <div className="pb-reports-search">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
    </svg>
    <input ref={searchRef} className="pb-input" value={q}
      onChange={e => setQ(e.target.value)} placeholder="Cari tanggal run"
      aria-label="Cari tanggal run" />
    <kbd>{shortcut}</kbd>
  </div>;

  if (projectError && !project) {
    return (
      <section className="pb-card">
        <div className="pb-err" role="alert">{projectError}</div>
        <Link className="pb-btn sm" href="/reports">Kembali ke Laporan</Link>
      </section>
    );
  }

  return (
    <>
      {topbar && createPortal(search, topbar)}
      {projectError && <div className="pb-err" role="alert">{projectError}</div>}

      <div className="pb-head">
        <div>
          <h1>{project?.name ?? "Memuat…"}</h1>
          <p className="pb-muted" style={{ margin: "4px 0 0" }}>{project?.base_url}</p>
        </div>
        <button className="pb-btn sm primary" onClick={quickCheck} disabled={!project || busy}>
          {busy ? "Menjalankan…" : "Quick check"}
        </button>
      </div>

      {error && <div className="pb-err" role="alert">{error}</div>}
      {notice && <div className="pb-card" style={{ marginBottom: 14 }}>{notice}</div>}

      <section className="pb-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Sesi ({visibleSessions.length})</h2>
        {sessions.length === 0 ? (
          <p className="pb-empty">Belum ada sesi untuk project ini. Jalankan quick check atau mulai dari Playwright/Lighthouse.</p>
        ) : visibleSessions.length === 0 ? (
          <p className="pb-empty">Tidak ada sesi dengan tanggal run yang cocok.</p>
        ) : (
          <div className="pb-table-wrap"><table className="pb-table">
            <thead><tr><th>Sesi</th><th>Status</th><th>Run</th><th>Laporan</th><th>Dibuat</th><th /></tr></thead>
            <tbody>
              {visibleSessions.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/reports/${s.id}`}>{s.label}</Link></td>
                  <td><span className={`pb-badge ${s.status}`}>{runStatusLabel(s.status)}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.run_count ? (
                      <span title={`${s.pw_count ?? 0} Playwright, ${s.lh_count ?? 0} Lighthouse`}>
                        {s.run_count} run
                        {(s.pw_count ?? 0) > 0 && <span className="pb-muted"> - pw {s.pw_count}</span>}
                        {(s.lh_count ?? 0) > 0 && <span className="pb-muted"> - lh {s.lh_count}</span>}
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
                        // ArtifactLink mengecek file dulu; report yang kena retensi jadi teks, bukan 404.
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
          </table></div>
        )}
      </section>
    </>
  );
}
