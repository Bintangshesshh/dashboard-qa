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
  const message = error.message || error.value || (typeof error === 'string' ? error : 'Unknown error');
  return `<p><strong>${esc(location(error.location || at) || 'Location unavailable')}</strong></p>${pre(message)}`
    + `${error.snippet ? pre(error.snippet) : ''}`
    + `${error.stack ? `<details><summary>Stack trace</summary>${pre(error.stack)}</details>` : ''}`;
}

const failedSteps = steps => flattenSteps(steps).filter(step => step.error)
  .map(step => `<div><h4>Failed step: ${esc(step.title)}</h4>${errorDetail(step.error, step.location)}</div>`).join('');

const needsAttention = test => test.status === 'unexpected' || test.status === 'flaky'
  || (test.results || []).some(r => ['failed', 'timedOut', 'interrupted'].includes(r.status));

function testResult(test) {
  const attempts = (test.results || []).map((result, j) => {
    const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
    return `<div><h4>Attempt ${(result.retry ?? j) + 1}: ${esc(result.status)} (${esc(result.duration)} ms)</h4>`
      + errors.map(error => errorDetail(error, test)).join('')
      + failedSteps(result.steps)
      + `${result.attachments?.length > 0 ? `<details><summary>Attachment metadata</summary>${pre(result.attachments)}</details>` : ''}</div>`;
  }).join('');
  return `<article><h3>${esc(test.title)}</h3><p>${esc(location(test))} - project: ${esc(test.projectName || 'unknown')}`
    + ` - expected: ${esc(test.expectedStatus || 'unknown')} - outcome: ${esc(test.status || 'unknown')}</p>${attempts}</article>`;
}

function playwrightSection(data) {
  const rows = tests(data.suites);
  const failures = rows.filter(needsAttention);
  const others = rows.filter(test => !needsAttention(test));
  return `<p><strong>${failures.length} test entries need attention</strong> / ${rows.length} total.`
    + ` Expected failures and retries remain visible; flaky tests are not silently passed.</p>`
    + `${data.errors?.length > 0 ? `<h3>Runner errors</h3>${data.errors.map(error => errorDetail(error)).join('')}` : ''}`
    + failures.map(testResult).join('')
    + `<details><summary>Other test entries (${others.length})</summary>${others.map(testResult).join('')}</details>`;
}

const score = value => (typeof value === 'number' ? Math.round(value * 100) + '/100' : 'Not scored');

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
  return `<p>URL: ${esc(data.finalDisplayedUrl || data.finalUrl || data.requestedUrl)} - fetched: ${esc(data.fetchTime)}</p>`
    + `<ul class="plain">${categories}</ul>`
    + `${data.runtimeError ? `<h3>Runtime error</h3>${errorDetail(data.runtimeError)}` : ''}`
    + `${warnings ? `<ul>${warnings}</ul>` : ''}`
    + `<h3>Prioritized audit failures (${audits.length})</h3>`
    + `<p>Runtime audit errors first, then score deficit × category weight (unweighted audits use 1).`
    + ` Observed results are not proof of a product defect.</p>`
    + audits.map((a, i) => `<article><h4>${i + 1}. ${esc(a.title || a.id)}</h4>`
      + `<p><strong>${esc(score(a.score))}</strong>${a.displayValue ? ' - ' + esc(a.displayValue) : ''}</p>`
      + `${a.errorMessage ? `<p role="alert">${esc(a.errorMessage)}</p>` : ''}`
      + `${a.explanation ? `<p>${esc(a.explanation)}</p>` : ''}`
      + `${a.description ? `<p>${esc(a.description)}</p>` : ''}`
      + `${a.details ? `<details><summary>Affected elements and measured values</summary>${pre(a.details)}</details>` : ''}`
      + `</article>`).join('');
}

function stepSection(data) {
  const failed = data.tests.filter(test => flattenSteps(test.steps).some(step => step.error)
    || ['failed', 'timedOut', 'interrupted'].includes(test.status));
  return `<p>${failed.length} attempts need attention / ${data.tests.length} recorded attempts.</p>`
    + failed.map(test => `<article><h3>${esc(test.title)} - ${esc(test.status)}</h3>`
      + `<p>${esc(location(test.location || test))} - project: ${esc(test.projectName || 'unknown')}`
      + ` - attempt ${(test.retry || 0) + 1}</p>${failedSteps(test.steps)}</article>`).join('')
    + `<details><summary>All recorded steps</summary>${pre(data.tests)}</details>`;
}

const sectionBody = r => (r.kind === 'playwright' ? playwrightSection(r.data)
  : r.kind === 'lighthouse' ? lighthouseSection(r.data) : stepSection(r.data));

// report: { run, logs, files, reports, warnings, bundle }
export function runReportHtml(report) {
  const html = report.files.filter(f => /\.html?$/i.test(f));
  const screenshots = report.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const traces = report.files.filter(f => /trace.*\.zip$/i.test(f));
  const archives = report.files.filter(f => /\.(tar\.gz|tgz|zip)$/i.test(f) && !traces.includes(f));
  const download = (path, label) => `<a href="${esc(artifact(path))}" download>${esc(label ?? path)}</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Run report</title><style>${css}</style></head><body><main>
<h1>Run report</h1><p>Observed run facts only. Missing artifacts do not imply success. Report metadata and logs are snapshots taken before documentation build completed.</p>
<h2>Failure-first summary</h2><p><strong>${esc(report.run.suiteName || report.run.id)}: ${esc(report.run.status)}</strong> - target: ${esc(report.run.targetUrl || 'unknown')}</p>
${report.run.error ? errorDetail(report.run.error) : ''}<details><summary>Run metadata</summary>${pre(report.run)}</details>
${report.warnings.length > 0 ? `<h2>Warnings</h2><ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
${report.reports.map(r => `<section><h2>${esc(r.kind)}: ${esc(r.path)}</h2>${sectionBody(r)}<p>${download(r.path, 'Download source JSON')}</p></section>`).join('')}
<h2>Native HTML report downloads</h2><p>Native reports are downloads for offline viewing. This site is sandboxed; interactive native viewers may not work here. Download complete report folder with data assets.</p>
${html.length ? `<ul>${html.map(f => `<li>${download(f, 'Download ' + f)}</li>`).join('')}</ul>` : '<p>No native HTML report found.</p>'}
<h2>Screenshots</h2>${screenshots.length ? screenshots.map(f => `<figure>${download(f, 'Download screenshot: ' + f)}</figure>`).join('') : '<p>No screenshot found.</p>'}
<h2>Artifact bundle</h2>${report.bundle
    ? '<p><a href="downloads/artifacts.tar.gz" download>Download artifacts.tar.gz</a> - artifacts and logs, excluding source run.json and symlinks.</p>'
    : '<p>Bundle unavailable. Download individual artifacts below.</p>'}
<h2>Report archive downloads</h2><p>Archives supplied by runner appear below. Download report folder contents from All artifacts when needed.</p>
<ul>${archives.map(f => `<li>${download(f, 'Download ' + f)}</li>`).join('')}</ul>
<h2>Traces and offline viewing</h2><ul>${traces.map(f => `<li>${download(f)}</li>`).join('')}</ul>
<p>Download trace ZIP, then run <code>npx playwright show-trace /path/to/trace.zip</code> on a machine with Playwright installed. Viewer runs locally; do not upload private traces to third-party services. Trace ZIP alone is not an HTML page.</p>
<p>For offline native Playwright reports, download the complete HTML report folder, including its data directory, then run <code>npx playwright show-report /path/to/report-folder</code>. Lighthouse HTML reports can be opened locally. Serve this complete docs directory over HTTP at its configured base path; opening index.html via file:// is not supported.</p>
<h2>Runner logs</h2><details><summary>Show native runner logs</summary>${pre(report.logs)}</details>
<h2>All artifacts</h2><ul>${report.files.map(f => `<li>${download(f)}</li>`).join('')}</ul>
</main></body></html>`;
}

export function indexHtml(runs) {
  const rows = runs.map(r => `<tr>
<td><a href="${esc(r.slug)}/">${esc(r.suiteName || r.id.slice(0, 8))}</a></td>
<td>${r.mode === 'lh' ? 'Lighthouse' : 'Playwright'}</td>
<td>${esc(r.status)}</td><td>${esc(r.targetUrl || '-')}</td><td>${esc(r.finishedAt || '-')}</td></tr>`).join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Laporan run</title><style>${css}</style></head><body><main>
<h1>Laporan run</h1>
<p>Ringkasan per run. Setiap halaman memuat fakta run apa adanya; artifact yang hilang bukan berarti lulus.</p>
<table><thead><tr><th>Run</th><th>Tool</th><th>Status</th><th>Target</th><th>Selesai</th></tr></thead>
<tbody>${rows}</tbody></table>
</main></body></html>`;
}

