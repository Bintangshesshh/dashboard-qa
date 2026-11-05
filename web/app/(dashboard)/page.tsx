"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  api, fmtDate, fmtDur, runStatusLabel,
  type Project, type RunRow, type Session, type Stats,
} from "../../lib/playbook";

const RANGES = [7, 14, 30];

type DayStat = Stats["daily"][number];
type Curve = {
  xs: number[]; ok: number[]; bad: number[];
  mOk: number[]; mBad: number[]; max: number;
};
type ChartSeries = { us: number[]; ok: number[]; bad: number[]; max: number };

const CHART_MORPH_MS = 600;
// Jumlah sampel garis; cukup rapat supaya kurva halus tanpa smoothing ulang.
const CHART_SAMPLES = 200;

// Tanggal WIB (UTC+7), sama dengan pengelompokan grafik di server.
const wibDay = (back = 0) =>
  new Date(Date.now() + 7 * 3600_000 - back * 86_400_000).toISOString().slice(0, 10);

// Hari tanpa run tetap tampil sebagai nol.
const fillDaily = (daily: DayStat[], range: number) => {
  const map = new Map(daily.map(d => [d.day, d]));
  return Array.from({ length: range }, (_, i) => {
    const day = wibDay(range - 1 - i);
    return map.get(day) ?? { day, total: 0, passed: 0 };
  });
};

// Monotone cubic: datar di puncak/lembah, lurus di tanjakan, tanpa overshoot.
const pchipSlopes = (ys: number[], xs: number[]) => {
  const n = ys.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const h = xs[1] - xs[0] || 1;
  const delta = ys.slice(1).map((y, i) => (y - ys[i]) / h);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const a = delta[i - 1], b = delta[i];
    m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  return m;
};

const buildCurve = (daily: DayStat[]): Curve => {
  const n = daily.length;
  const xs = n ? daily.map((_, i) => (n > 1 ? i / (n - 1) : 0)) : [0];
  const ok = n ? daily.map(d => d.passed) : [0];
  const bad = n ? daily.map(d => d.total - d.passed) : [0];
  return {
    xs, ok, bad,
    mOk: pchipSlopes(ok, xs),
    mBad: pchipSlopes(bad, xs),
    max: n ? Math.max(1, ...daily.map(d => d.total)) : 1,
  };
};

// Evaluasi kurva pada posisi 0..1; titik hari asli selalu kena persis (tanpa overshoot).
const evalCurve = (ys: number[], ms: number[], xs: number[], u: number) => {
  if (xs.length === 1) return ys[0];
  let i = 0;
  while (i < xs.length - 2 && u > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i] || 1;
  const t = Math.min(1, Math.max(0, (u - xs[i]) / h));
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i]
    + (t3 - 2 * t2 + t) * h * ms[i]
    + (-2 * t3 + 3 * t2) * ys[i + 1]
    + (t3 - t2) * h * ms[i + 1];
};

function useChartMorph(daily: DayStat[]) {
  const key = daily.map(d => `${d.day}:${d.total}:${d.passed}`).join("|");
  const [series, setSeries] = useState<ChartSeries>(() => {
    const initial = buildCurve(daily);
    return { us: initial.xs, ok: initial.ok, bad: initial.bad, max: initial.max };
  });
  const current = useRef(daily);
  const frame = useRef(0);

  useEffect(() => {
    const from = buildCurve(current.current);
    const to = buildCurve(daily);
    // Sampel memuat semua tanggal kedua rentang, supaya bentuk akhir persis
    // melewati titik data dan tidak ada puncak palsu di antaranya.
    const us = [...new Set([
      ...Array.from({ length: CHART_SAMPLES + 1 }, (_, i) => i / CHART_SAMPLES),
      ...from.xs,
      ...to.xs,
    ].map(u => u.toFixed(6)))].map(Number).sort((a, b) => a - b);
    const blend = (e: number): ChartSeries => ({
      us,
      ok: us.map(u => evalCurve(from.ok, from.mOk, from.xs, u) * (1 - e)
        + evalCurve(to.ok, to.mOk, to.xs, u) * e),
      bad: us.map(u => evalCurve(from.bad, from.mBad, from.xs, u) * (1 - e)
        + evalCurve(to.bad, to.mBad, to.xs, u) * e),
      max: from.max + (to.max - from.max) * e,
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = daily;
      setSeries({ us: to.xs, ok: to.ok, bad: to.bad, max: to.max });
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / CHART_MORPH_MS);
      const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setSeries(blend(e));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else current.current = daily;
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
  // Pass rate per project untuk kartu project.
  const [perProject, setPerProject] = useState<Record<string, Stats>>({});
  const [projectId, setProjectId] = useState("");
  const [range, setRange] = useState(14);
  // Rentang yang benar-benar diwakili `stats`; grafik tidak beranimasi ke data lama.
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

  // Polling 5 dtk; tab tersembunyi 15 dtk supaya hemat request.
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

  // Data grafik baru dipasang setelah stats untuk rentang itu tiba.
  useEffect(() => {
    if (!stats || statsRange !== range) return;
    setChartDaily(fillDaily(stats.daily, range));
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

  // Grup diturunkan dari projects; project tanpa grup masuk bucket "Tanpa grup".
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
  // Lengkapi hari tanpa run dengan nol; saat rentang baru dimuat, pakai data lama dulu.
  const daily = chartDaily.length ? chartDaily : fillDaily(stats?.daily ?? [], range);
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
  const seriesX = (u: number) => PAD_X + u * (CHART_W - PAD_X * 2);
  const seriesPoints = (vals: number[]): [number, number][] =>
    vals.map((v, i) => [seriesX(series.us[i]), chartY(v)]);
  const seriesValue = (vals: number[], u: number) => {
    const us = series.us;
    if (us.length === 1) return vals[0];
    let i = 0;
    while (i < us.length - 2 && u > us[i + 1]) i++;
    const span = us[i + 1] - us[i] || 1;
    const t = Math.min(1, Math.max(0, (u - us[i]) / span));
    return vals[i] + (vals[i + 1] - vals[i]) * t;
  };
  // Path dirakit dari sampel rapat supaya bentuk animasi = kurva data (puncak tidak bergeser).
  const linePath = (pts: [number, number][]) => {
    if (pts.length < 2) return "";
    return pts.map(([x, y], i) => `${i ? " L" : "M"}${x},${y}`).join("");
  };
  const areaPath = (pts: [number, number][]) => pts.length < 2
    ? ""
    : `${linePath(pts)} L${pts[pts.length - 1][0]},${CHART_H - PAD_Y} L${pts[0][0]},${CHART_H - PAD_Y} Z`;
  const passedPts = seriesPoints(series.ok);
  const failedPts = seriesPoints(series.bad);
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
                  <path className="pb-chart-area ok" d={areaPath(passedPts)} />
                  <path className="pb-chart-area bad" d={areaPath(failedPts)} />
                </>
              )}
              <path className="pb-chart-line bad" d={linePath(failedPts)} />
              <path className="pb-chart-line ok" d={linePath(passedPts)} />
              {daily.map((d, i) => {
                const frac = daily.length > 1 ? i / (daily.length - 1) : 0;
                const ok = d.passed;
                const bad = d.total - d.passed;
                const okY = chartY(seriesValue(series.ok, frac));
                const badY = chartY(seriesValue(series.bad, frac));
                const isHover = hoverDay === i;
                // Hari tanpa run tidak perlu dua titik nol yang menumpuk.
                const hasRuns = d.total > 0;
                // Angka selalu di atas titik; kalau dua nilai hampir sejajar,
                // geser kiri/kanan supaya tidak saling menimpa.
                const okLabelY = Math.max(12, okY - 9);
                const badLabelY = Math.max(12, badY - 9);
                const labelDx = Math.abs(okLabelY - badLabelY) < 16 ? 11 : 0;
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
                        <text className="pb-chart-value ok" x={chartX(i) - labelDx}
                          y={okLabelY} textAnchor="middle">{ok}</text>
                        {bad > 0 && (
                          <text className="pb-chart-value bad" x={chartX(i) + labelDx}
                            y={badLabelY} textAnchor="middle">{bad}</text>
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
        // Grup hanya pengelompokan tampilan dari projects.group_name.
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
