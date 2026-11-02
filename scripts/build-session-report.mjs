// Adapter JSON → HTML untuk satu report sesi: index + satu halaman per run.
// Fallback: HTML satu file (variabel `html` di bawah) kalau render folder gagal.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../server/store.mjs';
import { buildReportDocs } from './build-report-docs.mjs';
import { renderReportMarkdown } from './report-md.mjs';
import { doc, panel, tiles, statusBadge } from './report-html.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = v => (v == null ? '-' : String(v));
const score = v => (v == null ? '-' : Math.round(v * 100));
const ms = v => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const dur = v => (v == null ? '-' : v >= 60000 ? `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s` : `${(v / 1000).toFixed(1)}s`);
const date = v => (v ? new Date(v).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-');
// Same thresholds as the per-run page so numbers and rings never disagree.
const tone = v => (typeof v !== 'number' ? 'mut2' : v >= 0.9 ? 'ok' : v >= 0.5 ? 'warn' : 'bad');
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

function playwrightSection(run, results, logs) {
  if (!results.length) return `<p class="mut">data tidak ditemukan - JSON Playwright hilang atau korup. Run tidak dianggap lulus.</p>`;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const flaky = results.filter(r => r.status === 'flaky').length;
  const rows = results.map(r => `<tr>
      <td class="mono">${esc(n(r.tc_id))}</td><td>${esc(r.title)}</td><td class="mono">${esc(r.file)}</td>
      <td>${statusBadge(r.status)}</td><td class="mono">${dur(r.duration_ms)}</td><td class="mono">${r.retry || 0}</td></tr>`).join('');
  const errors = results.filter(r => r.error).map(r => `<h3>${esc(r.tc_id ?? r.title)}</h3><p class="mono mut">${esc(r.file)}</p><pre>${esc(r.error)}</pre>`).join('');
  return `${tiles([['Lulus', String(passed), 'test case passed', passed && !failed ? 'success' : ''],
    ['Gagal', String(failed), 'perlu diperiksa', failed ? 'danger' : ''],
    ['Flaky', String(flaky), 'tidak dihitung lulus', flaky ? 'warn' : ''],
    ['Durasi', dur(run.duration_ms), `exit ${n(run.exit_code)}`]])}
    <div class="tbl"><table><thead><tr><th>TC</th><th>Judul</th><th>File</th><th>Status</th><th>Durasi</th><th>Retry</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${errors}
    ${logs ? `<details><summary>Log run (500 baris terakhir)</summary><pre>${esc(logs)}</pre></details>` : ''}`;
}

async function lighthouseSection(run, rows, logs) {
  if (!rows.length) return `<p class="mut">data tidak ditemukan - JSON Lighthouse hilang atau korup.</p>`;
  // manifest.json lhci: url → htmlPath/jsonPath absolut. Dipakai untuk link report & audit gagal.
  const dir = join(resolve(root, process.env.RUNS_DIR ?? '.runs'), run.id, 'artifacts');
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
      <td class="mono">${esc(r.url)}</td><td class="num-${tone(r.performance)}">${score(r.performance)}</td><td class="num-${tone(r.accessibility)}">${score(r.accessibility)}</td>
      <td class="num-${tone(r.best_practices)}">${score(r.best_practices)}</td><td class="num-${tone(r.seo)}">${score(r.seo)}</td><td class="mono">${ms(r.lcp_ms)}</td>
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
  return `<div class="tbl"><table><thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>CLS</th><th>TBT</th><th /></tr></thead><tbody>${body}</tbody></table></div>
    ${audits.length ? `<h3>Audit di bawah skor penuh</h3><ul>${audits.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${warns.length ? `<h3>Peringatan</h3><ul>${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${logs ? `<details><summary>Log run (500 baris terakhir)</summary><pre>${esc(logs)}</pre></details>` : ''}`;
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

// Header sesi: identitas + verdict + jumlah run. Dipasang di dalam hero oleh pemanggil.
function sessionIntro(session, project, runs) {
  const baris = [project?.name, session?.env, session?.target_url, date(session?.created_at)]
    .filter(Boolean).map(v => esc(v)).join(' · ');
  return `<div class="eyebrow">Laporan sesi</div>
<h1>${esc(session?.label ?? 'Laporan')}</h1>
<p class="lead">${baris}</p>
<div class="meta-strip"><div class="meta-item"><span class="mut">Verdict</span>${verdict(runs)}</div>
<div class="meta-divider"></div><div class="meta-item"><span class="mut">Run</span><strong>${runs.length}</strong></div></div>`;
}

async function runSection(run, results, logs) {
  const raw = run.tool === 'pw' ? 'playwright-report/index.html' : null;
  const files = raw ? [link(`/artifacts/${run.id}/${raw}`, 'report mentah Playwright')] : [];
  const body = run.tool === 'pw'
    ? playwrightSection(run, results, logs)
    : await lighthouseSection(run, results, logs);
  const head = `<h2>${run.tool === 'pw' ? 'Playwright' : 'Lighthouse'} ${statusBadge(run.status)}</h2>
<p>Mulai ${date(run.started_at)} · selesai ${date(run.finished_at)} · durasi ${dur(run.duration_ms)} · exit ${n(run.exit_code)}</p>`;
  return panel(head, `${run.error ? `<p class="b bad">${esc(run.error)}</p>` : ''}${body}
    <p class="mut">${[files.length ? files.join(' · ') : '', link(`/api/runs/${run.id}/logs/download`, 'unduh log penuh')].filter(Boolean).join(' · ')}</p>`);
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
      if (!run) { sections.push(panel('Run dihapus', `<p class="mut">run dihapus pada ${date(new Date().toISOString())} (${esc(runId)})</p>`)); continue; }
      usedRuns.push(run);
      const results = run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id);
      const logs = (await store.logsText(run.id)).split('\n').slice(-500).join('\n');
      sections.push(await runSection(run, results, logs));
    }
    const html = doc({
      title: `${session?.label ?? 'Laporan'} - Playbook`,
      brand: session?.label ?? 'Laporan',
      sub: [project?.name, session?.env].filter(Boolean).join(' · '),
      actions: verdict(usedRuns),
      hero: `<section class="hero">${sessionIntro(session, project, usedRuns)}</section>`,
      body: sections.join('\n') + `<p class="mut" style="margin-top:28px;font-size:12px">Dibangun ${date(new Date().toISOString())} · cakupan ${esc(report.scope)} · ${runIds.length} run</p>`,
    });
    await mkdir(outDir, { recursive: true });

    // Jalur utama: folder HTML statis (index + halaman per run).
    // Fallback: HTML satu file di atas, kalau render folder gagal laporan tetap ada.
    const runsDir = resolve(root, process.env.RUNS_DIR ?? '.runs');
    // run.json: identitas run untuk halaman report. DB bisa saja sudah tidak punya
    // run.json; lengkapi dari baris DB supaya pipeline
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
      await buildReportDocs(runIds.map(id => join(runsDir, id)), outDir, `/artifacts/reports/${reportId}/`, sessionIntro(session, project, usedRuns));
    } catch (error) {
      mode = 'html';
      // Detail teknis cukup di log server; kartu report hanya perlu alasan singkat.
      fallbackError = 'render folder report gagal, memakai HTML cadangan';
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
