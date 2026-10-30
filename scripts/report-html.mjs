// Render laporan run jadi HTML statis satu file: CSS inline, tanpa script.
// Aman dibuka di iframe ber-sandbox (opaque origin) karena tidak ada subrequest.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const css = `
:root{--bg:#0b1020;--card:#131a2e;--line:#233052;--fg:#e7ecf7;--mut:#93a1c0;--bad:#ff6b81;--warn:#ffc857;--acc:#5b8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Segoe UI",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:2rem 1rem}h1{font-size:24px;margin:0 0 8px}
h2{font-size:16px;color:var(--acc);margin:28px 0 10px}h3{font-size:14px;margin:20px 0 6px}h4{font-size:13px;margin:12px 0 4px}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:10px 0}
a{color:#8fb0ff}pre{background:#080d19;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;
max-height:600px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
ul.plain{display:flex;flex-wrap:wrap;gap:1.5rem;list-style:none;padding:0}
`;

const pretty = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '');
const pre = value => `<pre>${esc(pretty(value))}</pre>`;
const artifact = path => 'artifacts/' + path.split('/').map(encodeURIComponent).join('/');
const flattenSteps = (steps = []) => steps.flatMap(step => [step, ...flattenSteps(step.steps)]);
const location = value => (value?.file ? [value.file, value.line, value.column].filter(v => v != null).join(':') : null);

function tests(suites = [], parents = []) {
  return suites.flatMap(suite => [
    ...(suite.specs || []).flatMap(spec => (spec.tests || []).map(test => ({
      ...test, title: [...parents, suite.title, spec.title].filter(Boolean).join(' / '), file: spec.file, line: spec.line,
    }))),
    ...tests(suite.suites, [...parents, suite.title]),
  ]);
}

function errorDetail(error, at) {
  if (!error) return '';
  const message = error.message || error.value || (typeof error === 'string' ? error : 'Error tanpa pesan');
  return `<p><strong>${esc(location(error.location || at) || 'Lokasi tidak tersedia')}</strong></p>${pre(message)}`
    + `${error.snippet ? pre(error.snippet) : ''}`
    + `${error.stack ? `<details><summary>Jejak stack</summary>${pre(error.stack)}</details>` : ''}`;
}

const failedSteps = steps => flattenSteps(steps).filter(step => step.error)
  .map(step => `<div><h4>Langkah gagal: ${esc(step.title)}</h4>${errorDetail(step.error, step.location)}</div>`).join('');

const needsAttention = test => test.status === 'unexpected' || test.status === 'flaky'
  || (test.results || []).some(r => ['failed', 'timedOut', 'interrupted'].includes(r.status));

function testResult(test) {
  const attempts = (test.results || []).map((result, j) => {
    const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
    return `<div><h4>Percobaan ${(result.retry ?? j) + 1}: ${esc(result.status)} (${esc(result.duration)} ms)</h4>`
      + errors.map(error => errorDetail(error, test)).join('')
      + failedSteps(result.steps)
      + `${result.attachments?.length > 0 ? `<details><summary>Metadata lampiran</summary>${pre(result.attachments)}</details>` : ''}</div>`;
  }).join('');
  return `<article><h3>${esc(test.title)}</h3><p>${esc(location(test))} - project: ${esc(test.projectName || 'tidak diketahui')}`
    + ` - diharapkan: ${esc(test.expectedStatus || '-')} - hasil: ${esc(test.status || '-')}</p>${attempts}</article>`;
}

function playwrightSection(data) {
  const rows = tests(data.suites);
  const failures = rows.filter(needsAttention);
  const others = rows.filter(test => !needsAttention(test));
  return `<p><strong>${failures.length} entri test perlu diperiksa</strong> / ${rows.length} total.`
    + ` Kegagalan yang diharapkan dan retry tetap terlihat; test flaky tidak dianggap lulus.</p>`
    + `${data.errors?.length > 0 ? `<h3>Error runner</h3>${data.errors.map(error => errorDetail(error)).join('')}` : ''}`
    + failures.map(testResult).join('')
    + `<details><summary>Entri test lain (${others.length})</summary>${others.map(testResult).join('')}</details>`;
}

const score = value => (typeof value === 'number' ? Math.round(value * 100) + '/100' : 'Tidak dinilai');

function lighthouseSection(data) {
  const weights = {};
  Object.values(data.categories).forEach(category => (category.auditRefs || []).forEach(ref => {
    weights[ref.id] = Math.max(weights[ref.id] || 0, ref.weight || 0);
  }));
  const audits = Object.values(data.audits)
    .filter(a => a.scoreDisplayMode === 'error' || a.errorMessage || (typeof a.score === 'number' && a.score < 1))
    .sort((a, b) => Number(Boolean(b.errorMessage || b.scoreDisplayMode === 'error')) - Number(Boolean(a.errorMessage || a.scoreDisplayMode === 'error'))
      || ((1 - (b.score ?? 0)) * (weights[b.id] || 1)) - ((1 - (a.score ?? 0)) * (weights[a.id] || 1)));
  const categories = Object.entries(data.categories)
    .map(([id, c]) => `<li><strong>${esc(c.title || id)}: ${esc(score(c.score))}</strong></li>`).join('');
  const warnings = (data.runWarnings || []).map(warning => `<li>${esc(warning)}</li>`).join('');
  return `<p>URL: ${esc(data.finalDisplayedUrl || data.finalUrl || data.requestedUrl)} - diambil: ${esc(data.fetchTime)}</p>`
    + `<ul class="plain">${categories}</ul>`
    + `${data.runtimeError ? `<h3>Error runtime</h3>${errorDetail(data.runtimeError)}` : ''}`
    + `${warnings ? `<ul>${warnings}</ul>` : ''}`
    + `<h3>Audit prioritas (${audits.length})</h3>`
    + `<p>Error audit runtime lebih dulu, lalu defisit skor × bobot kategori (audit tanpa bobot dihitung 1).`
    + ` Hasil observasi bukan bukti pasti ada cacat produk.</p>`
    + audits.map((a, i) => `<article><h4>${i + 1}. ${esc(a.title || a.id)}</h4>`
      + `<p><strong>${esc(score(a.score))}</strong>${a.displayValue ? ' - ' + esc(a.displayValue) : ''}</p>`
      + `${a.errorMessage ? `<p role="alert">${esc(a.errorMessage)}</p>` : ''}`
      + `${a.explanation ? `<p>${esc(a.explanation)}</p>` : ''}`
      + `${a.description ? `<p>${esc(a.description)}</p>` : ''}`
      + `${a.details ? `<details><summary>Elemen terdampak dan nilai terukur</summary>${pre(a.details)}</details>` : ''}`
      + `</article>`).join('');
}

function stepSection(data) {
  const failed = data.tests.filter(test => flattenSteps(test.steps).some(step => step.error)
    || ['failed', 'timedOut', 'interrupted'].includes(test.status));
  return `<p>${failed.length} percobaan perlu diperiksa / ${data.tests.length} percobaan tercatat.</p>`
    + failed.map(test => `<article><h3>${esc(test.title)} - ${esc(test.status)}</h3>`
      + `<p>${esc(location(test.location || test))} - project: ${esc(test.projectName || 'tidak diketahui')}`
      + ` - percobaan ${(test.retry || 0) + 1}</p>${failedSteps(test.steps)}</article>`).join('')
    + `<details><summary>Semua langkah tercatat</summary>${pre(data.tests)}</details>`;
}

const sectionBody = r => (r.kind === 'playwright' ? playwrightSection(r.data)
  : r.kind === 'lighthouse' ? lighthouseSection(r.data) : stepSection(r.data));

// Teks polos untuk ditempel ke chat AI / tiket bug: fakta run + baris gagal saja.
// Dibuat dari data yang sama dengan tabel, jadi tidak bisa berbeda.
export function ringkasTeks(report) {
  const out = [];
  const run = report.run;
  out.push(`Run ${run.id} | ${run.suiteName ?? '-'} | mode ${run.mode ?? '-'} | status ${run.status}`);
  out.push(`Target ${run.targetUrl ?? '-'} | mulai ${run.startedAt ?? '-'} | selesai ${run.finishedAt ?? '-'} | exit ${run.exitCode ?? '-'}`);
  if (run.error) out.push(`Error run: ${typeof run.error === 'string' ? run.error : JSON.stringify(run.error)}`);
  for (const r of report.reports) {
    if (r.kind === 'playwright') {
      for (const test of tests(r.data.suites).filter(needsAttention)) {
        const attempts = (test.results || []).map((result, j) => {
          const errs = (result.errors?.length ? result.errors : result.error ? [result.error] : [])
            .map(e => e.message || e.value || String(e));
          return `  percobaan ${(result.retry ?? j) + 1}: ${result.status}${errs.length ? ' - ' + errs.join(' / ') : ''}`;
        });
        out.push(`FAIL ${test.title} (${location(test) ?? '-'})`);
        out.push(...attempts);
        for (const step of flattenSteps(test.results?.flatMap(x => x.steps ?? []) ?? []).filter(s => s.error)) {
          out.push(`  langkah gagal: ${step.title} - ${step.error.message ?? step.error.value ?? ''}`);
        }
      }
    } else if (r.kind === 'lighthouse') {
      const data = r.data;
      const skor = Object.entries(data.categories).map(([id, c]) => `${c.title || id} ${score(c.score)}`).join(', ');
      out.push(`LH ${data.finalDisplayedUrl || data.finalUrl || data.requestedUrl}: ${skor}`);
      for (const a of Object.values(data.audits).filter(a => a.errorMessage || (typeof a.score === 'number' && a.score < 1))) {
        out.push(`  audit ${a.title || a.id}: ${score(a.score)}${a.displayValue ? ' - ' + a.displayValue : ''}`);
      }
    } else if (r.kind === 'steps') {
      for (const test of r.data.tests.filter(t => flattenSteps(t.steps).some(s => s.error))) {
        out.push(`FAIL ${test.title} (${test.status})`);
        for (const step of flattenSteps(test.steps).filter(s => s.error)) out.push(`  ${step.title}: ${step.error.message ?? ''}`);
      }
    }
  }
  for (const w of report.warnings) out.push(`PERINGATAN ${w}`);
  return out.join('\n');
}

// report: { run, logs, files, reports, warnings, bundle }
export function runReportHtml(report) {
  const html = report.files.filter(f => /\.html?$/i.test(f));
  const screenshots = report.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const traces = report.files.filter(f => /trace.*\.zip$/i.test(f));
  const archives = report.files.filter(f => /\.(tar\.gz|tgz|zip)$/i.test(f) && !traces.includes(f));
  const download = (path, label) => `<a href="${esc(artifact(path))}" download>${esc(label ?? path)}</a>`;
  const buka = path => `<a href="${esc(artifact(path))}" target="_blank" rel="noopener">buka</a>`;

  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Laporan run</title><style>${css}</style></head><body><main>
<h1>Laporan run</h1><p>Hanya fakta run yang teramati. Artifact yang hilang bukan berarti lulus. Metadata dan log adalah snapshot saat dokumen ini dibangun.</p>
<h2>Ringkasan kegagalan lebih dulu</h2><p><strong>${esc(report.run.suiteName || report.run.id)}: ${esc(report.run.status)}</strong> - target: ${esc(report.run.targetUrl || 'tidak diketahui')}</p>
${report.run.error ? errorDetail(report.run.error) : ''}<details><summary>Metadata run</summary>${pre(report.run)}</details>
${report.warnings.length > 0 ? `<h2>Peringatan</h2><ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
${report.reports.map(r => `<section><h2>${esc(r.kind)}: ${esc(r.path)}</h2>${sectionBody(r)}<p>${download(r.path, 'Unduh JSON sumber')}</p></section>`).join('')}
<h2>Teks siap tempel (untuk AI agent / tiket bug)</h2>
<p>Salin blok di bawah dan tempel ke chat agent atau tiket. Isinya pesan error, lokasi, dan angka yang sama dengan tabel di atas. Tersedia juga sebagai <a href="ringkas.txt" download>ringkas.txt</a>.</p>
<pre id="ringkas">${esc(ringkasTeks(report))}</pre>
<h2>Report HTML asli</h2><p>Report asli dari tool dibuka di tab baru, atau diunduh untuk dibuka offline. Halaman ini statis; viewer interaktif mungkin tidak jalan bila disajikan sebagai lampiran.</p>
${html.length ? `<ul>${html.map(f => `<li>${buka(f)} · ${download(f, 'unduh ' + f)}</li>`).join('')}</ul>` : '<p>Tidak ada report HTML asli.</p>'}
<h2>Screenshot</h2>${screenshots.length ? screenshots.map(f => `<figure>${download(f, 'Unduh screenshot: ' + f)} · ${buka(f)}</figure>`).join('') : '<p>Tidak ada screenshot.</p>'}
<h2>Bundel artifact</h2>${report.bundle
    ? '<p><a href="downloads/artifacts.tar.gz" download>Unduh artifacts.tar.gz</a> - artifact dan log, tanpa source run.json dan symlink.</p>'
    : '<p>Bundel tidak tersedia. Unduh artifact satu per satu di bawah.</p>'}
<h2>Arsip report</h2><p>Arsip dari runner ada di bawah. Isi folder report bisa diunduh dari daftar Semua artifact.</p>
<ul>${archives.map(f => `<li>${download(f, 'Unduh ' + f)}</li>`).join('')}</ul>
<h2>Trace dan pembukaan offline</h2><ul>${traces.map(f => `<li>${download(f)}</li>`).join('')}</ul>
<p>Unduh trace ZIP, lalu jalankan <code>npx playwright show-trace /path/to/trace.zip</code> di mesin yang punya Playwright. Viewer jalan lokal; jangan unggah trace privat ke layanan pihak ketiga. Trace ZIP bukan halaman HTML.</p>
<p>Untuk report Playwright offline, unduh seluruh folder report HTML beserta folder data-nya, lalu jalankan <code>npx playwright show-report /path/to/report-folder</code>. Report HTML Lighthouse bisa dibuka lokal. Sajikan folder dokumen ini lewat HTTP di base path-nya; membuka index.html lewat file:// tidak didukung.</p>
<h2>Log runner</h2><details><summary>Tampilkan log runner asli</summary>${pre(report.logs)}</details>
<h2>Semua artifact</h2><ul>${report.files.map(f => `<li>${download(f)}</li>`).join('')}</ul>
</main></body></html>`;
}

// intro: HTML ringkasan sesi (verdict + KPI) yang disisipkan di atas tabel run.
export function indexHtml(runs, intro = '') {
  const rows = runs.map(r => `<tr>
<td><a href="${esc(r.slug)}/index.html">${esc(r.suiteName || r.id.slice(0, 8))}</a></td>
<td>${r.mode === 'lh' ? 'Lighthouse' : 'Playwright'}</td>
<td>${esc(r.status)}</td><td>${esc(r.targetUrl || '-')}</td><td>${esc(r.finishedAt || '-')}</td><td><a href="${esc(r.slug)}/ringkas.txt">teks</a></td></tr>`).join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Laporan run</title><style>${css}</style></head><body><main>
<h1>Laporan run</h1>
${intro}
<p>Ringkasan per run. Setiap halaman memuat fakta run apa adanya; artifact yang hilang bukan berarti lulus. Kolom <strong>Teks</strong> berisi ringkasan polos siap tempel ke agent atau tiket.</p>
<table><thead><tr><th>Run</th><th>Tool</th><th>Status</th><th>Target</th><th>Selesai</th><th>Teks</th></tr></thead>
<tbody>${rows}</tbody></table>
</main></body></html>`;
}

