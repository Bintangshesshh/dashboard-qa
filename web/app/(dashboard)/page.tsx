"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api, fmtDate, fmtDur, runStatusLabel,
  type Project, type RunRow, type Session, type Stats, type TestFile,
} from "../../lib/playbook";

const RANGES = [7, 14, 30];

// Ringkasan config lhci aktif; dipakai chip di header supaya angka audit kelihatan
// tanpa membuka Settings.
type LhCfg = { urls?: string[]; numberOfRuns?: number; budgets?: Record<string, { minScore: number }> };

const lhSummary = (cfg: LhCfg | null) => {
  if (!cfg) return null;
  const urls = 1 + (cfg.urls?.length ?? 0);
  const runs = cfg.numberOfRuns ?? 1;
  const mins = Object.values(cfg.budgets ?? {}).map(b => b?.minScore ?? 0.6);
  const min = mins.length ? Math.round(Math.min(...mins) * 100) : 60;
  return { urls, runs, min };
};

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // Pass rate per project untuk kartu project (prototype: .project-card).
  const [perProject, setPerProject] = useState<Record<string, Stats>>({});
  const [projectId, setProjectId] = useState("");
  const [range, setRange] = useState(14);
  // Feed "Run terakhir": semua status, termasuk yang sedang berjalan.
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  // Ringkasan config lhci project terpilih untuk chip header.
  const [lhCfg, setLhCfg] = useState<LhCfg | null>(null);
  // Satu config per project; "Semua project" tidak punya satu angka audit.
  useEffect(() => {
    if (!projectId) { setLhCfg(null); return; }
    api.testFiles({ project: projectId, tool: "lh" })
      .then(list => setLhCfg(list[0]?.config ? JSON.parse(list[0].config) : null))
      .catch(() => setLhCfg(null));
  }, [projectId]);

  useEffect(() => {
    api.projects().then(setProjects).catch(e => setError(e.message));
    // B11: range awal ikut settings `range_default_days`; viewer 403 → tetap 14.
    api.settings()
      .then(s => { const d = Number(s.range_default_days); if (d > 0) setRange(d); })
      .catch(() => {});
  }, []);

  // Polling 5 dtk supaya run yang baru mulai/selesai langsung terlihat.
  // Tab tersembunyi dilonggarkan ke 15 dtk: hemat request, tetap segar saat dibuka.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      const q = { range, project: projectId || undefined };
      try {
        const [s, st, rs] = await Promise.all([
          api.sessions(q), api.stats({ ...q, failures: 5 }),
          api.runs({ project: projectId || undefined, limit: 8 }),
        ]);
        if (!alive) return;
        setSessions(s); setStats(st); setRuns(rs);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) timer = setTimeout(refresh, document.hidden ? 15000 : 5000);
    };

    refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [range, projectId]);

  // Stats per project: dipakai kartu project. Jumlah project kecil, aman di-fetch semua.
  useEffect(() => {
    let alive = true;
    Promise.all(projects.map(p => api.stats({ range, project: p.id }).then(s => [p.id, s] as const)))
      .then(pairs => { if (alive) setPerProject(Object.fromEntries(pairs)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projects, range]);

  const rate = stats?.passRate == null ? null : Math.round(stats.passRate * 100);
  const rateClass = rate == null ? "" : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad";
  const lh = stats?.lighthouse ?? null;
  const daily = stats?.daily ?? [];
  const maxDay = Math.max(1, ...daily.map(d => d.total));
  const lastSession = sessions[0] ?? null;

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Kondisi QA hari ini.</h1>
          <p className="pb-lead">
            {stats
              ? `${stats.failedRuns} run gagal dari ${stats.runs} run final${projectId ? ` di ${projects.find(p => p.id === projectId)?.name ?? "project terpilih"}` : " di semua project"}.`
              : "Memuat ringkasan…"}
          </p>
        </div>
        <div className="pb-filters">
          <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Project">
            <option value="">Semua project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="pb-select" value={String(range)} onChange={e => setRange(Number(e.target.value))} aria-label="Rentang">
            {RANGES.map(d => <option key={d} value={d}>{d} hari</option>)}
          </select>
          <Link className="pb-chip-link" href="/settings" title="Seting audit Lighthouse project ini">
            {(() => {
              const s = lhSummary(lhCfg);
              return s ? `${s.urls} URL · ${s.runs}× run · batas ${s.min}%` : "Seting audit";
            })()}
          </Link>
          {lastSession && (
            <Link className="pb-btn" href={`/reports/${lastSession.id}`}>Buka sesi terakhir</Link>
          )}
        </div>
      </div>

      {error && <div className="pb-err">{error}</div>}

      <div className="pb-grid kpi" style={{ marginBottom: 16 }}>
        <article className="pb-card pb-kpi">
          <div className="pb-kpi-label">Total sesi</div>
          <div>
            <div className="pb-kpi-val">{stats?.sessions ?? "-"}</div>
            <div className="pb-kpi-foot"><span className="dot" /><strong>{projects.length} project</strong> · {stats?.runs ?? 0} run</div>
          </div>
        </article>

        <article className="pb-card pb-kpi pb-kpi-donut">
          <div className="pb-kpi-label">Pass rate TC</div>
          <div className="pb-donut-wrap">
            <svg className="pb-donut" viewBox="0 0 120 120" role="img"
              aria-label={rate == null ? "Pass rate belum ada data" : `Pass rate ${rate} persen`}>
              <circle className="pb-donut-track" cx="60" cy="60" r="50" />
              <circle className={`pb-donut-val ${rateClass}`} cx="60" cy="60" r="50"
                strokeDasharray={314} strokeDashoffset={314 - (314 * (rate ?? 0)) / 100} />
              <text className="pb-donut-num" x="60" y="66" textAnchor="middle">{rate == null ? "-" : `${rate}%`}</text>
            </svg>
          </div>
        </article>

        <article className="pb-card pb-kpi">
          <div className="pb-kpi-label">Rata-rata durasi</div>
          <div>
            <div className="pb-kpi-val">{stats ? fmtDur(stats.avgDurationMs) : "-"}</div>
            <div className="pb-kpi-foot"><span className="dot" />{stats?.runs ?? 0} run final</div>
          </div>
        </article>

        <article className="pb-card pb-kpi">
          <div className="pb-kpi-label">Kegagalan</div>
          <div>
            <div className="pb-kpi-val">{stats?.failedRuns ?? "-"}</div>
            <div className="pb-kpi-foot">
              <span className="dot bad" />{stats?.failures?.length ?? 0} sesi terdampak
              {!!stats?.activeRuns && <> · <strong>{stats.activeRuns} berjalan</strong></>}
            </div>
          </div>
        </article>
      </div>

      <div className="pb-grid chart-2-1" style={{ marginBottom: 16 }}>
        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Run per hari</h2>
              <div className="pb-card-sub">Playwright dan Lighthouse, {range} hari terakhir.</div>
            </div>
            <div className="pb-legend">
              <span><i className="pb-swatch" />Lulus</span>
              <span><i className="pb-swatch bad" />Gagal</span>
            </div>
          </div>
          {daily.length === 0 ? (
            <p className="pb-empty">Belum ada run final dalam rentang ini.</p>
          ) : (
            <div className="pb-bars" role="img" aria-label="Grafik jumlah run per hari">
              {daily.map(d => {
                const h = Math.max(4, (d.total / maxDay) * 128);
                const hp = d.total ? (d.passed / d.total) * h : 0;
                return (
                  <div className="pb-bar-col" key={d.day} title={`${d.day}: ${d.total} run, ${d.passed} lulus`}>
                    <span className="pb-bar" style={{ height: h }}>
                      <span className="pb-bar-passed" style={{ height: hp }} />
                    </span>
                    <small>{d.day.slice(5)}</small>
                  </div>
                );
              })}
            </div>
          )}
          <div className="pb-chart-note">
            <span>{stats?.runs ?? 0} run · {stats?.sessions ?? 0} sesi</span>
          </div>
        </section>

        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Kegagalan terbaru</h2>
              <div className="pb-card-sub">Klik untuk membuka sesi.</div>
            </div>
            <Link className="pb-link-muted" href="/reports">Semua</Link>
          </div>
          {(stats?.failures?.length ?? 0) === 0 ? (
            <p className="pb-empty">Tidak ada run gagal dalam {range} hari terakhir.</p>
          ) : (
            <div className="pb-fail-list">
              {stats!.failures.map(f => (
                <Link className="pb-fail-item" key={f.id} href={`/reports/${f.session_id}`}>
                  <span className="pb-fail-dot" />
                  <span>
                    <span className="pb-fail-title">{f.project_name} - {f.tool === "pw" ? "Playwright" : "Lighthouse"}</span>
                    <span className="pb-fail-meta">{f.session_label} · {f.env} · {fmtDate(f.finished_at)}</span>
                    <span className="pb-fail-msg">{f.error ?? "tanpa pesan error"}</span>
                  </span>
                  <span className="pb-fail-arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 6l6 6-6 6" /></svg>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="pb-section-title">
        <h2>Project</h2>
        <span className="eyebrow">{projects.length} aktif</span>
      </div>
      {projects.length === 0 ? (
        <p className="pb-empty">Belum ada project.</p>
      ) : (
        <div className="pb-project-grid">
          {projects.map(p => {
            const ps = perProject[p.id];
            const prate = ps?.passRate == null ? null : Math.round(ps.passRate * 100);
            const tone = prate == null ? "" : prate >= 90 ? "ok" : prate >= 75 ? "warn" : "bad";
            return (
              <Link className="pb-card pb-pcard" key={p.id} href={`/reports/project/${p.id}`}>
                <div className="pb-pcard-top">
                  <div>
                    <h3>{p.name}</h3>
                    <div className="pb-pcard-meta">{ps?.sessions ?? 0} sesi · {ps?.runs ?? 0} run</div>
                  </div>
                  <span className={`pb-badge ${tone === "ok" ? "passed" : tone === "bad" ? "failed" : "queued"}`}>
                    {tone === "ok" ? "Lulus" : tone === "bad" ? "Gagal" : prate == null ? "Belum ada" : "Waspada"}
                  </span>
                </div>
                <div className="pb-pcard-bar"><span style={{ width: `${prate ?? 0}%` }} /></div>
                <div className="pb-pcard-foot">
                  <span>tingkat lulus <strong>{prate == null ? "-" : `${prate}%`}</strong></span>
                  <span>{p.lastRunAt ? fmtDate(p.lastRunAt) : "belum pernah"}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <section className="pb-card" style={{ marginTop: 16 }}>
        <div className="pb-card-head">
          <div>
            <h2>Run terakhir</h2>
            <div className="pb-card-sub">
              Playwright dan Lighthouse, termasuk yang sedang berjalan.
              {!!stats?.activeRuns && ` ${stats.activeRuns} berjalan sekarang.`}
            </div>
          </div>
          <Link className="pb-link-muted" href="/reports">Semua</Link>
        </div>
        {runs.length === 0 ? (
          <p className="pb-empty">Belum ada run.</p>
        ) : (
          <div className="pb-run-feed">
            {runs.map(r => (
              <Link className="pb-run-row" key={r.id} href={`/reports/${r.session_id}`}>
                <span className={`pb-badge ${r.status}`}>{runStatusLabel(r.status)}</span>
                <span className="pb-run-what">
                  <span className="pb-run-title">
                    {r.project_name} · {r.tool === "pw" ? "Playwright" : "Lighthouse"}
                  </span>
                  <span className="pb-run-meta">{r.session_label} · {r.env} · {fmtDate(r.queued_at)}</span>
                  {r.error && <span className="pb-run-err">{r.error}</span>}
                </span>
                <span className="pb-run-dur">{r.duration_ms ? fmtDur(r.duration_ms) : "—"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="pb-card pb-lh" style={{ marginTop: 16 }}>
        <div className="pb-card-head">
          <div>
            <h2>Audit Lighthouse</h2>
            <div className="pb-card-sub">Skor rata-rata per kategori dari run Lighthouse final.</div>
          </div>
          <Link className="pb-link-muted" href="/lighthouse">Buka Lighthouse</Link>
        </div>
        {lh == null ? (
          <p className="pb-empty">Belum ada run Lighthouse dalam {range} hari terakhir.</p>
        ) : (
          <>
            <div className="pb-score-grid">
              {[
                { key: "perf", label: "Performance", v: lh.performance },
                { key: "a11y", label: "Accessibility", v: lh.accessibility },
                { key: "bp", label: "Best practices", v: lh.bestPractices },
                { key: "seo", label: "SEO", v: lh.seo },
              ].map(s => {
                const n = s.v == null ? null : Math.round(s.v * 100);
                const tone = n == null ? "" : n >= 90 ? "ok" : n >= 50 ? "warn" : "bad";
                return (
                  <div className="pb-score" key={s.key}>
                    <svg className="pb-score-ring" viewBox="0 0 76 76" role="img"
                      aria-label={n == null ? `${s.label} belum ada data` : `${s.label} ${n}`}>
                      <circle className="pb-donut-track" cx="38" cy="38" r="30" />
                      <circle className={`pb-donut-val ${tone}`} cx="38" cy="38" r="30"
                        strokeDasharray={188.5} strokeDashoffset={188.5 - (188.5 * (n ?? 0)) / 100} />
                      <text className="pb-score-num" x="38" y="43" textAnchor="middle">{n ?? "-"}</text>
                    </svg>
                    <span className="pb-score-label">{s.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="pb-chart-note">
              <span>{lh.urls} URL diaudit</span>
            </div>
          </>
        )}
      </section>

    </>
  );
}
