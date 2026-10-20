import React from 'react';
import Layout from '@theme/Layout';
import report from './report.json';

const pretty = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const Pre = ({value}) => <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 600, overflow: 'auto'}}>{pretty(value)}</pre>;
const artifact = path => 'artifacts/' + path.split('/').map(encodeURIComponent).join('/');
const flattenSteps = (steps = []) => steps.flatMap(step => [step, ...flattenSteps(step.steps)]);
function tests(suites = [], parents = []) {
  return suites.flatMap(suite => [
    ...(suite.specs || []).flatMap(spec => (spec.tests || []).map(test => ({...test, title: [...parents, suite.title, spec.title].filter(Boolean).join(' / '), file: spec.file, line: spec.line}))),
    ...tests(suite.suites, [...parents, suite.title]),
  ]);
}
const location = value => value?.file ? [value.file, value.line, value.column].filter(v => v != null).join(':') : null;
function ErrorDetail({error, at}) {
  if (!error) return null;
  return <><p><strong>{location(error.location || at) || 'Location unavailable'}</strong></p><Pre value={error.message || error.value || (typeof error === 'string' ? error : 'Unknown error')}/>{error.snippet && <Pre value={error.snippet}/>} {error.stack && <details><summary>Stack trace</summary><Pre value={error.stack}/></details>}</>;
}
function FailedSteps({steps}) {
  return flattenSteps(steps).filter(step => step.error).map((step, i) => <div key={i}><h4>Failed step: {step.title}</h4><ErrorDetail error={step.error} at={step.location}/></div>);
}
const needsAttention = test => test.status === 'unexpected' || test.status === 'flaky' || (test.results || []).some(r => ['failed', 'timedOut', 'interrupted'].includes(r.status));
function TestResult({test}) {
  return <article><h3>{test.title}</h3><p>{location(test)} — project: {test.projectName || 'unknown'} — expected: {test.expectedStatus || 'unknown'} — outcome: {test.status || 'unknown'}</p>
    {(test.results || []).map((result, j) => <div key={j}><h4>Attempt {(result.retry ?? j) + 1}: {result.status} ({result.duration} ms)</h4>
      {(result.errors?.length ? result.errors : result.error ? [result.error] : []).map((error, k) => <ErrorDetail key={k} error={error} at={test}/>)}
      <FailedSteps steps={result.steps}/>
      {result.attachments?.length > 0 && <details><summary>Attachment metadata</summary><Pre value={result.attachments}/></details>}
    </div>)}
  </article>;
}
function Playwright({data}) {
  const rows = tests(data.suites);
  const failures = rows.filter(needsAttention);
  return <><p><strong>{failures.length} test entries need attention</strong> / {rows.length} total. Expected failures and retries remain visible; flaky tests are not silently passed.</p>
    {data.errors?.length > 0 && <><h3>Runner errors</h3>{data.errors.map((error, i) => <ErrorDetail key={i} error={error}/>)}</>}
    {failures.map((test, i) => <TestResult key={i} test={test}/>)}
    <details><summary>Other test entries ({rows.length - failures.length})</summary>{rows.filter(test => !needsAttention(test)).map((test, i) => <TestResult key={i} test={test}/>)}</details>
  </>;
}
const score = value => typeof value === 'number' ? Math.round(value * 100) + '/100' : 'Not scored';
function Lighthouse({data}) {
  const weights = {};
  Object.values(data.categories).forEach(category => (category.auditRefs || []).forEach(ref => { weights[ref.id] = Math.max(weights[ref.id] || 0, ref.weight || 0); }));
  const audits = Object.values(data.audits).filter(a => a.scoreDisplayMode === 'error' || a.errorMessage || (typeof a.score === 'number' && a.score < 1))
    .sort((a, b) => Number(Boolean(b.errorMessage || b.scoreDisplayMode === 'error')) - Number(Boolean(a.errorMessage || a.scoreDisplayMode === 'error')) || ((1 - (b.score ?? 0)) * (weights[b.id] || 1)) - ((1 - (a.score ?? 0)) * (weights[a.id] || 1)));
  return <><p>URL: {data.finalDisplayedUrl || data.finalUrl || data.requestedUrl} — fetched: {data.fetchTime}</p>
    <ul style={{display: 'flex', flexWrap: 'wrap', gap: '1.5rem', listStyle: 'none', padding: 0}}>{Object.entries(data.categories).map(([id, c]) => <li key={id}><strong>{c.title || id}: {score(c.score)}</strong></li>)}</ul>
    {data.runtimeError && <><h3>Runtime error</h3><ErrorDetail error={data.runtimeError}/></>}
    {data.runWarnings?.length > 0 && <ul>{data.runWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
    <h3>Prioritized audit failures ({audits.length})</h3><p>Runtime audit errors first, then score deficit × category weight (unweighted audits use 1). Observed results are not proof of a product defect.</p>
    {audits.map((a, i) => <article key={a.id || i}><h4>{i + 1}. {a.title || a.id}</h4><p><strong>{score(a.score)}</strong>{a.displayValue ? ' — ' + a.displayValue : ''}</p>{a.errorMessage && <p role="alert">{a.errorMessage}</p>}{a.explanation && <p>{a.explanation}</p>}{a.description && <p>{a.description}</p>}{a.details && <details><summary>Affected elements and measured values</summary><Pre value={a.details}/></details>}</article>)}
  </>;
}
function StepReport({data}) {
  const failed = data.tests.filter(test => flattenSteps(test.steps).some(step => step.error) || ['failed', 'timedOut', 'interrupted'].includes(test.status));
  return <><p>{failed.length} attempts need attention / {data.tests.length} recorded attempts.</p>{failed.map((test, i) => <article key={i}><h3>{test.title} — {test.status}</h3><p>{location(test.location || test)} — project: {test.projectName || 'unknown'} — attempt {(test.retry || 0) + 1}</p><FailedSteps steps={test.steps}/></article>)}<details><summary>All recorded steps</summary><Pre value={data.tests}/></details></>;
}
export default function RunReport() {
  const html = report.files.filter(f => /\.html?$/i.test(f));
  const screenshots = report.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const traces = report.files.filter(f => /trace.*\.zip$/i.test(f));
  return <Layout title="Run report"><main style={{maxWidth: 1100, margin: '2rem auto', padding: '0 1rem'}}>
    <h1>Run report</h1><p>Observed run facts only. Missing artifacts do not imply success. Report metadata and logs are snapshots taken before documentation build completed.</p>
    <h2>Failure-first summary</h2><p><strong>{report.run.suiteName || report.run.id}: {report.run.status}</strong> — target: {report.run.targetUrl || 'unknown'}</p>{report.run.error && <ErrorDetail error={report.run.error}/>}<details><summary>Run metadata</summary><Pre value={report.run}/></details>
    {report.warnings.length > 0 && <><h2>Warnings</h2><ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
    {report.reports.map((r, i) => <section key={i}><h2>{r.kind}: {r.path}</h2>
      {r.kind === 'playwright' ? <Playwright data={r.data}/> : r.kind === 'lighthouse' ? <Lighthouse data={r.data}/> : <StepReport data={r.data}/>}
      <p><a href={artifact(r.path)} download>Download source JSON</a></p>
    </section>)}
    <h2>Native HTML report downloads</h2><p>Native reports are downloads for offline viewing. This site is sandboxed; interactive native viewers may not work here. Download complete report folder with data assets.</p>{html.length ? <ul>{html.map(f => <li key={f}><a href={artifact(f)} download>Download {f}</a></li>)}</ul> : <p>No native HTML report found.</p>}
    <h2>Screenshots</h2>{screenshots.length ? screenshots.map(f => <figure key={f}><a href={artifact(f)} download>Download screenshot: {f}</a></figure>) : <p>No screenshot found.</p>}
    <h2>Artifact bundle</h2>{report.bundle ? <p><a href="downloads/artifacts.tar.gz" download>Download artifacts.tar.gz</a> — artifacts and logs, excluding source run.json and symlinks.</p> : <p>Bundle unavailable. Download individual artifacts below.</p>}
    <h2>Report archive downloads</h2><p>Archives supplied by runner appear below. Download report folder contents from All artifacts when needed.</p><ul>{report.files.filter(f => /\.(tar\.gz|tgz|zip)$/i.test(f) && !traces.includes(f)).map(f => <li key={f}><a href={artifact(f)} download>Download {f}</a></li>)}</ul>
    <h2>Traces and offline viewing</h2><ul>{traces.map(f => <li key={f}><a href={artifact(f)} download>{f}</a></li>)}</ul>
    <p>Download trace ZIP, then run <code>npx playwright show-trace /path/to/trace.zip</code> on a machine with Playwright installed. Viewer runs locally; do not upload private traces to third-party services. Trace ZIP alone is not an HTML page.</p>
    <p>For offline native Playwright reports, download the complete HTML report folder, including its data directory, then run <code>npx playwright show-report /path/to/report-folder</code>. Lighthouse HTML reports can be opened locally. Serve this complete docs directory over HTTP at its configured base path; opening index.html via file:// is not supported.</p>
    <h2>Runner logs</h2><details><summary>Show native runner logs</summary><Pre value={report.logs}/></details>
    <h2>All artifacts</h2><ul>{report.files.map(f => <li key={f}><a href={artifact(f)} download>{f}</a></li>)}</ul>
  </main></Layout>;
}
