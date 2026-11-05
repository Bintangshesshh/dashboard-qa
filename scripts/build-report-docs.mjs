// Satu folder report sesi: index (daftar run) + satu halaman per run.
// Semua halaman HTML statis tanpa script; artifact disalin, source spec tidak pernah ikut.
// ponytail: render langsung ke outDir, tanpa build tool. Kalau nanti butuh navbar/pencarian,
// baru pertimbangkan generator site statis.
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { runReportHtml, indexHtml, ringkasTeks, runSignal } from './report-html.mjs';

const RUN_KEYS = ['id', 'suiteName', 'targetUrl', 'mode', 'status', 'startedAt', 'finishedAt', 'durationMs', 'exitCode', 'error'];

const slug = value => String(value ?? '').replace(/[^a-zA-Z0-9-]/g, '');

// Baca satu folder run jadi payload report. Source spec tidak pernah ikut.
export async function collectRun(runDir) {
  const source = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  const run = Object.fromEntries(RUN_KEYS.filter(k => k in source).map(k => [k, source[k]]));
  const logs = await readFile(join(runDir, 'logs.txt'), 'utf8').catch(() => '');
  // PRD §9.1: simpan 500 baris terakhir saja; log penuh tetap di dashboard.
  const tail = logs.split('\n').slice(-500).join('\n');
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
  return { runDir, run, logs: tail, files, reports, warnings };
}

async function tarDir(staging, archive) {
  await mkdir(dirname(archive), { recursive: true });
  try {
    await new Promise((done, reject) => {
      const child = spawn('tar', ['-czf', archive, '-C', staging, '.'], { shell: false, stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('error', reject);
      child.on('close', code => (code === 0 ? done() : reject(new Error('tar failed: ' + code))));
    });
    return true;
  } catch {
    await rm(archive, { force: true });
    return false;
  }
}

// Bangun satu folder report berisi semua run. Mengembalikan daftar slug yang dibuat.
// intro: HTML ringkasan sesi yang disisipkan di index (verdict, target, KPI).
export async function buildReportDocs(runDirs, outDir, baseUrl, intro = '') {
  if (!baseUrl?.startsWith('/') || !baseUrl.endsWith('/') || /[?#\\]/.test(baseUrl)) {
    throw new Error('baseUrl harus path absolut yang diakhiri /');
  }
  const collected = [];
  for (const dir of runDirs) {
    try { collected.push(await collectRun(dir)); }
    catch (error) { collected.push({ runDir: dir, error: error.message }); }
  }
  await mkdir(outDir, { recursive: true });
  // Buang output lama supaya halaman/artifact basi tidak tertinggal.
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    await rm(join(outDir, entry.name), { recursive: true, force: true });
  }
  const index = [];
  for (const [i, entry] of collected.entries()) {
    if (!entry.run) {
      // Run yang foldernya sudah dihapus retensi tetap muncul, tanpa halaman detail.
      const name = slug(entry.runDir.split(/[\\/]/).pop()) || 'run-' + i;
      index.push({ id: name, slug: name, suiteName: 'Run dihapus', mode: null, status: 'missing', targetUrl: null, finishedAt: new Date().toISOString() });
      continue;
    }
    const name = slug(entry.run.id) || 'run-' + i;
    const pageDir = join(outDir, name);
    const staging = join(pageDir, 'artifacts');
    await mkdir(staging, { recursive: true });
    for (const path of entry.files) {
      const destination = join(staging, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(entry.runDir, path), destination);
    }
    const bundle = await tarDir(staging, join(pageDir, 'downloads/artifacts.tar.gz'));
    await writeFile(join(pageDir, 'index.html'),
      runReportHtml({ run: entry.run, logs: entry.logs, files: entry.files, reports: entry.reports, warnings: entry.warnings, bundle }));
    // Teks polos siap salin; satu sumber dengan tabel di index.html.
    await writeFile(join(pageDir, 'ringkas.txt'), ringkasTeks(entry) + '\n');
    index.push({
      id: entry.run.id, slug: name, suiteName: entry.run.suiteName ?? null,
      mode: entry.run.mode ?? null, status: entry.run.status ?? null,
      targetUrl: entry.run.targetUrl ?? null, finishedAt: entry.run.finishedAt ?? null,
      signal: runSignal(entry),
    });
  }
  await writeFile(join(outDir, 'index.html'), indexHtml(index, intro));
  return index;
}

