"use client";
/** Status badge for run states */

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  let cls = 'status-badge';
  switch (status) {
    case 'passed': cls += ' status-passed'; break;
    case 'failed': cls += ' status-failed'; break;
    case 'running':
    case 'queued':
    case 'cancelling': cls += ' status-active'; break;
    case 'cancelled':
    case 'interrupted': cls += ' status-cancelled'; break;
  }
  return <span className={cls}>{status}</span>;
}
