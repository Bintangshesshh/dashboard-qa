"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, fmtDur, pct, type Project, type Session, type Stats } from "../../lib/playbook";

const RANGES = [7, 14, 30];

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [range, setRange] = useState(14);
  const [error, setError] = useState("");

  useEffect(() => {
    api.projects().then(setProjects).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    Promise.all([api.sessions({ range }), api.stats({ range })])
      .then(([s, st]) => { setSessions(s); setStats(st); })
      .catch(e => setError(e.message));
  }, [range]);

  const rate = stats?.passRate == null ? null : Math.round(stats.passRate * 100);
  const rateClass = rate == null ? "" : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad";

  return (
    <>
      <div className="pb-head">
        <h1>Overview</h1>
        <div className="pb-row">
          {RANGES.map(d => (
            <button key={d} className={`pb-btn sm${range === d ? " primary" : ""}`} onClick={() => setRange(d)}>
              {d} hari
            </button>
          ))}
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}

      <div className="pb-grid kpi" style={{ marginBottom: 18 }}>
        <article className="pb-card pb-kpi">
          <h2 title="passed / (passed + failed) dari playwright_results pada run pw final. Flaky dihitung lulus. Sesi tanpa run pw tidak masuk penyebut.">
            Pass rate TC
          </h2>
          <div className={`v ${rateClass}`}>{rate == null ? "—" : `${rate}%`}</div>
          <small>{stats ? `${stats.tcPassed} lulus · ${stats.tcFailed} gagal` : "memuat…"}</small>
        </article>
        <article className="pb-card pb-kpi"><h2>Total sesi</h2><div className="v">{stats?.sessions ?? "—"}</div><small>{range} hari terakhir</small></article>
        <article className="pb-card pb-kpi"><h2>Rata-rata durasi</h2><div className="v">{stats ? fmtDur(stats.avgDurationMs) : "—"}</div><small>per run</small></article>
        <article className="pb-card pb-kpi"><h2>Kegagalan</h2><div className="v bad">{stats?.failedRuns ?? "—"}</div><small>run gagal</small></article>
        <article className="pb-card pb-kpi"><h2>Run</h2><div className="v">{stats?.runs ?? "—"}</div><small>final dalam rentang</small></article>
      </div>

      <div className="pb-grid two">
        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Project</h2>
          {projects.length === 0 && <p className="pb-empty">Belum ada project.</p>}
          <table className="pb-table">
            <tbody>
              {projects.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.base_url}</td>
                  <td className="pb-muted">{p.lastRunAt ? fmtDate(p.lastRunAt) : "belum pernah"}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="pb-btn sm" href={`/reports?project=${p.id}`}>Lihat</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Sesi terakhir</h2>
          {sessions.length === 0 && <p className="pb-empty">Belum ada sesi dalam {range} hari terakhir.</p>}
          <table className="pb-table">
            <tbody>
              {sessions.slice(0, 6).map(s => (
                <tr key={s.id}>
                  <td><Link href={`/reports/${s.id}`}>{s.label}</Link></td>
                  <td className="pb-muted">{s.env}</td>
                  <td><span className={`pb-badge ${s.status}`}>{s.status}</span></td>
                  <td className="mono">{fmtDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
