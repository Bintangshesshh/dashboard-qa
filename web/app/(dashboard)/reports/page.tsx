"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, groupProjects, type Project, type Stats } from "../../../lib/playbook";
import { RunBar } from "../../_components/run-bar";

// Satu kartu per project, selalu tampil walau belum ada sesi.
export default function ReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    // all=true: report project arsip harus tetap bisa dibuka.
    // statsAll: satu request untuk semua kartu, bukan satu per project.
    Promise.all([api.projects({ all: true }), api.statsAll()])
      .then(([ps, st]) => { setProjects(ps); setStats(st); })
      .catch(e => setError(e.message));
  }, []);

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Laporan per project.</h1>
          <p className="pb-lead">Pilih project untuk melihat sesi, run, dan laporannya.</p>
        </div>
      </div>

      {error && <div className="pb-err" role="alert">{error}</div>}

      {!error && projects.length === 0 ? (
        <p className="pb-empty">Belum ada project.</p>
      ) : !error && (
        // Laporan dikelompokkan per grup project supaya daftar panjang tidak menumpuk.
        groupProjects(projects).map(g => (
          <section className="pb-group-block" key={g.id}>
            <div className="pb-group-label">
              <strong>{g.name}</strong>
              <span className="pb-muted pb-mono">{g.items.length} project</span>
            </div>
            <div className="pb-project-grid">
              {g.items.map(p => {
                const s = stats[p.id];
                const rate = s?.passRate == null ? null : Math.round(s.passRate * 100);
                const tone = rate == null ? "" : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad";
                const running = (s?.activeRuns ?? 0) > 0;
                const failedRuns = s?.failedRuns ?? 0;
                const rateTitle = "Gabungan test case Playwright dan run Lighthouse. Satu run Lighthouse = satu nilai.";
                return (
                  <div className="pb-card pb-pcard" key={p.id}>
                    <div className="pb-pcard-top">
                      <div>
                        <h3>{p.name}{!p.active && <span className="pb-badge closed">Arsip</span>}</h3>
                        <div className="pb-pcard-meta">
                          {s?.sessions ?? 0} sesi · {s?.runs ?? 0} run
                          {failedRuns > 0 && ` · ${failedRuns} gagal`}
                        </div>
                      </div>
                      <span
                        className={`pb-badge ${running ? "running" : tone === "ok" ? "passed" : tone === "warn" ? "warn" : tone === "bad" ? "failed" : "closed"}`}
                        title={running ? `${s!.activeRuns} run sedang berjalan` : s ? `${s.runs ?? 0} run` : "belum ada run"}
                      >
                        {running ? "Berjalan" : tone === "ok" ? "Lulus" : tone === "bad" ? "Gagal" : rate == null ? "Belum ada" : "Waspada"}
                      </span>
                    </div>
                    <RunBar runs={s?.recentRuns ?? []} label={`Riwayat run ${p.name}`} />
                    <div className="pb-pcard-foot">
                      <span title={rateTitle}>Lulus <strong>{rate == null ? "-" : `${rate}%`}</strong></span>
                      <span>{p.lastRunAt ? fmtDate(p.lastRunAt) : "belum pernah"}</span>
                    </div>
                    <Link className="pb-btn sm primary" href={`/reports/project/${p.id}`}>Buka project</Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
