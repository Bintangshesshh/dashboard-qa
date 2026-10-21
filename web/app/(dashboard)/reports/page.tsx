"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, fmtDate, type Project, type Session } from "../../../lib/playbook";

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
        <h1>Reports</h1>
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
              <tr><th>Sesi</th><th>Env</th><th>Target</th><th>Status</th><th>Dibuat</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/reports/${s.id}`}>{s.label}</Link></td>
                  <td className="pb-muted">{s.env}</td>
                  <td className="mono">{s.target_url}</td>
                  <td><span className={`pb-badge ${s.status}`}>{s.status}</span></td>
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
