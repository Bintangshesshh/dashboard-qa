// Cek cepat: markdown bahan evaluasi memuat kegagalan, bukan sekadar lulus.
//   node scripts/test-report-md.mjs
import assert from 'node:assert/strict';
import { renderReportMarkdown } from './report-md.mjs';

const session = { label: 'Quick check Demo', env: 'staging', target_url: 'http://127.0.0.1:4173', created_at: '2026-10-30T01:00:00.000Z' };
const report = { scope: 'both', status: 'ready', run_ids: '["r1","r2"]' };

const runs = [
  {
    run: { id: 'r1', tool: 'pw', status: 'failed', duration_ms: 4200, exit_code: 1, finished_at: '2026-10-30T01:05:00.000Z', artifacts: [{ path: 'index.html' }] },
    results: [
      { tc_id: 'TC-1', title: 'login', file: 'specs/login.spec.ts', status: 'passed', duration_ms: 900, retry: 0 },
      { tc_id: 'TC-2', title: 'checkout', file: 'specs/checkout.spec.ts', status: 'failed', duration_ms: 3300, retry: 1, error: "Error: expect(received).toBeTruthy()\n\n  at specs/checkout.spec.ts:42:3" },
    ],
  },
  {
    run: { id: 'r2', tool: 'lh', status: 'passed', duration_ms: 12000, exit_code: 0, finished_at: '2026-10-30T01:06:00.000Z', artifacts: [] },
    results: [
      { url: 'http://127.0.0.1:4173/', performance: 0.55, accessibility: 1, best_practices: 0.9, seo: 1, lcp_ms: 3100, budget_failed: 'lcp', warnings: null },
    ],
  },
];

const md = renderReportMarkdown({ session, project: { name: 'Demo' }, report, runs, position: 2, frontmatter: true });

assert.ok(md.startsWith('---'), 'harus punya frontmatter');
assert.ok(md.includes('sidebar_position: 2'), 'frontmatter butuh sidebar_position');
assert.ok(md.includes('> [!WARNING]'), 'run gagal harus memicu warning');
assert.ok(md.includes('TC-2') && md.includes('specs/checkout.spec.ts:42'), 'lokasi kegagalan Playwright harus ada');
assert.ok(md.includes('- [ ] TC-2'), 'kegagalan Playwright harus jadi checklist');
assert.ok(md.includes('performance 55%'), 'audit Lighthouse di bawah 100% harus tercatat');
assert.ok(md.includes('- [ ] http://127.0.0.1:4173/ - budget: lcp'), 'budget gagal harus jadi checklist');
assert.ok(!md.includes('\u2014'), 'tanpa em-dash');
assert.ok(md.includes('| r1 |'), 'tabel artefak per run harus ada');

const lulus = renderReportMarkdown({
  session, project: null, report: { scope: 'pw', status: 'ready', run_ids: '["r1"]' },
  runs: [{ run: { ...runs[0].run, status: 'passed' }, results: [runs[0].results[0]] }],
});
assert.ok(lulus.includes('> [!NOTE]'), 'semua lulus pakai NOTE');
assert.ok(!lulus.includes('---\ntitle:'), 'tanpa frontmatter saat diminta');

console.log('ok: report-md');
