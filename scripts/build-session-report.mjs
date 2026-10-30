// Adapter JSON → HTML untuk satu report sesi (PRD §9, H3-1).
// ponytail: HTML statis satu file + CSS inline, bukan `docusaurus build`.
// Kalau nanti butuh navigasi antar halaman/navbar, ganti ke pipeline Docusaurus.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../server/store.mjs';
import { buildReportDocs } from './build-report-docs.mjs';
import { renderReportMarkdown } from './report-md.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = v => (v == null ? '-' : String(v));
const score = v => (v == null ? '-' : Math.round(v * 100));
const ms = v => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const dur = v => (v == null ? '-' : v >= 60000 ? `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s` : `${(v / 1000).toFixed(1)}s`);
const date = v => (v ? new Date(v).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-');
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

const css = `
:root{--bg:#0b1020;--card:#131a2e;--line:#233052;--fg:#e7ecf7;--mut:#93a1c0;--ok:#3ddc97;--bad:#ff6b81;--warn:#ffc857;--acc:#5b8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 "Segoe UI",system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;color:var(--acc)}
h3{font-size:13px;margin:16px 0 6px}.mut{color:var(--mut)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px}
.b{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600}
.ok{background:rgba(61,220,151,.15);color:var(--ok)}.bad{background:rgba(255,107,129,.15);color:var(--bad)}
.warn{background:rgba(255,200,87,.15);color:var(--warn)}.mut2{background:rgba(147,161,192,.15);color:var(--mut)}
pre{background:#080d19;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font-size:12px;max-height:340px;white-space:pre-wrap;overflow-wrap:anywhere}
details summary{cursor:pointer;color:var(--acc);font-size:13px;margin:8px 0}
.kpi{display:flex;gap:22px;flex-wrap:wrap}.kpi div{min-width:110px}.kpi b{display:block;font-size:20px}
`;

function statusBadge(status) {
  const cls = status === 'passed' ? 'ok' : ['failed', 'cancelled', 'interrupted'].includes(status) ? 'bad' : status === 'flaky' ? 'warn' : 'mut2';
  return `<span class="b ${cls}">${esc(status)}</span>`;
}

function playwrightSection(run, results, logs) {
  if (!results.length) return `<p class="mut">data tidak ditemukan - JSON Playwright hilang atau korup. Run tidak dianggap lulus.</p>`;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const flaky = results.filter(r => r.status === 'flaky').length;
  const rows = results.map(r => `<tr>
      <td class="mono">${esc(n(r.tc_id))}</td><td>${esc(r.title)}</td><td class="mono">${esc(r.file)}</td>
      <td>${statusBadge(r.status)}</td><td class="mono">${dur(r.duration_ms)}</td><td class="mono">${r.retry || 0}</td></tr>`).join('');
  const errors = results.filter(r => r.error).map(r => `<h3>${esc(r.tc_id ?? r.title)}</h3><p class="mono mut">${esc(r.file)}</p><pre>${esc(r.error)}</pre>`).join('');
  return `<div class="kpi"><div><b>${passed}</b><span class="mut">lulus</span></div><div><b>${failed}</b><span class="mut">gagal</span></div>
    <div><b>${flaky}</b><span class="mut">flaky</span></div><div><b>${dur(run.duration_ms)}</b><span class="mut">durasi</span></div></div>
    <table><thead><tr><th>TC</th><th>Judul</th><th>File</th><th>Status</th><th>Durasi</th><th>Retry</th></tr></thead><tbody>${rows}</tbody></table>
    ${errors}
    ${logs ? `<details><summary>Log run (500 baris terakhir)</summary><pre>${esc(logs)}</pre></details>` : ''}`;
}

async function lighthouseSection(run, rows, artifacts, logs) {
  if (!rows.length) return `<p class="mut">data tidak ditemukan - JSON Lighthouse hilang atau korup.</p>`;
  // manifest.json lhci: url → htmlPath/jsonPath absolut. Dipakai untuk link report & audit gagal.
  const dir = join(root, '.runs', run.id, 'artifacts');
  const manifest = await readFile(join(dir, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => []);
  const byUrl = new Map();
  for (const m of Array.isArray(manifest) ? manifest : []) {
    if (!m.url) continue;
    byUrl.set(m.url, {
      html: m.htmlPath ? m.htmlPath.split(/[\\/]/).pop() : null,
      json: m.jsonPath ? m.jsonPath.split(/[\\/]/).pop() : null,
    });
  }
  const body = rows.map(r => {
    const m = byUrl.get(r.url);
    const report = m?.html ? link(`/artifacts/${run.id}/${m.html}`, 'report') : '-';
    return `<tr>
      <td class="mono">${esc(r.url)}</td><td>${score(r.performance)}</td><td>${score(r.accessibility)}</td>
      <td>${score(r.best_practices)}</td><td>${score(r.seo)}</td><td class="mono">${ms(r.lcp_ms)}</td>
      <td class="mono">${r.cls == null ? '-' : Number(r.cls).toFixed(3)}</td><td class="mono">${ms(r.tbt_ms)}</td>
      <td>${report}</td></tr>`;
  }).join('');
  // Audit yang skornya < 1 → daftar penyebab, dengan displayValue dari JSON.
  const audits = [];
  for (const r of rows) {
    const file = byUrl.get(r.url)?.json;
    if (!file) continue;
    const lhr = await readFile(join(dir, file), 'utf8').then(JSON.parse).catch(() => null);
    for (const [id, a] of Object.entries(lhr?.audits ?? {})) {
      if (a.score == null || a.score >= 1 || a.scoreDisplayMode === 'notApplicable') continue;
      audits.push(`${r.url} · ${a.title ?? id}${a.displayValue ? ` - ${a.displayValue}` : ''}`);
    }
  }
  const warns = rows.flatMap(r => {
    const list = [];
    try { list.push(...(JSON.parse(r.warnings ?? '[]') || []).map(w => `${r.url}: ${w}`)); } catch { /* bukan JSON, abaikan */ }
    if (r.budget_failed) list.push(`${r.url}: budget gagal - ${r.budget_failed}`);
    return list;
  });
  return `<table><thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>CLS</th><th>TBT</th><th /></tr></thead><tbody>${body}</tbody></table>
    ${audits.length ? `<h3>Audit di bawah skor penuh</h3><ul>${audits.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${warns.length ? `<h3>Peringatan</h3><ul>${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${logs ? `<details><summary>Log run (500 baris terakhir)</summary><pre>${esc(logs)}</pre></details>` : ''}`;
}

async function runSection(run, results, artifacts, logs) {
  const raw = run.tool === 'pw' ? 'playwright-report/index.html' : null;
  const files = raw ? [link(`/artifacts/${run.id}/${raw}`, 'report mentah Playwright')] : [];
  const body = run.tool === 'pw'
    ? playwrightSection(run, results, logs)
    : await lighthouseSection(run, results, artifacts, logs);
  return `<section class="card">
    <h2>${run.tool === 'pw' ? 'Playwright' : 'Lighthouse'} · ${statusBadge(run.status)}</h2>
    <p class="mut">Mulai ${date(run.started_at)} · selesai ${date(run.finished_at)} · durasi ${dur(run.duration_ms)} · exit ${n(run.exit_code)}</p>
    ${run.error ? `<p class="b bad">${esc(run.error)}</p>` : ''}
    ${body}
    <p class="mut">${[files.length ? files.join(' · ') : '', link(`/api/runs/${run.id}/logs/download`, 'unduh log penuh')].filter(Boolean).join(' · ')}</p>
  </section>`;
}

function verdict(runs) {
  const failed = runs.filter(r => r.status !== 'passed');
  const pw = runs.find(r => r.tool === 'pw');
  const lh = runs.find(r => r.tool === 'lh');
  const parts = [];
  if (pw) parts.push(`Playwright: ${pw.status}`);
  if (lh) parts.push(`Lighthouse: ${lh.status}`);
  return `<p class="b ${failed.length ? 'bad' : 'ok'}">${failed.length ? 'Gagal' : 'Lulus'}</p> <span class="mut">${esc(parts.join(' · '))}</span>`;
}

export async function buildSessionReport(store, reportId) {
  const outDir = join(resolve(root, process.env.REPORTS_DIR ?? '.reports'), reportId);
  try {
    const report = store.getReport(reportId);
    if (!report) throw new Error('Report tidak ditemukan');
    store.patchReport(reportId, { status: 'building', error: null });
    const session = store.getSession(report.session_id);
    const project = session ? store.getProject(session.project_id) : null;
    const runIds = JSON.parse(report.run_ids ?? '[]');
    const sections = [];
    const usedRuns = [];
    for (const runId of runIds) {
      const run = store.getRun(runId);
      if (!run) { sections.push(`<section class="card"><p class="mut">run dihapus pada ${date(new Date().toISOString())} (${esc(runId)})</p></section>`); continue; }
      usedRuns.push(run);
      const results = run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id);
      const artifacts = store.listArtifacts(run.id);
      const logs = (await store.logsText(run.id)).split('\n').slice(-500).join('\n');
      sections.push(await runSection(run, results, artifacts, logs));
    }
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(session?.label ?? 'Laporan')} - Playbook</title><style>${css}</style></head><body><main>
<h1>${esc(session?.label ?? 'Laporan')}</h1>
<p class="mut">${esc(project?.name ?? '-')} · ${esc(session?.env ?? '-')} · ${esc(session?.target_url ?? '-')} · ${date(session?.created_at)}</p>
${report.scope === 'both' ? `<div class="card">${verdict(usedRuns)}</div>` : ''}
${sections.join('\n')}
<p class="mut" style="margin-top:28px;font-size:12px">Dibangun ${date(new Date().toISOString())} · cakupan ${esc(report.scope)} · ${runIds.length} run</p>
</main></body></html>`;
    await mkdir(outDir, { recursive: true });

    // Jalur utama: Docusaurus (halaman index + satu halaman per run).
    // Fallback: HTML statis di atas, kalau build gagal laporan tetap ada.
    const runsDir = resolve(root, process.env.RUNS_DIR ?? '.runs');
    // Run lama belum punya run.json; lengkapi dari baris DB supaya pipeline
    // tidak menganggapnya run yang sudah dihapus.
    for (const run of usedRuns) {
      const file = join(runsDir, run.id, 'run.json');
      if (await readFile(file, 'utf8').catch(() => null)) continue;
      const meta = {
        id: run.id,
        suiteName: run.tool === 'lh' ? 'Lighthouse' : 'Playwright',
        targetUrl: session?.target_url ?? null,
        mode: run.tool,
        status: run.status,
        startedAt: run.started_at ?? null,
        finishedAt: run.finished_at ?? null,
        exitCode: run.exit_code ?? null,
        error: run.error ?? null,
      };
      await writeFile(file, JSON.stringify(meta, null, 2)).catch(() => {});
    }
    let mode = 'docs';
    let fallbackError = null;
    try {
      await buildReportDocs(runIds.map(id => join(runsDir, id)), outDir, `/artifacts/reports/${reportId}/`);
    } catch (error) {
      mode = 'html';
      // Detail teknis cukup di log server; kartu report hanya perlu alasan singkat.
      fallbackError = 'build Docusaurus gagal, memakai HTML cadangan';
      console.error('[report] fallback html', reportId, error.message ?? String(error));
      await writeFile(join(outDir, 'index.html'), html);
    }
    // Bahan evaluasi teks, sejajar dengan index.html di folder report yang sama.
    const runsForMd = usedRuns.map(run => ({
      run,
      results: run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id),
    }));
    await writeFile(join(outDir, 'report.md'), renderReportMarkdown({ session, project, report, runs: runsForMd }))
      .catch(error => console.error('[report] markdown gagal', reportId, error.message));

    store.patchReport(reportId, { status: 'ready', path: 'index.html', mode, error: fallbackError, built_at: new Date().toISOString() });
    return { ok: true, dir: outDir, mode };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    store.patchReport(reportId, { status: 'failed', error: error.message, built_at: new Date().toISOString() });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportId = process.argv[2];
  if (!reportId) throw new Error('Usage: node scripts/build-session-report.mjs <reportId>');
  const store = new Store(process.env.DATABASE_URL);
  await buildSessionReport(store, reportId);
  console.log('Report ready: ' + reportId);
  store.close();
}
