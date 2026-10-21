"use client";
/** Run history / Reports view with pagination */

import type { Run } from '../lib/types';
import { stamp, duration, secs, modeLabel } from '../lib/format';
import StatusBadge from './StatusBadge';

interface HistoryViewProps {
  runs: Run[];
  streamId: string;
  totalRuns: number;
  onInspect: (r: Run) => void;
  onLoadMore: () => void;
  reportUrl: (r: Run) => string | null;
}

export default function HistoryView({ runs, streamId, totalRuns, onInspect, onLoadMore, reportUrl }: HistoryViewProps) {
  return (
    <div className="scroll-table">
      <table>
        <thead>
          <tr>
            <th>Started / run</th>
            <th>Suite / mode</th>
            <th>Status</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className={streamId === r.id ? 'selected' : ''}>
              <td>
                <button onClick={() => onInspect(r)}>
                  {stamp(r.startedAt)}
                  <small>{r.id.slice(0, 8)}</small>
                </button>
              </td>
              <td>
                {r.suiteName}
                <small>{modeLabel(r.mode)}</small>
              </td>
              <td>
                <StatusBadge status={r.status} />
                <small>{secs(duration(r))}</small>
              </td>
              <td className="report-links">
                {(() => {
                  const url = reportUrl(r);
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">Open report</a>
                  ) : (
                    <span>No report yet</span>
                  );
                })()}
                <span>Docs: {r.docsStatus || 'pending'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!runs.length && <p>No runs yet.</p>}
      {runs.length > 0 && runs.length < totalRuns && (
        <div className="load-more">
          <button onClick={onLoadMore}>Load more runs</button>
          <small>{runs.length} of {totalRuns}+ shown</small>
        </div>
      )}
    </div>
  );
}
