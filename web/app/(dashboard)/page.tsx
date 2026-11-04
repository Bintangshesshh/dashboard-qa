"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  api, fmtDate, fmtDur, runStatusLabel,
  type Project, type RunRow, type Session, type Stats,
} from "../../lib/playbook";

const RANGES = [7, 14, 30];

type DayStat = Stats["daily"][number];
type ChartSeries = { passed: number[]; failed: number[]; max: number };

// Grafik selalu punya jumlah titik tetap supaya bentuk lama bisa bergerak
// mulus ke bentuk baru, termasuk saat jumlah hari berubah 7 ↔ 14 ↔ 30.
const CHART_SAMPLES = 30;
const CHART_MORPH_MS = 600;

// Tanggal WIB (UTC+7), sama dengan pengelompokan grafik di server.
const wibDay = (back = 0) =>
  new Date(Date.now() + 7 * 3600_000 - back * 86_400_000).toISOString().slice(0, 10);

const resampleDaily = (daily: DayStat[]): ChartSeries => {
  const passed: number[] = [];
  const failed: number[] = [];
  const last = Math.max(1, daily.length - 1);
  for (let i = 0; i < CHART_SAMPLES; i++) {
    const pos = (i / (CHART_SAMPLES - 1)) * last;
    const lo = Math.floor(pos);
    const hi = Math.min(last, lo + 1);
    const f = pos - lo;
    const a = daily[lo];
    const b = daily[hi];
    const total = a.total + (b.total - a.total) * f;
    const ok = a.passed + (b.passed - a.passed) * f;
    passed.push(ok);
    failed.push(total - ok);
  }
  return { passed, failed, max: Math.max(1, ...daily.map(d => d.total)) };
};

function useChartMorph(daily: DayStat[]) {
  const key = daily.map(d => `${d.day}:${d.total}:${d.passed}`).join("|");
  const [series, setSeries] = useState<ChartSeries>(() => resampleDaily(daily));
  const current = useRef(series);
  const frame = useRef(0);

  useEffect(() => {
    const to = resampleDaily(daily);
    const from = current.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = to;
      setSeries(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / CHART_MORPH_MS);
      const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const next = {
        passed: from.passed.map((v, i) => v + (to.passed[i] - v) * e),
        failed: from.failed.map((v, i) => v + (to.failed[i] - v) * e),
        max: from.max + (to.max - from.max) * e,
      };
      current.current = next;
      setSeries(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [key]); // key sudah mewakili isi daily; array baru dari polling tidak memicu animasi ulang

  return series;
}

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // Pass rate per project untuk kartu project (prototype: .project-card).
  const [perProject, setPerProject] = useState<Record<string, Stats>>({});
  const [projectId, setProjectId] = useState("");
  const [range, setRange] = useState(14);
  // Rentang yang benar-benar diwakili `stats`; dipakai agar grafik tidak
  // sempat beranimasi ke data lama saat rentang baru belum selesai dimuat.
  const [statsRange, setStatsRange] = useState(0);
  const [chartDaily, setChartDaily] = useState<DayStat[]>([]);
  // Feed "Run terakhir": semua status, termasuk yang sedang berjalan.
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  const [hoverDay, setHoverDay] = useState<number | null>(null);

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
        setSessions(s); setStats(st); setStatsRange(range); setRuns(rs);
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

  // Data grafik baru dipasang setelah stats untuk rentang itu tiba, supaya
  // grafik cuma bergerak sekali ke bentuk akhir.
  useEffect(() => {
    if (!stats || statsRange !== range) return;
    const map = new Map(stats.daily.map(d => [d.day, d]));
    setChartDaily(Array.from({ length: range }, (_, i) => {
      const day = wibDay(range - 1 - i);
      return map.get(day) ?? { day, total: 0, passed: 0 };
    }));
  }, [stats, statsRange, range]);

  // Kartu project dipakai di dalam tiap grup; pass rate dari stats per project.
  const projectCard = (p: Project) => {
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
  };

  // Grup diturunkan dari projects (urutan server sudah nama project);
  // project tanpa grup masuk bucket "Tanpa grup".
  const grouped: { id: string; name: string; items: Project[] }[] = [];
  for (const p of projects) {
    const id = p.group_id ?? "";
    let g = grouped.find(x => x.id === id);
    if (!g) { g = { id, name: p.group_name ?? "Tanpa grup", items: [] }; grouped.push(g); }
    g.items.push(p);
  }
  grouped.sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name)));

  const rate = stats?.passRate == null ? null : Math.round(stats.passRate * 100);
  const rateClass = rate == null ? "" : rate >= 90 ? "ok" : rate >= 75 ? "warn" : "bad";
  const lh = stats?.lighthouse ?? null;
  // Lengkapi hari tanpa run dengan nol supaya garis tidak melompati tanggal.
  // Saat rentang baru masih dimuat, pakai data grafik lama dulu.
  const dailyMap = new Map((stats?.daily ?? []).map(d => [d.day, d]));
  const targetDaily = Array.from({ length: range }, (_, i) => {
    const day = wibDay(range - 1 - i);
    return dailyMap.get(day) ?? { day, total: 0, passed: 0 };
  });
  const daily = chartDaily.length ? chartDaily : targetDaily;
  const totalRuns = daily.reduce((sum, d) => sum + d.total, 0);
  const totalPassed = daily.reduce((sum, d) => sum + d.passed, 0);
  const totalFailed = totalRuns - totalPassed;
  const passRate = totalRuns ? Math.round((totalPassed / totalRuns) * 100) : null;
  const peak = daily.reduce((best, d) => (d.total > best.total ? d : best), daily[0]);
  // Grafik garis mengikuti referensi rw-1058: dua area (lulus/gagal), bukan batang.
  const CHART_W = 640, CHART_H = 230, PAD_X = 44, PAD_Y = 20;
  // Nilai grafik dianimasikan antar-data, bukan diganti mentah-mentah.
  const series = useChartMorph(daily);
  const chartMax = series.max;
  const chartX = (i: number) => daily.length <= 1
    ? CHART_W / 2
    : PAD_X + (i * (CHART_W - PAD_X * 2)) / (daily.length - 1);
  const chartY = (v: number) => CHART_H - PAD_Y - (v / chartMax) * (CHART_H - PAD_Y * 2);
  const seriesX = (i: number) => PAD_X + (i * (CHART_W - PAD_X * 2)) / (CHART_SAMPLES - 1);
  const seriesPoints = (vals: number[]): [number, number][] =>
    vals.map((v, i) => [seriesX(i), chartY(v)]);
  const seriesValue = (vals: number[], frac: number) => {
    const pos = frac * (CHART_SAMPLES - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(CHART_SAMPLES - 1, lo + 1);
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo);
  };
  const smooth = (pts: [number, number][]) => {
    if (pts.length < 2) return "";
    const n = pts.length;
    const h = pts[1][0] - pts[0][0] || 1;
    const delta = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / h);
    // Monotone cubic: datar di puncak/lembah, lurus di tanjakan, tanpa overshoot.
    const slope = new Array<number>(n);
    slope[0] = delta[0];
    slope[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      const a = delta[i - 1], b = delta[i];
      slope[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    }
    let path = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      path += ` C${x0 + h / 3},${y0 + (slope[i] * h) / 3} ${x1 - h / 3},${y1 - (slope[i + 1] * h) / 3} ${x1},${y1}`;
    }
    return path;
  };
  const smoothArea = (pts: [number, number][]) => pts.length < 2
    ? ""
    : `${smooth(pts)} L${pts[pts.length - 1][0]},${CHART_H - PAD_Y} L${pts[0][0]},${CHART_H - PAD_Y} Z`;
  const passedPts = seriesPoints(series.passed);
  const failedPts = seriesPoints(series.failed);
  const labelEvery = Math.max(1, Math.ceil(daily.length / 7));
  const slotW = daily.length > 1 ? (CHART_W - PAD_X * 2) / (daily.length - 1) : CHART_W - PAD_X * 2;
  // Jaga label terakhir tidak menabrak label periodik sebelumnya.
  const labelIdx = daily.map((_, i) => i)
    .filter(i => i % labelEvery === 0 || i === daily.length - 1);
  while (labelIdx.length > 1 && chartX(daily.length - 1) - chartX(labelIdx[labelIdx.length - 2]) < slotW * 1.8) {
    labelIdx.splice(labelIdx.length - 2, 1);
  }
  const hasDailyRuns = totalRuns > 0;
  // Sesi dengan aktivitas terakhir, bukan sesi kosong yang baru dibuat.
  const lastSessionId = runs[0]?.session_id ?? sessions[0]?.id ?? null;

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
            {grouped.map(g => (
              <optgroup key={g.id} label={g.name}>
                {g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
          <select className="pb-select" value={String(range)} onChange={e => setRange(Number(e.target.value))} aria-label="Rentang">
            {RANGES.map(d => <option key={d} value={d}>{d} hari</option>)}
          </select>
          {lastSessionId && (
            <Link className="pb-btn" href={`/reports/${lastSessionId}`}>Buka sesi terakhir</Link>
          )}
        </div>
      </div>

      {error && <div className="pb-err" role="alert">{error}</div>}

      <div className="pb-grid kpi" style={{ marginBottom: 16 }}>
        <article className="pb-card pb-kpi">
          <div className="pb-kpi-label">Total sesi</div>
          <div>
            <div className="pb-kpi-val">{stats?.sessions ?? "-"}</div>
            <div className="pb-kpi-foot"><span className="dot" /><strong>{projectId ? 1 : projects.length} project</strong> · {stats?.runs ?? 0} run</div>
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
              <span className="dot bad" />{stats?.failedSessions ?? 0} sesi terdampak
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
              <div className="pb-card-sub">
                Jumlah run final per tanggal WIB, {range} hari terakhir. Hari tanpa run tetap ditampilkan sebagai nol.
              </div>
            </div>
            <div className="pb-legend">
              <span><i className="pb-swatch" />Lulus</span>
              <span><i className="pb-swatch bad" />Gagal</span>
            </div>
          </div>
          {!hasDailyRuns ? (
            <p className="pb-empty">Belum ada run final dalam {range} hari terakhir.</p>
          ) : (
            <svg className="pb-linechart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img"
              aria-label={`Grafik run per hari, ${range} hari, puncak ${Math.round(chartMax)} run`}>
              <defs>
                <linearGradient id="pb-fill-ok" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--ok)" }} stopOpacity=".28" />
                  <stop offset="100%" style={{ stopColor: "var(--ok)" }} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="pb-fill-bad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--bad)" }} stopOpacity=".22" />
                  <stop offset="100%" style={{ stopColor: "var(--bad)" }} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, .5, 1].map(t => {
                const y = chartY(chartMax * t);
                return (
                  <g key={t}>
                    <line className="pb-chart-grid" x1={PAD_X} x2={CHART_W - PAD_X} y1={y} y2={y} />
                    <text className="pb-chart-y" x={PAD_X - 8} y={y + 3.5} textAnchor="end">
                      {Math.round(chartMax * t)}
                    </text>
                  </g>
                );
              })}
              {daily.length > 1 && (
                <>
                  <path className="pb-chart-area ok" d={smoothArea(passedPts)} />
                  <path className="pb-chart-area bad" d={smoothArea(failedPts)} />
                </>
              )}
              <path className="pb-chart-line bad" d={smooth(failedPts)} />
              <path className="pb-chart-line ok" d={smooth(passedPts)} />
              {daily.map((d, i) => {
                const frac = daily.length > 1 ? i / (daily.length - 1) : 0;
                const ok = d.passed;
                const bad = d.total - d.passed;
                const okY = chartY(seriesValue(series.passed, frac));
                const badY = chartY(seriesValue(series.failed, frac));
                const isHover = hoverDay === i;
                // Hari tanpa run tidak perlu dua titik nol yang menumpuk.
                const hasRuns = d.total > 0;
                return (
                  <g key={d.day}>
                    <rect className="pb-chart-hit"
                      x={Math.max(0, chartX(i) - slotW / 2)} y={PAD_Y}
                      width={slotW} height={CHART_H - PAD_Y * 2}
                      tabIndex={0} role="img"
                      aria-label={`${d.day}: ${ok} lulus, ${bad} gagal`}
                      onPointerEnter={() => setHoverDay(i)}
                      onPointerLeave={() => setHoverDay(null)}
                      onFocus={() => setHoverDay(i)}
                      onBlur={() => setHoverDay(null)} />
                    {isHover && (
                      <line className="pb-chart-guide" x1={chartX(i)} x2={chartX(i)}
                        y1={PAD_Y} y2={CHART_H - PAD_Y} />
                    )}
                    {hasRuns ? (
                      <>
                        <circle className="pb-chart-dot ok" cx={chartX(i)} cy={okY}
                          r={isHover ? 4.2 : 2.8} />
                        {bad > 0 && (
                          <circle className="pb-chart-dot bad" cx={chartX(i)} cy={badY}
                            r={isHover ? 4.2 : 2.8} />
                        )}
                      </>
                    ) : isHover && (
                      <circle className="pb-chart-dot zero" cx={chartX(i)} cy={okY} r="4.2" />
                    )}
                    {isHover && (hasRuns ? (
                      <>
                        <text className="pb-chart-value ok" x={chartX(i)}
                          y={Math.max(12, okY - 9)} textAnchor="middle">{ok}</text>
                        {bad > 0 && (
                          <text className="pb-chart-value bad" x={chartX(i)}
                            y={Math.min(CHART_H - 16, badY + 15)} textAnchor="middle">{bad}</text>
                        )}
                      </>
                    ) : (
                      <text className="pb-chart-value zero" x={chartX(i)}
                        y={okY - 9} textAnchor="middle">0</text>
                    ))}
                    {(labelIdx.includes(i) || isHover) && (
                      <text className={`pb-chart-label${isHover ? " active" : ""}`} x={chartX(i)} y={CHART_H - 4} textAnchor="middle">
                        {d.day.slice(5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          <div className="pb-chart-note">
            <span><strong>{totalRuns}</strong> run final</span>
            <span><i className="pb-swatch" />{totalPassed} lulus</span>
            <span><i className="pb-swatch bad" />{totalFailed} gagal</span>
            <span>Tingkat lulus <strong>{passRate == null ? "-" : `${passRate}%`}</strong></span>
            {hasDailyRuns && <span>Puncak <strong>{peak.total}</strong> run · {peak.day.slice(5)}</span>}
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

      <section className="pb-card" style={{ marginBottom: 20 }}>
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
                  <span className="pb-run-meta">
                    <span className="pb-run-by">{r.run_by}</span>
                    <span>{r.session_label}</span>
                    <span>{r.env}</span>
                    <span>{fmtDate(r.queued_at)}</span>
                  </span>
                  {r.error && <span className="pb-run-err">{r.error}</span>}
                </span>
                <span className="pb-run-dur">{r.duration_ms ? fmtDur(r.duration_ms) : "—"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="pb-section-title">
        <h2>Project</h2>
        <span className="eyebrow">{projectId ? 1 : projects.length} aktif</span>
      </div>
      {projects.length === 0 ? (
        <p className="pb-empty">Belum ada project.</p>
      ) : (
        // Grup hanya pengelompokan tampilan; daftarnya diturunkan dari
        // projects.group_name, jadi tidak butuh endpoint agregasi baru.
        grouped.map(g => (
          <section className="pb-group-block" key={g.id}>
            <div className="pb-group-label">
              <strong>{g.name}</strong>
              <span className="pb-muted pb-mono">{g.items.length} project</span>
            </div>
            <div className="pb-project-grid">
              {g.items.map(p => projectCard(p))}
            </div>
          </section>
        ))
      )}

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
