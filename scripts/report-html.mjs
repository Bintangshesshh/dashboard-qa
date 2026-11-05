// Render laporan run jadi HTML statis satu file: CSS inline, tanpa script.
// Aman dibuka di iframe ber-sandbox (opaque origin) karena tidak ada subrequest.
import { reportCss } from './report-css.mjs';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pretty = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '');
const pre = value => `<pre>${esc(pretty(value))}</pre>`;
const artifact = path => 'artifacts/' + path.split('/').map(encodeURIComponent).join('/');
const flattenSteps = (steps = []) => steps.flatMap(step => [step, ...flattenSteps(step.steps)]);
const location = value => (value?.file ? [value.file, value.line, value.column].filter(v => v != null).join(':') : null);

// Angka durasi/ukuran dipakai beberapa panel; satu format supaya tidak beda.
const fmtMs = value => {
  if (value == null || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} s` : `${Math.round(n)} ms`;
};
// Timestamp DB UTC; laporan statis memakai WIB seperti dashboard.
const TZ = 'Asia/Jakarta';
const fmtWib = value => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const opts = { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (d.toLocaleString('id-ID', { timeZone: TZ, year: 'numeric' })
    !== new Date().toLocaleString('id-ID', { timeZone: TZ, year: 'numeric' })) opts.year = 'numeric';
  return d.toLocaleString('id-ID', opts) + ' WIB';
};
const fmtBytes = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
};
const runSpan = run => {
  const start = Date.parse(run?.startedAt ?? '');
  const end = Date.parse(run?.finishedAt ?? '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  // run.json lama belum punya finishedAt; durasi dari DB masih fakta yang sama.
  const duration = Number(run?.durationMs);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
};
const testMs = test => (test.results || []).reduce((sum, result) => sum + (Number(result.duration) || 0), 0);
const CAT_SHORT = { performance: 'Perf', accessibility: 'A11y', 'best-practices': 'BP', 'best practices': 'BP', seo: 'SEO' };
const catShort = title => CAT_SHORT[String(title ?? '').toLowerCase()] || title || 'Lainnya';

// Pembungkus semua halaman report: nav + hero + panel. Satu tempat untuk <head> dan tema.
export const doc = ({ title, brand, sub = '', actions = '', hero = '', body = '' }) => `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#0b1020" media="(prefers-color-scheme:dark)">
<title>${esc(title)}</title><style>${reportCss}</style></head><body>
<a class="skip" href="#main">Lewati ke konten</a>
<header class="top-nav"><div class="container top-nav-inner">
<div class="nav-brand"><div class="brand-text"><div class="brand-title">${esc(brand)}</div>${sub ? `<div class="brand-subtitle">${esc(sub)}</div>` : ''}</div></div>
<div class="nav-actions">${actions}</div>
</div></header>
<main class="container" id="main">${hero}${body}</main></body></html>`;

export // title is plain text, or ready-made markup when it already carries its own heading.
const panel = (title, body, note = '', id = '') => `<section class="panel"${id ? ` id="${esc(id)}"` : ''}><div class="panel-head"><div>
${title.startsWith('<') ? title : `<h2>${title}</h2>`}${note ? `<p>${note}</p>` : ''}</div></div><div class="panel-body">${body}</div></section>`;

// cls menerima nama tone lama (success/danger/warn) supaya pemanggil tidak perlu berubah.
export const tiles = items => `<section class="card-row">${items.map(([label, value, sub, cls = '']) => {
  const tone = cls === 'success' ? 'ok' : cls === 'danger' ? 'bad' : cls === 'warn' ? 'warn' : '';
  const text = String(value).replace(/<[^>]+>/g, '');
  return `<div class="tile${tone ? ` tone-${tone}` : ''}">
<div class="tile-top"><span class="tile-label">${esc(label)}</span><span class="tile-dot" aria-hidden="true"></span></div>
<div class="tile-value${text.length > 9 ? ' sm' : ''}">${value}</div>
<div class="tile-sub">${esc(sub)}</div></div>`;
}).join('')}</section>`;

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

const slowRow = (title, ms, max, meta = '') => `<li class="slow-row">
<div class="slow-head"><span class="slow-name">${esc(title)}</span><span class="slow-ms">${fmtMs(ms)}</span></div>
<div class="slow-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round((Number(ms) || 0) / Math.max(1, max) * 100))}%"></span></div>
${meta ? `<div class="slow-meta">${meta}</div>` : ''}</li>`;

function playwrightSection(run, data) {
  const rows = tests(data.suites);
  if (!rows.length) return '<p class="empty">data tidak ditemukan - JSON Playwright hilang atau korup. Run tidak dianggap lulus.</p>';
  const failures = rows.filter(needsAttention);
  const others = rows.filter(test => !needsAttention(test));
  const totals = rows.map(test => ({ test, total: testMs(test) }));
  const totalTest = totals.reduce((sum, item) => sum + item.total, 0);
  const wall = runSpan(run);
  const overhead = wall != null ? wall - totalTest : null;
  const attempts = rows.reduce((sum, test) => sum + (test.results || []).length, 0);
  const retries = rows.reduce((sum, test) => sum + (test.results || []).filter(result => Number(result.retry) > 0).length, 0);
  const slowTests = [...totals].sort((a, b) => b.total - a.total).slice(0, 5);
  const maxTotal = Math.max(1, ...totals.map(item => item.total));
  const slowSteps = rows.flatMap(test => flattenSteps((test.results || []).flatMap(result => result.steps ?? []))
    .filter(step => Number(step.duration) > 0)
    .map(step => ({ step, test: test.title })))
    .sort((a, b) => Number(b.step.duration) - Number(a.step.duration)).slice(0, 5);
  const maxTest = slowTests[0]?.total || 1;
  const maxStep = Number(slowSteps[0]?.step.duration) || 1;

  // Penyebab durasi: wall-clock vs jumlah test, lalu test/langkah terlama.
  const diag = `<div class="diagnosis"><h3>Kenapa run selama ini?</h3>
<div class="diag-grid">
<div class="diag"><span class="diag-label">Durasi run</span><span class="diag-value">${fmtMs(wall)}</span><span class="diag-sub">dari mulai sampai selesai</span></div>
<div class="diag"><span class="diag-label">Total test</span><span class="diag-value">${fmtMs(totalTest)}</span><span class="diag-sub">${attempts} percobaan · ${rows.length} test</span></div>
<div class="diag"><span class="diag-label">Retry</span><span class="diag-value">${retries}</span><span class="diag-sub">${retries ? 'percobaan ulang menambah waktu' : 'tidak ada percobaan ulang'}</span></div>
<div class="diag"><span class="diag-label">Tes terlama</span><span class="diag-value">${fmtMs(slowTests[0]?.total)}</span><span class="diag-sub">${esc(slowTests[0]?.test.title || '-')}</span></div>
</div>
${overhead != null ? `<p class="diag-note">${overhead >= 0
    ? `${fmtMs(overhead)} dari durasi run tidak tercatat di durasi test (setup, browser launch, atau antrean runner).`
    : `Total durasi test ${fmtMs(totalTest)} lebih besar dari wall-clock ${fmtMs(wall)} karena test berjalan paralel.`}</p>` : ''}
${slowTests.length ? `<h3>Tes terlama</h3><ol class="slow-list">${slowTests.map(({ test, total }) => slowRow(test.title,
    total, maxTest, `${esc(location(test) || test.file || '-')} · ${totalTest ? Math.round(total / totalTest * 100) : 0}% total test`)).join('')}</ol>` : ''}
${slowSteps.length ? `<h3>Langkah terlama</h3><ol class="slow-list">${slowSteps.map(({ step, test }) => slowRow(`${test} / ${step.title}`,
    step.duration, maxStep, esc(location(step.location) || 'lokasi tidak tersedia'))).join('')}</ol>` : ''}
</div>`;

  const list = rows.map((test, i) => `<tr><td class="mono">${i + 1}</td><td>${esc(test.title)}</td>
<td class="mono">${esc(location(test) || test.file || '-')}</td>
<td>${needsAttention(test) ? '<span class="b bad">perlu diperiksa</span>' : '<span class="b ok">sesuai harapan</span>'}</td>
<td class="mono dur"><span class="dur-cell"><span class="dur-bar" style="width:${Math.max(2, Math.round((totals[i].total / maxTotal) * 100))}%"></span><span>${fmtMs(totals[i].total)}</span></span></td></tr>`).join('');
  return diag
    + `<p><strong>${failures.length} entri test perlu diperiksa</strong> / ${rows.length} total.`
    + ` Kegagalan yang diharapkan dan retry tetap terlihat; test flaky tidak dianggap lulus.</p>`
    + `<div class="tbl"><table><thead><tr><th>#</th><th>Test</th><th>Lokasi</th><th>Hasil</th><th>Durasi</th></tr></thead>`
    + `<tbody>${list}</tbody></table></div>`
    + `${data.errors?.length > 0 ? `<h3>Error runner</h3>${data.errors.map(error => errorDetail(error)).join('')}` : ''}`
    + failures.map(testResult).join('')
    + `<details><summary>Entri test lain (${others.length})</summary>${others.map(testResult).join('')}</details>`;
}

const score = value => (typeof value === 'number' ? Math.round(value * 100) + '/100' : 'Tidak dinilai');
export const tone = value => (typeof value !== 'number' ? 'mut2' : value >= 0.9 ? 'ok' : value >= 0.5 ? 'warn' : 'bad');

// Skor kategori dibaca sebagai gauge, bukan teks: satu pandangan cukup.
function scoreRing(label, value) {
  const pct = typeof value === 'number' ? Math.round(value * 100) : null;
  const cls = tone(value);
  const status = pct == null ? 'Tidak dinilai' : pct >= 90 ? 'Baik' : pct >= 50 ? 'Cukup' : 'Perlu perhatian';
  const dash = 138.2;
  return `<li class="score"><svg viewBox="0 0 56 56" role="img" aria-label="${esc(label)} ${pct ?? 'tidak dinilai'}">
<circle class="track" cx="28" cy="28" r="22"></circle>
<circle class="val ${cls}" cx="28" cy="28" r="22" stroke-dasharray="${dash}" stroke-dashoffset="${dash - (dash * (pct ?? 0)) / 100}"></circle>
</svg><b class="num-${cls}">${pct ?? '-'}</b><span>${esc(label)}</span><em class="score-status num-${cls}">${status}</em></li>`;
}

const scoreBadge = value => {
  if (typeof value !== 'number') return '<span class="score-badge muted">-</span>';
  const pct = Math.round(value * 100);
  return `<span class="score-badge ${pct >= 90 ? 'green' : pct >= 50 ? 'orange' : 'red'}">${pct}/100</span>`;
};

const auditSavings = audit => {
  const ms = Number(audit.details?.overallSavingsMs) || 0;
  const bytes = Number(audit.details?.overallSavingsBytes) || 0;
  return [ms ? `hemat ${fmtMs(ms)}` : '', bytes ? `hemat ${fmtBytes(bytes)}` : ''].filter(Boolean).join(' · ');
};

function lighthouseSection(data) {
  const weights = {};
  const auditCat = {};
  Object.entries(data.categories).forEach(([id, category]) => {
    const title = category.title || id;
    (category.auditRefs || []).forEach(ref => {
      weights[ref.id] = Math.max(weights[ref.id] || 0, ref.weight || 0);
      auditCat[ref.id] = auditCat[ref.id] || title;
    });
  });
  const audits = Object.values(data.audits)
    .filter(a => a.scoreDisplayMode === 'error' || a.errorMessage || (typeof a.score === 'number' && a.score < 1))
    .sort((a, b) => Number(Boolean(b.errorMessage || b.scoreDisplayMode === 'error')) - Number(Boolean(a.errorMessage || a.scoreDisplayMode === 'error'))
      || ((1 - (b.score ?? 0)) * (weights[b.id] || 1)) - ((1 - (a.score ?? 0)) * (weights[a.id] || 1)));
  const categories = Object.entries(data.categories)
    .map(([id, c]) => scoreRing(c.title || id, c.score)).join('');
  const causes = audits.slice(0, 5).map(a => `<li class="cause">
<div class="cause-head"><span class="cause-name">${esc(a.title || a.id)}</span>${scoreBadge(a.score)}
<span class="category-tag">${esc(catShort(auditCat[a.id] || 'Lainnya'))}</span>${a.displayValue ? `<span class="cause-value">${esc(a.displayValue)}</span>` : ''}</div>
${a.errorMessage ? `<p class="cause-why" role="alert">${esc(a.errorMessage)}</p>` : (a.explanation || a.description)
    ? `<p class="cause-why">${esc(a.explanation || a.description)}</p>` : ''}</li>`).join('');
  const metricDefs = [['FCP', 'first-contentful-paint'], ['LCP', 'largest-contentful-paint'],
    ['TBT', 'total-blocking-time'], ['CLS', 'cumulative-layout-shift']];
  const metrics = metricDefs.map(([name, id]) => ({ name, audit: data.audits?.[id] }))
    .filter(({ audit }) => audit?.displayValue)
    .map(({ name, audit }) => {
      const status = typeof audit.score !== 'number' ? 'tidak dinilai' : audit.score >= 0.9 ? 'baik' : audit.score >= 0.5 ? 'cukup' : 'perlu perbaikan';
      return `<div class="cwv-card tone-${tone(audit.score)}"><div class="cwv-name">${name}</div>
<div class="cwv-val">${esc(audit.displayValue)}</div><div class="cwv-status">${status}</div></div>`;
    }).join('');
  const warnings = (data.runWarnings || []).map(warning => `<li>${esc(warning)}</li>`).join('');
  const auditRows = audits.map((a, i) => `<tr>
<td class="audit-rank">${i + 1}</td>
<td><span class="category-tag">${esc(catShort(auditCat[a.id] || 'Lainnya'))}</span></td>
<td><strong>${esc(a.title || a.id)}</strong>${a.errorMessage ? ' <span class="b bad">error</span>' : ''}</td>
<td>${scoreBadge(a.score)}</td>
<td class="mono">${[a.displayValue, auditSavings(a)].filter(Boolean).map(esc).join(' · ') || '-'}</td>
<td class="audit-desc">${esc(a.explanation || a.description || '')}
${a.details ? `<details class="audit-more"><summary>Elemen terdampak dan nilai terukur</summary>${pre(a.details)}</details>` : ''}</td></tr>`).join('');
  return `<p class="mono">URL: ${esc(data.finalDisplayedUrl || data.finalUrl || data.requestedUrl)} · diambil: ${esc(data.fetchTime)}</p>`
    + `<h3>Skor kategori</h3><ul class="scores">${categories}</ul>`
    + `${metrics ? `<div class="cwv-grid">${metrics}</div>` : ''}`
    + `<div class="diagnosis"><h3>Kenapa skor segini?</h3>
<p class="diag-note">Penyebab diurutkan dari error runtime, lalu defisit skor × bobot kategori. Audit tanpa bobot dihitung 1.</p>
${causes ? `<ol class="cause-list">${causes}</ol>` : '<p class="empty">Tidak ada audit yang menurunkan skor.</p>'}</div>`
    + `${data.runtimeError ? `<h3>Error runtime</h3>${errorDetail(data.runtimeError)}` : ''}`
    + `${warnings ? `<h3>Peringatan</h3><ul>${warnings}</ul>` : ''}`
    + `<h3>Audit belum penuh (${audits.length})</h3>`
    + `<p>Hasil observasi bukan bukti pasti ada cacat produk. Tabel memuat audit dengan skor di bawah 100 atau error.</p>`
    + `<div class="tbl audits-table-wrap"><table><thead><tr><th>#</th><th>Kategori</th><th>Audit</th><th>Skor</th><th>Nilai / hemat</th><th>Penyebab</th></tr></thead>`
    + `<tbody>${auditRows}</tbody></table></div>`;
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

const sectionBody = (r, run) => (r.kind === 'playwright' ? playwrightSection(run, r.data)
  : r.kind === 'lighthouse' ? lighthouseSection(r.data) : stepSection(r.data));

// Teks polos untuk disalin ke tiket atau dokumen: fakta run + baris gagal saja.
// Dibuat dari data yang sama dengan tabel, jadi tidak bisa berbeda.
export function ringkasTeks(report) {
  const out = [];
  const run = report.run;
  out.push(`Run ${run.id} | ${run.suiteName ?? '-'} | mode ${run.mode ?? '-'} | status ${run.status}`);
  out.push(`Target ${run.targetUrl ?? '-'} | mulai ${fmtWib(run.startedAt)} | selesai ${fmtWib(run.finishedAt)} | exit ${run.exitCode ?? '-'}`);
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

// Satu baris sinyal untuk tabel index: cukup untuk memutuskan halaman mana yang perlu dibuka.
export function runSignal(report) {
  const pw = report.reports?.find(r => r.kind === 'playwright');
  if (pw) {
    const rows = tests(pw.data.suites);
    const total = rows.reduce((sum, test) => sum + testMs(test), 0);
    const slowest = rows.reduce((max, test) => Math.max(max, testMs(test)), 0);
    const failed = rows.filter(needsAttention).length;
    return `${rows.length} test · ${fmtMs(total)}${failed ? ` · ${failed} perlu diperiksa` : ''} · terlama ${fmtMs(slowest)}`;
  }
  const lh = report.reports?.find(r => r.kind === 'lighthouse');
  if (lh) {
    return Object.entries(lh.data.categories)
      .sort((a, b) => (a[1].score ?? 1) - (b[1].score ?? 1))
      .map(([id, c]) => `${catShort(c.title || id)} ${typeof c.score === 'number' ? Math.round(c.score * 100) : '-'}`)
      .join(' · ');
  }
  return report.reports?.length ? `${report.reports.length} sumber JSON` : (report.run?.status ?? '-');
}

function issuePanel(report) {
  const items = [];
  if (report.run?.error) {
    const error = typeof report.run.error === 'string' ? report.run.error : (report.run.error.message || JSON.stringify(report.run.error));
    items.push(`<strong>Error run</strong> · ${esc(error)}`);
  }
  for (const source of report.reports) {
    if (source.kind === 'playwright') {
      for (const test of tests(source.data.suites).filter(needsAttention)) {
        items.push(`<strong>${esc(test.title)}</strong> · ${esc(location(test) || test.file || '-')} · ${esc(test.status || 'gagal')}`);
      }
    } else if (source.kind === 'lighthouse') {
      for (const [id, category] of Object.entries(source.data.categories)) {
        if (typeof category.score === 'number' && category.score < 0.9) {
          items.push(`<strong>Skor ${esc(category.title || id)}</strong> · ${Math.round(category.score * 100)}/100`);
        }
      }
      for (const audit of Object.values(source.data.audits)) {
        if (audit.errorMessage) items.push(`<strong>Audit error</strong> · ${esc(audit.title || audit.id)}`);
      }
    } else if (source.kind === 'steps') {
      for (const test of source.data.tests.filter(t => flattenSteps(t.steps).some(step => step.error)
        || ['failed', 'timedOut', 'interrupted'].includes(t.status))) {
        items.push(`<strong>${esc(test.title)}</strong> · ${esc(test.status)}`);
      }
    }
  }
  if (!report.reports.length) items.push('Tidak ada JSON report yang terbaca. Run tidak dianggap lulus.');
  const unique = [...new Set(items)];
  const head = unique.slice(0, 6).map(item => `<li>${item}</li>`).join('');
  const rest = unique.slice(6);
  return `${head ? `<ul class="issue-list">${head}</ul>` : '<p class="issue-empty">Tidak ada kegagalan atau audit error pada run ini.</p>'}
${rest.length ? `<details><summary>${rest.length} masalah lainnya</summary><ul class="issue-list">${rest.map(item => `<li>${item}</li>`).join('')}</ul></details>` : ''}
<div class="diag-foot"><details><summary>Metadata run</summary>${pre(report.run)}</details></div>`;
}


// report: { run, logs, files, reports, warnings, bundle }
export function runReportHtml(report) {
  const run = report.run;
  const html = report.files.filter(f => /\.html?$/i.test(f));
  const screenshots = report.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const traces = report.files.filter(f => /trace.*\.zip$/i.test(f));
  const archives = report.files.filter(f => /\.(tar\.gz|tgz|zip)$/i.test(f) && !traces.includes(f));
  const download = (path, label) => `<a class="link" href="${esc(artifact(path))}" download>${esc(label ?? path)}</a>`;
  const buka = path => `<a class="link" href="${esc(artifact(path))}" target="_blank" rel="noopener">buka</a>`;
  const fileRow = (path, actions) => `<li class="file-row"><span class="file-name">${esc(path)}</span>
<span class="file-actions">${actions}</span></li>`;
  const fileList = paths => `<ul class="file-list">${paths.map(path => fileRow(path, `${buka(path)}${download(path, 'unduh')}`)).join('')}</ul>`;
  const subCard = (title, body) => `<section class="sub-card"><h3 class="sub-card-title">${title}</h3>${body}</section>`;
  const empty = text => `<p class="empty">${esc(text)}</p>`;
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

  const runTone = run.status === 'passed' ? 'success' : ['failed', 'cancelled', 'interrupted'].includes(run.status) ? 'danger' : 'warn';
  const kpi = tiles([
    ['Status', statusBadge(run.status), `exit ${run.exitCode ?? '-'}`, runTone],
    ['Artifact', String(report.files.length), `${html.length} html · ${screenshots.length} gambar`],
    ['Selesai', esc(fmtWib(run.finishedAt)), 'WIB'],
    ['Peringatan', String(report.warnings.length), report.warnings.length ? 'perlu dibaca' : 'tidak ada', report.warnings.length ? 'warn' : ''],
  ]);

  const body = `${kpi}
${panel('Yang perlu dibenahi', issuePanel(report), '', 'masalah')}
${report.warnings.length > 0 ? panel('Peringatan', `<ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`, '', 'peringatan') : ''}
${report.reports.map(r => panel(`${esc(r.kind === 'steps' ? 'Langkah' : r.kind === 'lighthouse' ? 'Lighthouse' : 'Playwright')} · ${esc(r.path)}`, `${sectionBody(r, run)}
<p class="mut">${download(r.path, 'Unduh JSON sumber')}</p>`)).join('')}
<h2 class="section-title">Lampiran &amp; ekspor</h2>
${panel('Teks ringkas (salin tempel)', `<p>Blok siap salin ke tiket atau dokumen. Tersedia juga sebagai <a href="ringkas.txt" download>ringkas.txt</a>.</p>
<pre id="ringkas">${esc(ringkasTeks(report))}</pre>`, '', 'teks-ringkas')}
${panel('Artifact &amp; ekspor', `<div class="artifacts-grid">
${subCard('Report HTML asli', html.length ? fileList(html) : empty('Tidak ada report HTML asli.'))}
${subCard('Screenshot', screenshots.length ? fileList(screenshots) : empty('Tidak ada screenshot.'))}
${subCard('Bundel artifact', report.bundle
    ? `<a class="btn primary" href="downloads/artifacts.tar.gz" download>Unduh artifacts.tar.gz</a>
<p class="sub-note">Artifact dan log, tanpa source run.json dan symlink.</p>`
    : empty('Bundel tidak tersedia.'))}
${subCard('Arsip report', archives.length ? fileList(archives) : empty('Tidak ada arsip.'))}
${subCard('Trace', traces.length ? fileList(traces) : empty('Tidak ada trace.'))}
</div>
<details><summary>Tampilkan ${report.files.length} artifact</summary>${report.files.length ? fileList(report.files) : empty('Tidak ada artifact.')}</details>
<p class="sub-note">Trace: unduh ZIP lalu jalankan <code>npx playwright show-trace /path/to/trace.zip</code>. Report Playwright offline: <code>npx playwright show-report /path/to/report-folder</code>. Sajikan folder ini lewat HTTP, bukan <code>file://</code>.</p>`, '', 'lampiran')}
${panel('Log runner', `<div class="terminal-log"><div class="terminal-head"><span>logs.txt</span><span>${report.logs ? report.logs.split('\n').length : 0} baris terakhir</span></div>
<details><summary>Tampilkan log runner asli</summary>${pre(report.logs)}</details></div>`, '', 'log-runner')}`;

  return doc({
    title: `${run.suiteName || run.id} · ${run.status}`,
    brand: run.suiteName || run.id,
    sub: `run ${run.id}`,
    actions: `${statusBadge(run.status)}<a class="btn sm" href="ringkas.txt" download>ringkas.txt</a>`,
    hero,
    body,
  });
}

// intro: HTML ringkasan sesi (verdict + identitas) yang dipakai sebagai hero.
export function indexHtml(runs, intro = '') {
  const rows = runs.map(r => `<tr>
<td><a href="${esc(r.slug)}/index.html">${esc(r.suiteName || r.id.slice(0, 8))}</a><div class="mono mut">${esc(r.id.slice(0, 8))}</div></td>
<td><span class="tool ${r.mode === 'lh' ? 'lh' : 'pw'}">${r.mode === 'lh' ? 'Lighthouse' : 'Playwright'}</span></td>
<td>${statusBadge(r.status)}</td>
<td class="mono">${esc(r.targetUrl || '-')}</td>
<td class="mono">${esc(fmtWib(r.finishedAt))}</td>
<td class="signal">${esc(r.signal || '-')}</td>
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
<div class="tbl"><table><thead><tr><th>Run</th><th>Tool</th><th>Status</th><th>Target</th><th>Selesai</th><th>Sinyal</th><th>Teks</th></tr></thead>
<tbody>${rows}</tbody></table></div></div></section>`,
  });
}
