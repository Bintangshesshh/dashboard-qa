// Render laporan run jadi HTML statis satu file: CSS inline, tanpa script.
// Aman dibuka di iframe ber-sandbox (opaque origin) karena tidak ada subrequest.
import { reportCss } from './report-css.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pretty = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '');
const pre = value => `<pre>${esc(pretty(value))}</pre>`;
const artifact = path => 'artifacts/' + path.split('/').map(encodeURIComponent).join('/');
const flattenSteps = (steps = []) => steps.flatMap(step => [step, ...flattenSteps(step.steps)]);
const location = value => (value?.file ? [value.file, value.line, value.column].filter(v => v != null).join(':') : null);

// Pembungkus semua halaman report: nav + hero + panel. Satu tempat untuk <head> dan tema.
export const doc = ({ title, brand, sub = '', actions = '', hero = '', body = '' }) => `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><style>${reportCss}</style></head><body>
<header class="top-nav"><div class="top-nav-inner">
<div><div class="brand-title">${esc(brand)}</div>${sub ? `<div class="brand-subtitle">${esc(sub)}</div>` : ''}</div>
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${actions}</div>
</div></header>
<main class="container">${hero}${body}</main></body></html>`;

export // title is plain text, or ready-made markup when it already carries its own heading.
const panel = (title, body, note = '') => `<section class="panel"><div class="panel-head"><div>
${title.startsWith('<') ? title : `<h2>${title}</h2>`}${note ? `<p>${note}</p>` : ''}</div></div><div class="panel-body">${body}</div></section>`;

export const tiles = items => `<section class="card-row">${items.map(([label, value, sub, cls = '']) => `<div class="tile">
<div class="tile-label">${esc(label)}</div><div class="tile-value${String(value).length > 9 ? ' sm' : ''}"${cls ? ` style="color:var(--${cls})"` : ''}>${value}</div>
<div class="tile-sub${cls ? ' ' + (cls === 'success' ? 'good' : cls) : ''}">${esc(sub)}</div></div>`).join('')}</section>`;

export const statusBadge = status => `<span class="b ${status === 'passed' ? 'ok' : ['failed', 'cancelled', 'interrupted'].includes(status)
  ? 'bad' : status === 'flaky' ? 'warn' : 'mut2'}">${esc(status ?? 'tidak diketahui')}</span>`;

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
  return `<article><h3>${esc(test.title)}</h3><p class="mono mut">${esc(location(test))} · project: ${esc(test.projectName || 'tidak diketahui')}`
    + ` · diharapkan: ${esc(test.expectedStatus || '-')} · hasil: ${esc(test.status || '-')}</p>${attempts}</article>`;
}

function playwrightSection(data) {
  const rows = tests(data.suites);
  const failures = rows.filter(needsAttention);
  const others = rows.filter(test => !needsAttention(test));
  const list = rows.map((test, i) => {
    const total = (test.results || []).reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    return `<tr><td class="mono">${i + 1}</td><td>${esc(test.title)}</td>
<td class="mono">${esc(location(test) || test.file || '-')}</td>
<td>${needsAttention(test) ? '<span class="b bad">perlu diperiksa</span>' : '<span class="b ok">sesuai harapan</span>'}</td>
<td class="mono">${total >= 1000 ? (total / 1000).toFixed(2) + ' s' : total + ' ms'}</td></tr>`;
  }).join('');
  return `<p><strong>${failures.length} entri test perlu diperiksa</strong> / ${rows.length} total.`
    + ` Kegagalan yang diharapkan dan retry tetap terlihat; test flaky tidak dianggap lulus.</p>`
    + `<div class="tbl"><table><thead><tr><th>#</th><th>Test</th><th>Lokasi</th><th>Hasil</th><th>Durasi</th></tr></thead>`
    + `<tbody>${list}</tbody></table></div>`
    + `${data.errors?.length > 0 ? `<h3>Error runner</h3>${data.errors.map(error => errorDetail(error)).join('')}` : ''}`
    + failures.map(testResult).join('')
    + `<details><summary>Entri test lain (${others.length})</summary>${others.map(testResult).join('')}</details>`;
}

const score = value => (typeof value === 'number' ? Math.round(value * 100) + '/100' : 'Tidak dinilai');
const tone = value => (typeof value !== 'number' ? 'mut2' : value >= 0.9 ? 'ok' : value >= 0.5 ? 'warn' : 'bad');

// Skor kategori dibaca sebagai gauge, bukan teks: satu pandangan cukup.
function scoreRing(label, value) {
  const pct = typeof value === 'number' ? Math.round(value * 100) : null;
  const cls = tone(value);
  const dash = 138.2;
  return `<li class="score"><svg viewBox="0 0 56 56" role="img" aria-label="${esc(label)} ${pct ?? 'tidak dinilai'}">
<circle class="track" cx="28" cy="28" r="22"></circle>
<circle class="val ${cls}" cx="28" cy="28" r="22" stroke-dasharray="${dash}" stroke-dashoffset="${dash - (dash * (pct ?? 0)) / 100}"></circle>
</svg><b class="num-${cls}">${pct ?? '-'}</b><span>${esc(label)}</span></li>`;
}

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
    .map(([id, c]) => scoreRing(c.title || id, c.score)).join('');
  const metrics = [['FCP', data.audits?.['first-contentful-paint']?.displayValue],
    ['LCP', data.audits?.['largest-contentful-paint']?.displayValue],
    ['TBT', data.audits?.['total-blocking-time']?.displayValue],
    ['CLS', data.audits?.['cumulative-layout-shift']?.displayValue]]
    .filter(([, value]) => value)
    .map(([name, value]) => `<div class="cwv-card"><div class="cwv-name">${name}</div>
<div class="cwv-val">${esc(value)}</div><div class="cwv-target">terukur pada run ini</div></div>`).join('');
  const warnings = (data.runWarnings || []).map(warning => `<li>${esc(warning)}</li>`).join('');
  return `<p class="mono">URL: ${esc(data.finalDisplayedUrl || data.finalUrl || data.requestedUrl)} · diambil: ${esc(data.fetchTime)}</p>`
    + `<ul class="scores">${categories}</ul>`
    + `${metrics ? `<div class="cwv-grid">${metrics}</div>` : ''}`
    + `${data.runtimeError ? `<h3>Error runtime</h3>${errorDetail(data.runtimeError)}` : ''}`
    + `${warnings ? `<h3>Peringatan</h3><ul>${warnings}</ul>` : ''}`
    + `<h3>Audit prioritas (${audits.length})</h3>`
    + `<p>Error audit runtime lebih dulu, lalu defisit skor × bobot kategori (audit tanpa bobot dihitung 1).`
    + ` Hasil observasi bukan bukti pasti ada cacat produk.</p>`
    + audits.map((a, i) => `<article><h4>${i + 1}. ${esc(a.title || a.id)}</h4>`
      + `<p><strong class="num-${tone(a.score)}">${esc(score(a.score))}</strong>${a.displayValue ? ' · ' + esc(a.displayValue) : ''}</p>`
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
    + failed.map(test => `<article><h3>${esc(test.title)} · ${esc(test.status)}</h3>`
      + `<p class="mono mut">${esc(location(test.location || test))} · project: ${esc(test.projectName || 'tidak diketahui')}`
      + ` · percobaan ${(test.retry || 0) + 1}</p>${failedSteps(test.steps)}</article>`).join('')
    + `<details><summary>Semua langkah tercatat</summary>${pre(data.tests)}</details>`;
}

const sectionBody = r => (r.kind === 'playwright' ? playwrightSection(r.data)
  : r.kind === 'lighthouse' ? lighthouseSection(r.data) : stepSection(r.data));

// Teks polos untuk disalin ke tiket atau dokumen: fakta run + baris gagal saja.
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
  const run = report.run;
  const html = report.files.filter(f => /\.html?$/i.test(f));
  const screenshots = report.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const traces = report.files.filter(f => /trace.*\.zip$/i.test(f));
  const archives = report.files.filter(f => /\.(tar\.gz|tgz|zip)$/i.test(f) && !traces.includes(f));
  const download = (path, label) => `<a href="${esc(artifact(path))}" download>${esc(label ?? path)}</a>`;
  const buka = path => `<a href="${esc(artifact(path))}" target="_blank" rel="noopener">buka</a>`;
  const tool = run.mode === 'lh' ? 'Lighthouse' : 'Playwright';
  const target = run.targetUrl || 'tidak diketahui';

  const hero = `<section class="hero">
<div class="eyebrow">Laporan run teramati</div>
<h1>${esc(run.suiteName || run.id)}</h1>
<p class="lead">Hanya fakta run yang teramati. Artifact yang hilang bukan berarti lulus. Metadata dan log adalah snapshot saat dokumen ini dibangun.</p>
<div class="meta-strip">
<div class="meta-item"><span class="mut">Target</span>${/^https?:/.test(target)
    ? `<a class="target-url" href="${esc(target)}" target="_blank" rel="noopener">${esc(target)}</a>` : esc(target)}</div>
<div class="meta-divider"></div>
<div class="meta-item"><span class="mut">Tool</span><span class="env-tag">${tool}</span></div>
<div class="meta-divider"></div>
<div class="meta-item"><span class="mut">Status</span>${statusBadge(run.status)}</div>
<div class="meta-divider"></div>
<div class="meta-item"><span class="mut">Exit</span><strong>${esc(run.exitCode ?? '-')}</strong></div>
</div>
${run.error ? `<div class="snapshot-banner" role="alert">${errorDetail(run.error)}</div>` : ''}
</section>`;

  const kpi = tiles([
    ['Status', statusBadge(run.status), `exit ${run.exitCode ?? '-'}`],
    ['Artifact', String(report.files.length), `${html.length} html · ${screenshots.length} gambar`],
    ['Selesai', esc((run.finishedAt || '-').replace('T', ' ').slice(0, 19)), 'waktu server'],
    ['Peringatan', String(report.warnings.length), report.warnings.length ? 'perlu dibaca' : 'tidak ada', report.warnings.length ? 'warn' : ''],
  ]);

  const body = `${kpi}
${panel('Ringkasan kegagalan lebih dulu', `${report.reports.length
    ? `<p>${report.reports.length} sumber JSON terbaca; kegagalan dirinci di panel di bawah.</p>`
    : '<p class="mut">Tidak ada JSON report yang terbaca. Run tidak dianggap lulus.</p>'}`
    + `<details><summary>Metadata run</summary>${pre(run)}</details>`)}
${report.warnings.length > 0 ? panel('Peringatan', `<ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`) : ''}
${report.reports.map(r => panel(`${esc(r.kind === 'steps' ? 'Langkah' : r.kind === 'lighthouse' ? 'Lighthouse' : 'Playwright')} · ${esc(r.path)}`, `${sectionBody(r)}
<p class="mut">${download(r.path, 'Unduh JSON sumber')}</p>`)).join('')}
${panel('Teks ringkas (salin tempel)', `<p>Salin blok di bawah ke tiket atau dokumen. Isinya pesan error, lokasi, dan angka yang sama dengan tabel di atas. Tersedia juga sebagai <a href="ringkas.txt" download>ringkas.txt</a>.</p>
<pre id="ringkas">${esc(ringkasTeks(report))}</pre>`)}
${panel('Report HTML asli', `<p>Report asli dari tool dibuka di tab baru, atau diunduh untuk dibuka offline. Halaman ini statis; viewer interaktif mungkin tidak jalan bila disajikan sebagai lampiran.</p>
${html.length ? `<ul>${html.map(f => `<li>${buka(f)} · ${download(f, 'unduh ' + f)}</li>`).join('')}</ul>` : '<p class="mut">Tidak ada report HTML asli.</p>'}`)}
${panel('Screenshot', screenshots.length
    ? screenshots.map(f => `<figure>${download(f, 'Unduh screenshot: ' + f)} · ${buka(f)}</figure>`).join('')
    : '<p class="mut">Tidak ada screenshot.</p>')}
${panel('Bundel artifact', report.bundle
    ? '<p><a href="downloads/artifacts.tar.gz" download>Unduh artifacts.tar.gz</a> · artifact dan log, tanpa source run.json dan symlink.</p>'
    : '<p class="mut">Bundel tidak tersedia. Unduh artifact satu per satu di bawah.</p>')}
${panel('Arsip report', `<p>Arsip dari runner ada di bawah. Isi folder report bisa diunduh dari daftar Semua artifact.</p>
${archives.length ? `<ul>${archives.map(f => `<li>${download(f, 'Unduh ' + f)}</li>`).join('')}</ul>` : '<p class="mut">Tidak ada arsip.</p>'}`)}
${panel('Trace dan pembukaan offline', `<ul>${traces.map(f => `<li>${download(f)}</li>`).join('')}</ul>
<p>Unduh trace ZIP, lalu jalankan <code>npx playwright show-trace /path/to/trace.zip</code> di mesin yang punya Playwright. Viewer jalan lokal; jangan unggah trace privat ke layanan pihak ketiga. Trace ZIP bukan halaman HTML.</p>
<p>Untuk report Playwright offline, unduh seluruh folder report HTML beserta folder data-nya, lalu jalankan <code>npx playwright show-report /path/to/report-folder</code>. Report HTML Lighthouse bisa dibuka lokal. Sajikan folder dokumen ini lewat HTTP di base path-nya; membuka index.html lewat file:// tidak didukung.</p>`)}
${panel('Log runner', `<details><summary>Tampilkan log runner asli</summary>${pre(report.logs)}</details>`)}
${panel('Semua artifact', report.files.length
    ? `<ul>${report.files.map(f => `<li>${download(f)}</li>`).join('')}</ul>` : '<p class="mut">Tidak ada artifact.</p>')}`;

  return doc({
    title: `${run.suiteName || run.id} · ${run.status}`,
    brand: run.suiteName || run.id,
    sub: `run ${run.id}`,
    actions: `${statusBadge(run.status)}<a class="b mut2" href="ringkas.txt" download>ringkas.txt</a>`,
    hero,
    body,
  });
}

// intro: HTML ringkasan sesi (verdict + identitas) yang dipakai sebagai hero.
export function indexHtml(runs, intro = '') {
  const rows = runs.map(r => `<tr>
<td><a href="${esc(r.slug)}/index.html">${esc(r.suiteName || r.id.slice(0, 8))}</a><div class="mono mut">${esc(r.id.slice(0, 8))}</div></td>
<td><span class="tool">${r.mode === 'lh' ? 'Lighthouse' : 'Playwright'}</span></td>
<td>${statusBadge(r.status)}</td>
<td class="mono">${esc(r.targetUrl || '-')}</td>
<td class="mono">${esc((r.finishedAt || '-').replace('T', ' ').slice(0, 19))}</td>
<td><a href="${esc(r.slug)}/ringkas.txt" download>teks</a></td></tr>`).join('');
  const failed = runs.filter(r => r.status !== 'passed').length;
  const tools = [...new Set(runs.map(r => (r.mode === 'lh' ? 'Lighthouse' : 'Playwright')))].join(' + ') || '-';
  const kpi = tiles([
    ['Run', String(runs.length), 'tercatat di sesi ini'],
    ['Lulus', String(runs.length - failed), 'status passed', runs.length - failed ? 'success' : ''],
    ['Perlu diperiksa', String(failed), failed ? 'buka halaman run' : 'tidak ada', failed ? 'danger' : ''],
    ['Tool', tools, 'dipakai sesi ini'],
  ]);
  const hero = intro
    ? `<section class="hero">${intro}</section>`
    : `<section class="hero"><div class="eyebrow">Laporan sesi</div><h1>Laporan run</h1>
<p class="lead">Ringkasan per run. Setiap halaman memuat fakta run apa adanya; artifact yang hilang bukan berarti lulus. Kolom Teks berisi ringkasan polos siap disalin.</p></section>`;
  return doc({
    title: 'Laporan run',
    brand: 'Laporan run',
    sub: 'dokumen statis',
    actions: `<span class="b ${failed ? 'bad' : 'ok'}">${failed ? 'perlu diperiksa' : 'semua passed'}</span>`,
    hero,
    body: `${kpi}<section class="panel"><div class="panel-head"><div><h2>Ringkasan per run</h2>
<p>Kolom Teks berisi ringkasan polos siap disalin.</p></div></div><div class="panel-body">
<div class="tbl"><table><thead><tr><th>Run</th><th>Tool</th><th>Status</th><th>Target</th><th>Selesai</th><th>Teks</th></tr></thead>
<tbody>${rows}</tbody></table></div></div></section>`,
  });
}
