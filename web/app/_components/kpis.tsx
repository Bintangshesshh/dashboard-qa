"use client";
import { useEffect, useState } from "react";
import { type Row, type Stats, days, dur, stamp } from "../qa-model";

// Success rate stays a donut - same 314 circumference trick as ui/app.js,
// recoloured to the reference accent.
export function KpiGrid({ rows, s }: { rows: Row[]; s: Stats }) {
  const tone = s.rate >= 90 ? "ok" : s.rate >= 75 ? "warn" : "bad";
  return (
    <div className="kpis">
      <article className="card kpi kpi-hero">
        <h2>Success rate</h2>
        <div className="donut-wrap">
          <svg className="donut" viewBox="0 0 120 120" role="img" aria-label="Success rate donut chart">
            <circle className="donut-track" cx="60" cy="60" r="50" />
            <circle
              className="donut-value"
              cx="60"
              cy="60"
              r="50"
              style={{ stroke: `var(--${tone})`, strokeDashoffset: 314 - (314 * s.rate) / 100 }}
            />
          </svg>
          <div className="donut-label">
            <strong>{s.rate}%</strong>
            <small>of {s.total.toLocaleString("en-US")} tests</small>
          </div>
        </div>
        <p className="kpi-note">
          {s.passed.toLocaleString("en-US")} passed · {s.failed} failed · {s.flaky} flaky
        </p>
      </article>
      <article className="card kpi"><h2>Total runs</h2><strong className="kpi-value">{rows.length}</strong><p className="kpi-note">queued + finished</p></article>
      <article className="card kpi"><h2>Passed</h2><strong className="kpi-value ok">{s.passed.toLocaleString("en-US")}</strong><p className="kpi-note">this range</p></article>
      <article className="card kpi"><h2>Failed</h2><strong className="kpi-value bad">{s.failed}</strong><p className="kpi-note">needs triage</p></article>
      <article className="card kpi"><h2>Flaky</h2><strong className="kpi-value warn">{s.flaky}</strong><p className="kpi-note">retried and passed</p></article>
      <article className="card kpi"><h2>Avg duration</h2><strong className="kpi-value">{s.avg ? dur(s.avg) : "-"}</strong><p className="kpi-note">per suite run</p></article>
    </div>
  );
}

// Per-day buckets shared by the charts.
export function historyByDay(rows: Row[], range: number, today: number) {
  const labels = days(range, today);
  return { labels, buckets: labels.map(d => rows.filter(r => new Date(r.startedAt).toDateString() === d.key)) };
}

// Line/area chart, same shape as the reference lighthouse panel:
// padded viewBox, grid lines, area fill, accent stroke, dots + hover hit rects.
export function LineChart({ rows, range, today, series = "runs", ariaLabel = "Execution history" }: {
  rows: Row[]; range: number; today: number; series?: "runs" | "passRate"; ariaLabel?: string;
}) {
  const W = 640, H = 240, padL = 40, padR = 16, padT = 18, padB = 34;
  const { labels, buckets } = historyByDay(rows, range, today);
  const values = buckets.map(b => {
    if (series === "runs") return b.length;
    const passed = b.reduce((n, r) => n + r.passed, 0);
    const total = b.reduce((n, r) => n + r.passed + r.failed, 0);
    return total ? Math.round((passed / total) * 1000) / 10 : 0;
  });
  const max = Math.max(1, ...values);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i: number) => padL + (values.length > 1 ? (i / (values.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = values.length
    ? `${line} L${x(values.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L${padL} ${(padT + innerH).toFixed(1)} Z`
    : "";
  const ticks = [0, 0.5, 1].map(f => Math.round(max * f));
  const hitW = values.length > 1 ? innerW / (values.length - 1) : innerW;

  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={`${i}-${t}`}>
          <line className="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text className="axis-label" x={padL - 8} y={y(t) + 3} textAnchor="end">{series === "runs" ? t : `${t}%`}</text>
        </g>
      ))}
      {area && <path className="area" d={area} />}
      {line && <path className="stroke" d={line} />}
      {values.map((v, i) => (
        <g key={i}>
          <rect className="hit" x={(x(i) - hitW / 2).toFixed(1)} y={padT} width={hitW.toFixed(1)} height={innerH}>
            <title>{`${labels[i].label}: ${series === "runs" ? `${v} runs` : `${v}% pass rate`}`}</title>
          </rect>
          <circle className="dot" cx={x(i).toFixed(1)} cy={y(v).toFixed(1)} r={3.5} />
          {i % 2 === 0 && <text className="axis-label" x={x(i).toFixed(1)} y={H - 12} textAnchor="middle">{labels[i].label}</text>}
        </g>
      ))}
    </svg>
  );
}

// Horizontal pass-rate bars per project - mirrors the reference distribution panel.
export function PassRateBars({ rows }: { rows: Row[] }) {
  const groups = [...new Set(rows.map(r => r.project))].map(p => {
    const mine = rows.filter(r => r.project === p);
    const total = mine.reduce((n, r) => n + r.passed + r.failed, 0);
    const passed = mine.reduce((n, r) => n + r.passed, 0);
    return { project: p, total: mine.length, rate: total ? (passed / total) * 100 : 0 };
  }).sort((a, b) => a.rate - b.rate);
  if (!groups.length) return <p className="empty">No runs in the selected range.</p>;
  return (
    <div className="bars">
      {groups.map(g => (
        <div className="bar-row" key={g.project}>
          <span>{g.project} <span className="meta">({g.total})</span></span>
          <span className="bar-track">
            <span className={`bar-fill${g.rate >= 90 ? "" : g.rate >= 70 ? " warn" : " bad"}`} style={{ width: `${g.rate.toFixed(1)}%` }} />
          </span>
          <span className="num">{g.rate.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label = status[0].toUpperCase() + status.slice(1);
  return <span className={"status " + status}>{label}</span>;
}

// Relative timestamps would drift between server render and hydration.
export function Clock({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => setText(stamp(iso)), [iso]);
  return <>{text}</>;
}
