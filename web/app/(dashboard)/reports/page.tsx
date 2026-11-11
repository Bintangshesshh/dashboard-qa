"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, fmtDate, groupProjects, type Project, type Stats } from "../../../lib/playbook";
import { RunBar } from "../../_components/run-bar";

// Satu kartu per project, selalu tampil walau belum ada sesi.
export default function ReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [shortcut, setShortcut] = useState("Ctrl+K");
  const searchRef = useRef<HTMLInputElement>(null);
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTopbar(document.getElementById("pb-reports-search-slot"));
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    // all=true: report project arsip harus tetap bisa dibuka.
    // statsAll: satu request untuk semua kartu, bukan satu per project.
    Promise.all([api.projects({ all: true }), api.statsAll()])
      .then(([ps, st]) => { setProjects(ps); setStats(st); })
      .catch(e => setError(e.message));
  }, []);

  const term = q.trim().toLowerCase();
  const groups = groupProjects(projects)
    .map(g => ({
      ...g,
      items: g.name.toLowerCase().includes(term)
        ? g.items
        : g.items.filter(p => p.name.toLowerCase().includes(term)),
    }))
    .filter(g => g.items.length > 0);

  const search = <div className="pb-reports-search">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
    </svg>
    <input ref={searchRef} className="pb-input" value={q}
      onChange={e => setQ(e.target.value)} placeholder="Cari grup atau project"
      aria-label="Cari grup atau project" />
    <kbd>{shortcut}</kbd>
  </div>;

  return (
    <>
      {topbar && createPortal(search, topbar)}
      {error && <div className="pb-err" role="alert">{error}</div>}

      {!error && projects.length === 0 ? (
        <p className="pb-empty">Belum ada project.</p>
      ) : !error && groups.length === 0 ? (
        <p className="pb-empty">Tidak ada grup atau project yang cocok.</p>
      ) : !error && (
        // Laporan dikelompokkan per grup project supaya daftar panjang tidak menumpuk.
        groups.map(g => (
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
                          {s?.sessions ?? 0} sesi - {s?.runs ?? 0} run
                          {failedRuns > 0 && ` - ${failedRuns} gagal`}
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
