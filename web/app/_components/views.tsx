"use client";
import { type Row, type Suite, dur } from "../qa-model";
import { Clock, StatusPill } from "./kpis";

// Overview: latest failures beside the execution history chart.
export function FailurePreview({ rows, onOpen, onAll }: { rows: Row[]; onOpen: (id: string) => void; onAll: () => void }) {
  const failed = rows.filter(r => r.message).slice(0, 4);
  return (
    <article className="card">
      <div className="card-head"><h2>Latest failures</h2><button className="link" onClick={onAll}>View all</button></div>
      <ul className="failure-list">
        {failed.length ? failed.map(r => (
          <li key={r.id}>
            <button className="link" onClick={() => onOpen(r.id)}><strong>{r.message}</strong></button>
            <small>{r.project} · {r.spec ?? r.suite} · {r.browser ?? "unknown"}</small>
          </li>
        )) : <li style={{ borderLeftColor: "var(--ok)", background: "var(--ok-bg)" }}><strong>No failures in range</strong><small>Every test passed.</small></li>}
      </ul>
    </article>
  );
}

export function RecentRuns({ rows, onOpen, onAll }: { rows: Row[]; onOpen: (id: string) => void; onAll: () => void }) {
  return (
    <article className="card">
      <div className="card-head"><h2>Recent runs</h2><button className="link" onClick={onAll}>Open runs</button></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Started</th><th>Project</th><th>Suite</th><th>Mode</th><th>Duration</th><th>Status</th></tr></thead>
          <tbody>
            {rows.slice(0, 6).map(r => (
              <tr key={r.id} tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
                <td className="mono"><Clock iso={r.startedAt} /><span className="sub">{r.id.slice(0, 8)}</span></td>
                <td>{r.project}</td><td>{r.suite}</td><td>{r.mode}</td>
                <td className="mono">{dur(r.durationMs)}</td><td><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty">No runs in the selected range.</p>}
    </article>
  );
}

export function RunsTable({ rows, status, selected, onStatus, onOpen }: {
  rows: Row[]; status: string; selected: string | null; onStatus: (s: string) => void; onOpen: (id: string) => void;
}) {
  const filtered = rows.filter(r => status === "all" || r.status === status);
  const chips = [["all", "All"], ["passed", "Passed"], ["failed", "Failed"], ["running", "Running"]];
  return (
    <section className="view">
      <div className="card">
        <div className="card-head">
          <h2>All runs</h2>
          <div className="chips" role="group" aria-label="Filter by status">
            {chips.map(([id, label]) => (
              <button key={id} className={"chip" + (status === id ? " active" : "")} aria-pressed={status === id} onClick={() => onStatus(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Started</th><th>Project</th><th>Suite</th><th>Mode</th><th>Duration</th><th>Status</th><th>Report</th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} tabIndex={0} className={selected === r.id ? "selected" : undefined} onClick={() => onOpen(r.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
                  <td className="mono"><Clock iso={r.startedAt} /><span className="sub">{r.id.slice(0, 8)}</span></td>
                  <td>{r.project}</td><td>{r.suite}</td><td>{r.mode}</td>
                  <td className="mono">{dur(r.durationMs)}</td><td><StatusPill status={r.status} /></td>
                  <td><button className="btn btn-sm" onClick={e => { e.stopPropagation(); onOpen(r.id); }}>Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <p className="empty">No runs match the current filter.</p>}
      </div>
    </section>
  );
}

export function FailureCards({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const failed = rows.filter(r => r.message);
  if (!failed.length) return <p className="empty">No failures in the selected range.</p>;
  return (
    <section className="view">
      <div className="failure-cards">
        {failed.map(r => (
          <article className="fcard" key={r.id}>
            <h3>{r.message}</h3>
            <pre>{`1) ${r.spec ?? r.suite}\n   ${r.message}\n   at ${r.browser ?? "unknown browser"} · ${r.suite}\n   run ${r.id.slice(0, 8)} · ${new Date(r.startedAt).toISOString()}`}</pre>
            <footer>
              <span className="tag">{r.project}</span>
              <span>{r.browser ?? "unknown"}</span>
              <button className="link" onClick={() => onOpen(r.id)}>Inspect run</button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ProjectGrid({ rows, projects }: { rows: Row[]; projects: string[] }) {
  const known = [...new Set([...projects, ...rows.map(r => r.project)])];
  return (
    <section className="view">
      <div className="project-grid">
        {known.map(p => {
          const mine = rows.filter(r => r.project === p);
          const total = mine.reduce((n, r) => n + r.passed + r.failed, 0);
          const passed = mine.reduce((n, r) => n + r.passed, 0);
          const rate = total ? Math.round((passed / total) * 1000) / 10 : 0;
          const failed = mine.reduce((n, r) => n + r.failed, 0);
          const durations = mine.map(r => r.durationMs).filter((n): n is number => n !== null);
          const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
          const last = mine[0];
          return (
            <article className="pcard" key={p}>
              <header><h3>{p}</h3><StatusPill status={rate >= 75 ? "passed" : "failed"} /></header>
              <div className="big">{rate}%</div>
              <div className="meter"><i className={rate >= 90 ? "" : rate >= 75 ? "warn" : "bad"} style={{ width: `${rate}%` }} /></div>
              <dl>
                <div><dt>Runs</dt><dd>{mine.length}</dd></div>
                <div><dt>Failed</dt><dd>{failed}</dd></div>
                <div><dt>Avg</dt><dd>{avg ? dur(avg) : "—"}</dd></div>
              </dl>
              <p className="kpi-note">{last ? <>Last run <Clock iso={last.startedAt} /></> : "No runs yet"}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function RunDrawer({ row, suites, onClose }: { row: Row; suites: Suite[]; onClose: () => void }) {
  const suite = suites.find(s => s.id === row.run.suiteId);
  return (
    <aside className="drawer" aria-label="Run detail">
      <div className="drawer-head">
        <h2>Run {row.id.slice(0, 8)}</h2>
        <button className="icon-btn" aria-label="Close detail" onClick={onClose}>×</button>
      </div>
      <div className="drawer-body">
        <dl>
          <dt>Project</dt><dd>{row.project}</dd>
          <dt>Suite</dt><dd>{row.suite}</dd>
          <dt>Target</dt><dd>{row.run.targetUrl}</dd>
          <dt>Mode</dt><dd>{row.mode}</dd>
          <dt>Status</dt><dd><StatusPill status={row.status} /></dd>
          <dt>Started</dt><dd><Clock iso={row.startedAt} /></dd>
          <dt>Duration</dt><dd>{dur(row.durationMs)}</dd>
          <dt>Results</dt><dd>{row.passed} passed · {row.failed} failed · {row.flaky} flaky</dd>
          <dt>Exit code</dt><dd>{row.run.exitCode ?? "—"}</dd>
          <dt>Cases</dt><dd>{suite ? suite.cases.length : "—"}</dd>
        </dl>
        <h3>Failure</h3>
        {row.run.error ? <pre>{row.run.error}</pre> : <p className="kpi-note">No failure recorded for this run.</p>}
        <h3>Artifacts</h3>
        {row.run.artifacts?.length
          ? <ul>{row.run.artifacts.map(a => <li key={a}>{a}</li>)}</ul>
          : <p className="kpi-note">No artifacts recorded.</p>}
      </div>
    </aside>
  );
}
