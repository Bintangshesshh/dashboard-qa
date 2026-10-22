"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, fmtDur, pct, type Project, type Session, type Stats } from "../../lib/playbook";

const RANGES = [7, 14, 30];

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [projectId, setProjectId] = useState("");
  const [range, setRange] = useState(14);
  const [error, setError] = useState("");

  useEffect(() => {
    api.projects().then(setProjects).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    const q = { range, project: projectId || undefined };
    Promise.all([api.sessions(q), api.stats({ ...q, failures: 5 })])
      .then(([s, st]) => { setSessions(s); setStats(st); })
      .catch(e => setError(e.message));
  }, [range, projectId]);

  const rate = stats?.passRate == null ? null : Math.round(stats.passRate * 100);
  const rateClass = rate == null ? "" : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad";
  const lh = stats?.lighthouse ?? null;
  const daily = stats?.daily ?? [];
  const maxDay = Math.max(1, ...daily.map(d => d.total));

  return (
    <>
      <div className="pb-head">
        <h1>Overview</h1>
        <div className="pb-filters">
          <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Semua project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
        <article className="pb-card pb-kpi" title="Rata-rata skor Lighthouse per kategori. Tidak dicampur ke pass rate TC.">
          <h2>Lighthouse</h2>
          <div className="v">{lh ? pct(lh.performance) : "—"}</div>
          <small>{lh ? `${lh.urls} URL · A11y ${pct(lh.accessibility)} · BP ${pct(lh.bestPractices)} · SEO ${pct(lh.seo)}` : "belum ada data"}</small>
        </article>
      </div>

      <section className="pb-card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Run per hari</h2>
        {daily.length === 0 ? <p className="pb-empty">Belum ada run final dalam rentang ini.</p> : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}>
            {daily.map(d => (
              <div key={d.day} style={{ flex: 1, textAlign: "center" }}
                title={`${d.day}: ${d.total} run, ${d.passed} lulus`}>
                <div style={{
                  height: `${Math.max(4, (d.total / maxDay) * 96)}px`,
                  background: "linear-gradient(180deg, var(--accent), var(--accent-soft))",
                  borderRadius: 4,
                }} />
                <small className="pb-muted" style={{ fontSize: 10 }}>{d.day.slice(5)}</small>
              </div>
            ))}
          </div>
        )}
      </section>

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

      <section className="pb-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Kegagalan terbaru</h2>
        {(stats?.failures?.length ?? 0) === 0
          ? <p className="pb-empty">Tidak ada run gagal dalam {range} hari terakhir.</p>
          : (
            <table className="pb-table">
              <thead><tr><th>Waktu</th><th>Project</th><th>Sesi</th><th>Tool</th><th>Status</th><th>Error</th><th /></tr></thead>
              <tbody>
                {stats!.failures.map(f => (
                  <tr key={f.id}>
                    <td className="mono">{fmtDate(f.finished_at)}</td>
                    <td>{f.project_name}</td>
                    <td>{f.session_label}</td>
                    <td>{f.tool === "pw" ? "Playwright" : "Lighthouse"}</td>
                    <td><span className={`pb-badge ${f.status}`}>{f.status}</span></td>
                    <td className="mono" style={{ maxWidth: 320, overflowWrap: "anywhere" }}>{f.error ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="pb-btn sm" href={`/reports/${f.session_id}`}>Sesi</Link>
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
