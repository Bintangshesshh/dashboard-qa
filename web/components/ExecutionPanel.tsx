"use client";
/** Execution panel — terminal output, run summary, cancel, log download */

import type { Run, LogEntry, ConnectionState } from '../lib/types';
import { stamp, duration, secs, modeLabel } from '../lib/format';
import { artifactUrl, downloadLogsUrl } from '../lib/api';
import StatusBadge from './StatusBadge';

const API = process.env.NEXT_PUBLIC_API || '';

interface ExecutionPanelProps {
  runs: Run[];
  active: Run | undefined;
  streamId: string;
  setStreamId: (id: string) => void;
  logs: LogEntry[];
  connection: ConnectionState;
  pollError: string;
  followLogs: React.MutableRefObject<boolean>;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  onReconnect: () => void;
  onCancel: () => void;
  authenticated: boolean;
  token: string;
}

export default function ExecutionPanel({
  runs, active, streamId, setStreamId,
  logs, connection, pollError,
  followLogs, terminalRef, onReconnect, onCancel,
  authenticated, token,
}: ExecutionPanelProps) {
  const canCancel = active && ['queued', 'running'].includes(active.status);

  return (
    <section className="execution" aria-label="Selected run">
      <div className="section-title">
        <h2>Execution output</h2>
        <label>
          Run
          <select aria-label="Terminal run" value={streamId} onChange={e => setStreamId(e.target.value)}>
            {!runs.length && <option value="">No runs</option>}
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {stamp(r.startedAt)} · {r.suiteName} · {r.mode} · {r.status}
              </option>
            ))}
          </select>
        </label>
        <span>WebSocket: {connection} · HTTP fallback: {pollError ? 'retrying' : 'active'}</span>
        <div className="actions">
          {canCancel && (
            <button className="cancel-btn" onClick={onCancel}>Cancel run</button>
          )}
          <button disabled={!streamId} onClick={onReconnect}>Reconnect</button>
        </div>
      </div>

      {active && (
        <div className="run-summary">
          <strong>Status: <StatusBadge status={active.status} /></strong>
          <span>{active.mode.toUpperCase()} · {secs(duration(active))}</span>
          {active.reportUrl?.startsWith('/reports/') ? (
            <a href={API + active.reportUrl} target="_blank" rel="noopener noreferrer">Open report</a>
          ) : (
            <span>No report yet</span>
          )}
          <span>Docs: {active.docsStatus || 'pending'}</span>
          {active.summary && (
            <span>{active.summary.passed} passed / {active.summary.failed} failed / {active.summary.skipped} skipped</span>
          )}
          {active.lighthouseScores && (
            <span className="lh-scores">
              LH: {Object.entries(active.lighthouseScores).map(([k, v]) =>
                `${k}: ${v !== null && v !== undefined ? Math.round(v * 100) : '—'}`
              ).join(' · ')}
            </span>
          )}
          {active.exitCode !== undefined && active.exitCode !== null && (
            <span>Exit: {active.exitCode}</span>
          )}
          {active.error && <p role="alert">{active.error}</p>}
          {active.docsError && <p className="muted">Docs error: {active.docsError}</p>}
          {streamId && token && (
            <a href={downloadLogsUrl(streamId)} target="_blank" rel="noopener noreferrer" className="download-link">
              Download full log
            </a>
          )}
        </div>
      )}

      {pollError && (
        <p role="alert">Log polling failed: {pollError}. Retrying automatically.</p>
      )}

      <div
        className="terminal"
        ref={terminalRef}
        onScroll={e => {
          const el = e.currentTarget;
          followLogs.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        role="log"
        aria-label="Live execution terminal"
        aria-live="polite"
      >
        {logs.length ? logs.map(l => (
          <pre key={l.seq} className={l.stream === 'stderr' ? 'stderr' : ''}>{l.text}</pre>
        )) : (
          <p>{streamId
            ? 'Waiting for execution output. Persisted logs polled every 2 seconds.'
            : 'Idle. Select a run or launch Playwright / Lighthouse to see output here.'
          }</p>
        )}
      </div>

      {!!active?.artifacts?.length && (
        <details>
          <summary>Artifacts ({active.artifacts.length})</summary>
          <ul>
            {active.artifacts.map(a => (
              <li key={a}>
                <a href={artifactUrl(active.id, a)} target="_blank" rel="noopener noreferrer">{a}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
