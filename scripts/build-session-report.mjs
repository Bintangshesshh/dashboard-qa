// Adapter JSON → HTML untuk satu report sesi: index + satu halaman per run.
// Fallback: HTML satu file (variabel `html` di bawah) kalau render folder gagal.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../server/store.mjs';
import { buildReportDocs } from './build-report-docs.mjs';
import { renderReportMarkdown, date, dur } from './report-md.mjs';
import { doc, panel, tiles, statusBadge, esc, tone } from './report-html.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const n = v => (v == null ? '-' : String(v));
const score = v => (v == null ? '-' : Math.round(v * 100));
const ms = v => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

function playwrightSection(run, results, logs) {
  if (!results.length) return `<p class="empty">data tidak ditemukan - JSON Playwright hilang atau korup. Run tidak dianggap lulus.</p>`;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const flaky = results.filter(r => r.status === 'flaky').length;
  const maxDuration = Math.max(1, ...results.map(r => Number(r.duration_ms) || 0));
  const totalTest = results.reduce((sum, r) => sum + (Number(r.duration_ms) || 0), 0);
  const retries = results.filter(r => Number(r.retry) > 0).length;
  const slow = [...results].sort((a, b) => (Number(b.duration_ms) || 0) - (Number(a.duration_ms) || 0)).slice(0, 5);
  const diag = `<div class="diagnosis"><div class="diag-grid">
<div class="diag"><span class="diag-label">Durasi run</span><span class="diag-value">${dur(run.duration_ms)}</span><span class="diag-sub">dari mulai sampai selesai</span></div>
<div class="diag"><span class="diag-label">Total test</span><span class="diag-value">${dur(totalTest)}</span><span class="diag-sub">${results.length} test · ${retries} retry</span></div>
<div class="diag"><span class="diag-label">Tes terlama</span><span class="diag-value">${dur(slow[0]?.duration_ms)}</span><span class="diag-sub">${esc(slow[0]?.title || '-')}</span></div>
<div class="diag"><span class="diag-label">Gagal / flaky</span><span class="diag-value">${failed} / ${flaky}</span><span class="diag-sub">${passed} lulus</span></div>
</div>
${slow.length ? `<h3>Tes terlama</h3><ol class="slow-list">${slow.map(r => `<li class="slow-row">
<div class="slow-head"><span class="slow-name">${esc(r.title)}</span><span class="slow-ms">${dur(r.duration_ms)}</span></div>
<div class="slow-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round((Number(r.duration_ms) || 0) / Math.max(1, Number(slow[0]?.duration_ms) || 1) * 100))}%"></span></div>
<div class="slow-meta">${esc(r.file || '-')} · ${totalTest ? Math.round((Number(r.duration_ms) || 0) / totalTest * 100) : 0}% total test</div></li>`).join('')}</ol>` : ''}</div>`;
  const rows = results.map(r => `<tr>
      <td class="mono">${esc(n(r.tc_id))}</td><td>${esc(r.title)}</td><td class="mono">${esc(r.file)}</td>
      <td>${statusBadge(r.status)}</td><td class="mono dur"><span class="dur-cell"><span class="dur-bar" style="width:${Math.max(2, Math.round(((Number(r.duration_ms) || 0) / maxDuration) * 100))}%"></span><span>${dur(r.duration_ms)}</span></span></td><td class="mono">${r.retry || 0}</td></tr>`).join('');
  const errors = results.filter(r => r.error).map(r => `<h3>${esc(r.tc_id ?? r.title)}</h3><p class="mono mut">${esc(r.file)}</p><pre>${esc(r.error)}</pre>`).join('');
  return `${tiles([['Lulus', String(passed), 'test case passed', passed && !failed ? 'success' : ''],
    ['Gagal', String(failed), 'perlu diperiksa', failed ? 'danger' : ''],
    ['Flaky', String(flaky), 'tidak dihitung lulus', flaky ? 'warn' : ''],
    ['Durasi', dur(run.duration_ms), `exit ${n(run.exit_code)}`]])}
    ${diag}
    <div class="tbl"><table><thead><tr><th>TC</th><th>Judul</th><th>File</th><th>Status</th><th>Durasi</th><th>Retry</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${errors}
    ${logs ? `<details><summary>Log run (500 baris terakhir)</summary><pre>${esc(logs)}</pre></details>` : ''}`;
}

async function lighthouseSection(run, rows, logs) {
  if (!rows.length) return `<p class="empty">data tidak ditemukan - JSON Lighthouse hilang atau korup.</p>`;
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
  const first = rows[0] || {};
  const diag = `<div class="diagnosis"><div class="diag-grid">
<div class="diag"><span class="diag-label">Performance</span><span class="diag-value num-${tone(first.performance)}">${score(first.performance)}</span><span class="diag-sub">skor kategori</span></div>
<div class="diag"><span class="diag-label">Accessibility</span><span class="diag-value num-${tone(first.accessibility)}">${score(first.accessibility)}</span><span class="diag-sub">skor kategori</span></div>
<div class="diag"><span class="diag-label">Best Practices</span><span class="diag-value num-${tone(first.best_practices)}">${score(first.best_practices)}</span><span class="diag-sub">skor kategori</span></div>
<div class="diag"><span class="diag-label">SEO</span><span class="diag-value num-${tone(first.seo)}">${score(first.seo)}</span><span class="diag-sub">skor kategori</span></div>
</div></div>`;
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
  return `${diag}<div class="tbl"><table><thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>CLS</th><th>TBT</th><th /></tr></thead><tbody>${body}</tbody></table></div>
    ${audits.length ? `<div class="diagnosis"><h3>Kenapa skor segini?</h3><ol class="cause-list">${audits.map(a => `<li class="cause"><p class="cause-why">${esc(a)}</p></li>`).join('')}</ol></div>` : ''}
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
  return `<span class="b ${failed.length ? 'bad' : 'ok'}">${failed.length ? 'Gagal' : 'Lulus'}</span> <span class="mut">${esc(parts.join(' · '))}</span>`;
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
  const head = `<h2><span class="tool ${run.tool === 'pw' ? 'pw' : 'lh'}">${run.tool === 'pw' ? 'Playwright' : 'Lighthouse'}</span> ${statusBadge(run.status)}</h2>
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
      body: sections.join('\n') + `<p class="doc-footer">Dibangun ${date(new Date().toISOString())} · cakupan ${esc(report.scope)} · ${runIds.length} run</p>`,
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
        durationMs: run.duration_ms ?? null,
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
