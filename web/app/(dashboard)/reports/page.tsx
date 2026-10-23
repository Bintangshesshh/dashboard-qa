"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, fmtDate, reportUrl, type Project, type Session } from "../../../lib/playbook";

function ReportsInner() {
  const params = useSearchParams();
  const project = params.get("project") ?? "";
  const status = params.get("status") ?? "";
  const range = Number(params.get("range") ?? 0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.sessions({ project: project || undefined, status: status || undefined, range: range || undefined })
      .then(setSessions).catch(e => setError(e.message));
  }, [project, status, range]);

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const link = (patch: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v ? q.set(k, v) : q.delete(k);
    return "/reports?" + q.toString();
  };

  return (
    <>
      <div className="pb-head">
        <div>
          <div className="eyebrow">Reports</div>
          <h1>Sesi dan laporan.</h1>
          <p className="pb-lead">Setiap sesi mengumpulkan run Playwright dan Lighthouse beserta snapshot laporannya.</p>
        </div>
        <div className="pb-filters">
          <select className="pb-select" defaultValue={project}
            onChange={e => { location.href = link({ project: e.target.value }); }}>
            <option value="">Semua project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="pb-select" defaultValue={status}
            onChange={e => { location.href = link({ status: e.target.value }); }}>
            <option value="">Semua status</option>
            {["open", "running", "passed", "failed", "closed"].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="pb-select" defaultValue={String(range || "")}
            onChange={e => { location.href = link({ range: e.target.value }); }}>
            <option value="">Semua waktu</option>
            <option value="7">7 hari</option>
            <option value="14">14 hari</option>
            <option value="30">30 hari</option>
          </select>
        </div>
      </div>

      {error && <div className="pb-err">{error}</div>}

      <section className="pb-card">
        {sessions.length === 0 ? (
          <p className="pb-empty">Tidak ada sesi untuk filter ini.</p>
        ) : (
          <table className="pb-table">
            <thead>
              <tr><th>Sesi</th><th>Target</th><th>Status</th><th>Run</th><th>Laporan</th><th>Dibuat</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/reports/${s.id}`}>{s.label}</Link></td>
                  <td className="mono">{s.target_url}</td>
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
                          title={`${rep.scope} · ${rep.status}`} style={{ marginRight: 6 }}>
                          {rep.scope}
                        </a>
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

export default function ReportsPage() {
  return <Suspense fallback={null}><ReportsInner /></Suspense>;
}
