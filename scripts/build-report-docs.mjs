// Tahap 5: satu site Docusaurus untuk banyak run (report sesi).
// Halaman: index (daftar run) + satu halaman per run, memakai komponen
// docusaurus/run-report-page.jsx yang sudah diuji di scripts/test-run-docs.mjs.
// ponytail: satu site per report, dibangun sinkron di background chain server.
// Kalau build jadi lebih berat, pindah ke worker terpisah.
import { readdir, readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_KEYS = ['id', 'suiteName', 'targetUrl', 'mode', 'status', 'startedAt', 'finishedAt', 'exitCode', 'error'];

const slug = value => String(value ?? '').replace(/[^a-zA-Z0-9-]/g, '');

// Baca satu folder run jadi payload report. Source spec tidak pernah ikut.
export async function collectRun(runDir) {
  const source = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  const run = Object.fromEntries(RUN_KEYS.filter(k => k in source).map(k => [k, source[k]]));
  const logs = await readFile(join(runDir, 'logs.txt'), 'utf8').catch(() => '');
  const files = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (dir === runDir && entry.name !== 'artifacts' && entry.name !== 'logs.txt') continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relative(runDir, path).replaceAll('\\', '/'));
    }
  };
  await walk(runDir);
  const reports = [];
  const warnings = [];
  for (const path of files.filter(p => p.endsWith('.json') && p !== 'run.json')) {
    try {
      const data = JSON.parse(await readFile(join(runDir, path), 'utf8'));
      if (Array.isArray(data.suites)) reports.push({ kind: 'playwright', path, data });
      else if (data.audits && data.categories) reports.push({ kind: 'lighthouse', path, data });
      else if (Array.isArray(data.tests) && data.tests.some(t => Array.isArray(t.steps))) reports.push({ kind: 'steps', path, data });
    } catch (error) { warnings.push(path + ': ' + error.message); }
  }
  if (run.mode !== 'lh' && !reports.some(r => r.kind === 'playwright')) warnings.push('No Playwright JSON report found. Missing report does not mean tests passed.');
  if (run.mode !== 'pw' && !reports.some(r => r.kind === 'lighthouse')) warnings.push('No Lighthouse JSON report found. Missing report does not mean audits passed.');
  return { runDir, run, logs, files, reports, warnings };
}

const indexPage = runs => `import React from 'react';
import Layout from '@theme/Layout';
const runs = ${JSON.stringify(runs, null, 2)};
export default function Index() {
  return <Layout title="Laporan run"><main style={{maxWidth: 1100, margin: '2rem auto', padding: '0 1rem'}}>
    <h1>Laporan run</h1>
    <p>Ringkasan per run. Setiap halaman memuat fakta run apa adanya; artifact yang hilang bukan berarti lulus.</p>
    <table style={{width: '100%', borderCollapse: 'collapse'}}>
      <thead><tr><th align="left">Run</th><th align="left">Tool</th><th align="left">Status</th><th align="left">Target</th><th align="left">Selesai</th></tr></thead>
      <tbody>{runs.map(r => <tr key={r.id}>
        <td><a href={r.slug + '/'}>{r.suiteName || r.id.slice(0, 8)}</a></td>
        <td>{r.mode === 'lh' ? 'Lighthouse' : 'Playwright'}</td>
        <td>{r.status}</td>
        <td>{r.targetUrl || '—'}</td>
        <td>{r.finishedAt || '—'}</td>
      </tr>)}</tbody>
    </table>
  </main></Layout>;
}
`;

// Ganti import report.json bawaan komponen dengan data run milik halaman ini.
const runPage = (source, slugName) => source.replace(
  /import report from '\.\/report\.json';/,
  `import report from '../data/${slugName}.json';`,
);

// Inline CSS + buang script supaya report tetap jalan di iframe ber-sandbox.
async function finalizeHtml(file, docsDir, baseUrl) {
  let html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(match[0])?.[1];
    if (!href?.startsWith(baseUrl + 'assets/css/')) continue;
    const cssPath = resolve(docsDir, href.slice(baseUrl.length));
    if (!cssPath.startsWith(resolve(docsDir, 'assets/css') + sep)) throw new Error('Invalid report stylesheet path');
    const css = await readFile(cssPath, 'utf8');
    html = html.replace(match[0], () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>');
  }
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  await writeFile(file, html);
}

async function tarDir(staging, archive) {
  await mkdir(dirname(archive), { recursive: true });
  try {
    await new Promise((done, reject) => {
      const child = spawn('tar', ['-czf', archive, '-C', staging, '.'], { shell: false, stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('error', reject);
      child.on('close', code => code === 0 ? done() : reject(new Error('tar failed: ' + code)));
    });
    return true;
  } catch {
    await rm(archive, { force: true });
    return false;
  }
}

// Bangun satu site berisi semua run. Mengembalikan daftar slug yang dibuat.
export async function buildReportDocs(runDirs, outDir, baseUrl) {
  if (!baseUrl?.startsWith('/') || !baseUrl.endsWith('/') || /[?#\\]/.test(baseUrl)) {
    throw new Error('baseUrl harus path absolut yang diakhiri /');
  }
  const collected = [];
  for (const dir of runDirs) {
    try { collected.push(await collectRun(dir)); }
    catch (error) { collected.push({ runDir: dir, error: error.message }); }
  }
  const site = await mkdtemp(join(root, 'docusaurus', '.run-site-'));
  try {
    await mkdir(join(site, 'src', 'pages'), { recursive: true });
    await mkdir(join(site, 'src', 'data'), { recursive: true });
    await writeFile(join(site, 'package.json'), JSON.stringify({ private: true, browserslist: ['>0.5%', 'not dead', 'not op_mini all'] }));
    await writeFile(join(site, 'docusaurus.config.js'), 'module.exports = ' + JSON.stringify({
      title: 'Laporan run', url: 'http://localhost', baseUrl, trailingSlash: true, onBrokenLinks: 'throw',
      presets: [[resolve(root, 'docusaurus/node_modules/@docusaurus/preset-classic'), { docs: false, blog: false }]],
      themeConfig: { navbar: { title: 'Laporan run' }, colorMode: { defaultMode: 'light' } },
    }));
    const viewSource = await readFile(join(root, 'docusaurus/run-report-page.jsx'), 'utf8');

    const index = [];
    for (const [i, entry] of collected.entries()) {
      const name = slug(entry.run?.id) || 'run-' + i;
      const staging = join(site, 'static', name, 'artifacts');
      let bundle = false;
      if (entry.run) {
        for (const path of entry.files) {
          const destination = join(staging, path);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(join(entry.runDir, path), destination);
        }
        bundle = await tarDir(staging, join(site, 'static', name, 'downloads/artifacts.tar.gz'));
        await writeFile(join(site, 'src', 'data', name + '.json'), JSON.stringify({
          run: entry.run, logs: entry.logs, files: entry.files,
          reports: entry.reports, warnings: entry.warnings, bundle,
        }));
        await writeFile(join(site, 'src', 'pages', name + '.jsx'), runPage(viewSource, name));
        index.push({
          id: entry.run.id, slug: name, suiteName: entry.run.suiteName ?? null,
          mode: entry.run.mode ?? null, status: entry.run.status ?? null,
          targetUrl: entry.run.targetUrl ?? null, finishedAt: entry.run.finishedAt ?? null,
        });
      } else {
        // Run yang foldernya sudah dihapus retensi tetap muncul, tanpa halaman detail.
        index.push({ id: name, slug: name, suiteName: 'Run dihapus', mode: null, status: 'missing', targetUrl: null, finishedAt: null });
      }
    }
    await writeFile(join(site, 'src', 'pages', 'index.jsx'), indexPage(index));

    await new Promise((resolveBuild, reject) => {
      const child = spawn(process.execPath, [join(root, 'docusaurus/node_modules/@docusaurus/core/bin/docusaurus.mjs'), 'build', site, '--out-dir', outDir], {
        cwd: join(root, 'docusaurus'), stdio: ['ignore', 'ignore', 'pipe'],
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => code === 0 ? resolveBuild() : reject(new Error('Docusaurus build failed: ' + (signal || code))));
    });

    const pages = [join(outDir, 'index.html')];
    for (const entry of index) {
      const page = join(outDir, entry.slug, 'index.html');
      if (entry.status !== 'missing') pages.push(page);
    }
    for (const page of pages) await finalizeHtml(page, outDir, baseUrl).catch(() => {});
    return index;
  } finally {
    await rm(site, { recursive: true, force: true }).catch(() => {});
  }
}
