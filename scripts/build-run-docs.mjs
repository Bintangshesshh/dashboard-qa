import {readdir, readFile, writeFile, mkdir, mkdtemp, rm, copyFile} from 'node:fs/promises';
import {dirname, join, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runDir = process.argv[2] && resolve(process.argv[2]);
if (!runDir) throw new Error('Usage: node scripts/build-run-docs.mjs <runDir>');
const sourceRun = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
// Cases contain source snapshots; never publish them into static reports.
const run = Object.fromEntries(['id', 'suiteId', 'suiteName', 'targetUrl', 'mode', 'headed', 'status', 'startedAt', 'finishedAt', 'exitCode', 'error'].filter(key => key in sourceRun).map(key => [key, sourceRun[key]]));
const logs = await readFile(join(runDir, 'logs.txt'), 'utf8');
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (dir === runDir && entry.name !== 'artifacts' && entry.name !== 'logs.txt') continue;
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(relative(runDir, path).replaceAll('\\', '/'));
  }
}
await walk(runDir);
const reports = [];
const warnings = [];
for (const path of files.filter(p => p.endsWith('.json') && p !== 'run.json')) {
  try {
    const data = JSON.parse(await readFile(join(runDir, path), 'utf8'));
    if (Array.isArray(data.suites)) reports.push({kind: 'playwright', path, data});
    else if (data.audits && data.categories) reports.push({kind: 'lighthouse', path, data});
    else if (Array.isArray(data.tests) && data.tests.some(t => Array.isArray(t.steps))) reports.push({kind: 'steps', path, data});
  } catch (error) { warnings.push(path + ': ' + error.message); }
}
if (run.mode !== 'lh' && !reports.some(r => r.kind === 'playwright')) warnings.push('No Playwright JSON report found. Missing report does not mean tests passed.');
if (run.mode !== 'pw' && !reports.some(r => r.kind === 'lighthouse')) warnings.push('No Lighthouse JSON report found. Missing report does not mean audits passed.');
const baseUrl = process.env.REPORT_BASE_URL || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.id || '') ? '/reports/' + run.id + '/docs/' : '/');
if (!baseUrl.startsWith('/') || !baseUrl.endsWith('/') || /[?#\\]/.test(baseUrl)) throw new Error('REPORT_BASE_URL must be an absolute URL path ending with /');
const site = await mkdtemp(join(root, 'docusaurus', '.run-site-'));
try {
  await mkdir(join(site, 'src', 'pages'), {recursive: true});
  await writeFile(join(site, 'package.json'), JSON.stringify({private: true, browserslist: ['>0.5%', 'not dead', 'not op_mini all']}));
  await writeFile(join(site, 'docusaurus.config.js'), 'module.exports = ' + JSON.stringify({title: 'Run report', url: 'http://localhost', baseUrl, trailingSlash: true, onBrokenLinks: 'throw', presets: [[resolve(root, 'docusaurus/node_modules/@docusaurus/preset-classic'), {docs: false, blog: false}]], themeConfig: {navbar: {title: 'Run report'}, colorMode: {defaultMode: 'light'}}}));
  await copyFile(join(root, 'docusaurus/run-report-page.jsx'), join(site, 'src/pages/index.jsx'));
  // Copy only enumerated regular files; tar never walks the original run tree.
  const staging = join(site, 'static/artifacts');
  for (const path of files) {
    const destination = join(staging, path);
    await mkdir(dirname(destination), {recursive: true});
    await copyFile(join(runDir, path), destination);
  }
  const archive = join(site, 'static/downloads/artifacts.tar.gz');
  await mkdir(dirname(archive), {recursive: true});
  let bundle = false;
  try {
    await new Promise((done, reject) => {
      const child = spawn('tar', ['-czf', archive, '-C', staging, '.'], {shell: false, stdio: ['ignore', process.stdout, process.stderr]});
      child.on('error', reject);
      child.on('close', (code, signal) => code === 0 ? done() : reject(new Error('tar failed: ' + (signal || code))));
    });
    bundle = true;
  } catch (error) {
    await rm(archive, {force: true});
    warnings.push('Artifact bundle unavailable: ' + error.message + '. Download individual artifacts instead.');
  }
  await writeFile(join(site, 'src/pages/report.json'), JSON.stringify({run, logs, files, reports, warnings, bundle}));
  console.log('Building Docusaurus report for ' + runDir);
  await new Promise((resolveBuild, reject) => {
    const child = spawn(process.execPath, [join(root, 'docusaurus/node_modules/@docusaurus/core/bin/docusaurus.mjs'), 'build', site, '--out-dir', join(runDir, 'docs')], {cwd: join(root, 'docusaurus'), stdio: ['ignore', process.stdout, process.stdout]});
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolveBuild() : reject(new Error('Docusaurus build failed: ' + (signal || code))));
  });
  // ponytail: read-only SSR report; use a separate report origin before adding client interactivity.
  // Opaque sandbox documents cannot send SameSite cookies for CSS/JS subrequests.
  const indexPath = join(runDir, 'docs/index.html');
  let html = await readFile(indexPath, 'utf8');
  for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(match[0])?.[1];
    if (!href?.startsWith(baseUrl + 'assets/css/')) throw new Error('Unexpected report stylesheet: ' + href);
    const cssPath = resolve(runDir, 'docs', href.slice(baseUrl.length));
    if (!cssPath.startsWith(resolve(runDir, 'docs/assets/css') + sep)) throw new Error('Invalid report stylesheet path');
    const css = await readFile(cssPath, 'utf8');
    html = html.replace(match[0], () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>');
  }
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  await writeFile(indexPath, html);
  console.log('Report ready: ' + join(runDir, 'docs'));
} finally {
  await rm(site, {recursive: true, force: true});
}
