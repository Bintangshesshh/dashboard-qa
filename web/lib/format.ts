/** Formatting helpers for timestamps, durations and status labels */

import type { Run } from './types';

export function stamp(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function duration(r: Run): number | null {
  if (!r.finishedAt || !r.startedAt) return null;
  return Math.max(0, Date.parse(r.finishedAt) - Date.parse(r.startedAt));
}

export function secs(n: number | null): string {
  if (n === null) return '—';
  return (n / 1000).toFixed(1) + 's';
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case 'lh': return 'Lighthouse';
    case 'both': return 'Playwright + Lighthouse';
    default: return 'Playwright';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'passed': return 'Passed';
    case 'failed': return 'Failed';
    case 'running': return 'Running';
    case 'queued': return 'Queued';
    case 'cancelled': return 'Cancelled';
    case 'cancelling': return 'Cancelling';
    case 'interrupted': return 'Interrupted';
    default: return status;
  }
}

export const STARTER_CODE = `import { test, expect } from '@playwright/test';

test('Page is available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
`;
