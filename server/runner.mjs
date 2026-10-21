import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, appendFile, readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'package.json'));

export async function filesBelow(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await filesBelow(p, base));
    else if (entry.isFile()) files.push(relative(base, p).replaceAll('\\', '/'));
  }
  return files;
}

export class Runner extends EventEmitter {
  constructor(store, { runsDir = resolve(root, '.runs'), origins = [], timeout = 300000 } = {}) {
    super();
    Object.assign(this, { store, runsDir, origins, timeout });
    this.active = null;
  }

  directory(runId) { return join(this.runsDir, runId); }

  async start(runId, testFile) {
    if (this.active) throw Object.assign(new Error('Another run is active'), { status: 409 });
    const state = { runId, testFile, seq: 0, chain: Promise.resolve(), child: null, cancelled: false };
    this.active = state;
    state.done = this.execute(state).finally(() => { this.active = null; });
    return state.done;
  }

  async cancel(runId) {
    if (!this.active || this.active.runId !== runId) return false;
    this.active.cancelled = true;
    if (this.active.child) this.active.child.kill('SIGTERM');
    return true;
  }

  async log(state, stream, text) {
    const entry = { seq: ++state.seq, stream, text: String(text), at: new Date().toISOString() };
    state.chain = state.chain.then(async () => {
      await this.store.log(state.runId, entry);
      await appendFile(join(this.directory(state.runId), 'logs.txt'), entry.text);
      this.emit('log', { type: 'log', runId: state.runId, ...entry });
    });
    return state.chain;
  }

  async status(patch) {
    this.emit('status', { type: 'status', runId: this.active?.runId, run: await this.store.patchRun(this.active?.runId, patch) });
  }

  async execute(state) {
    const { runId, testFile } = state;
    const dir = this.directory(runId);
    await mkdir(dir, { recursive: true });
    await this.store.patchRun(runId, { status: 'running', started_at: new Date().toISOString() });
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });

    const started = Date.now();
    try {
      if (testFile.tool === 'pw') {
        await this.runPlaywright(state);
      } else {
        await this.runLighthouse(state);
      }
      if (state.cancelled) {
        await this.store.patchRun(runId, { status: 'cancelled', finished_at: new Date().toISOString(), duration_ms: Date.now() - started });
      }
    } catch (error) {
      await this.log(state, 'stderr', `${error.message}\n`);
      await this.store.patchRun(runId, { status: 'failed', error: error.message, finished_at: new Date().toISOString(), duration_ms: Date.now() - started });
    }
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
  }

  // Jalankan satu spec Playwright langsung (fase 1: CLI lokal menjalankan).
  async runPlaywright(state) {
    const { runId, testFile } = state;
    const dir = this.directory(runId);
    const targetUrl = null; // diisi oleh CLI/API pada fase selanjutnya; untuk saat ini hardcode dari test_file code
    await this.log(state, 'system', `[runner] Menjalankan Playwright ${testFile.path}\n`);
    const specPath = join(root, testFile.path);
    const env = { ...process.env };
    const args = ['playwright', 'test', specPath, '--reporter=json', `--output=${join(dir, 'artifacts')}`];
    const child = spawn('npx', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => child.on('close', res));
    state.child = null;
    await state.chain;

    // Parse hasil JSON Playwright → playwright_results
    const results = await this.parsePlaywright(dir);
    const status = state.cancelled ? 'cancelled' : code === 0 && results.every(r => r.status === 'passed') ? 'passed' : 'failed';
    await this.store.patchRun(runId, {
      status,
      finished_at: new Date().toISOString(),
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
    });
    if (results.length) await this.store.addPlaywrightResults(runId, results);
    await this.collectArtifacts(runId, dir);
    await this.store.patchRun(runId, { finalized_at: new Date().toISOString() });
  }

  async runLighthouse(state) {
    const { runId, testFile } = state;
    const dir = this.directory(runId);
    await this.log(state, 'system', `[runner] Menjalankan Lighthouse CI ${testFile.path}\n`);
    const configPath = join(root, testFile.path);
    const child = spawn('npx', ['lhci', 'autorun', '--config=' + configPath, '--outputDir=' + join(dir, 'artifacts')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => child.on('close', res));
    state.child = null;
    await state.chain;

    const results = await this.parseLighthouse(dir);
    const status = state.cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed';
    await this.store.patchRun(runId, {
      status,
      finished_at: new Date().toISOString(),
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
    });
    if (results.length) await this.store.addLighthouseResults(runId, results);
    await this.collectArtifacts(runId, dir);
    await this.store.patchRun(runId, { finalized_at: new Date().toISOString() });
  }

  async parsePlaywright(dir) {
    const files = await filesBelow(join(dir, 'artifacts')).catch(() => []);
    const jsonFile = files.find(f => f.endsWith('.json') && f.includes('report'));
    if (!jsonFile) return [];
    const data = await readFile(join(dir, 'artifacts', jsonFile), 'utf8').then(JSON.parse).catch(() => null);
    if (!data?.suites) return [];
    const out = [];
    for (const suite of data.suites) {
      for (const spec of suite.specs ?? []) {
        const tests = spec.tests ?? (spec.ok !== undefined ? [spec] : []);
        for (const t of tests) {
          const s = t.status ?? (t.ok ? 'passed' : 'failed');
          if (s === 'skipped') continue;
          out.push({
            file: spec.file ?? 'unknown',
            title: t.title ?? '',
            tcId: (t.title ?? '').match(/TC-[A-Z0-9-]+/)?.[0] ?? null,
            status: s === 'passed' || s === 'failed' || s === 'skipped' ? s : (t.flaky ? 'flaky' : 'failed'),
            durationMs: t.duration ?? null,
            retry: t.retry ?? 0,
            error: t.error?.message ? String(t.error.message).slice(0, 3000) : null,
          });
        }
      }
    }
    return out;
  }

  async parseLighthouse(dir) {
    const files = await filesBelow(join(dir, 'artifacts')).catch(() => []);
    const out = [];
    for (const f of files.filter(f => f.includes('report') && f.endsWith('.json'))) {
      const data = await readFile(join(dir, 'artifacts', f), 'utf8').then(JSON.parse).catch(() => null);
      if (!data?.categories) continue;
      const cat = (k) => data.categories[k]?.score ?? null;
      out.push({
        url: data.finalUrl ?? data.requestedUrl ?? f,
        performance: cat('performance'),
        accessibility: cat('accessibility'),
        bestPractices: cat('best-practices'),
        seo: cat('seo'),
        lcpMs: data.audits?.['largest-contentful-paint']?.numericValue ?? null,
        cls: data.audits?.['cumulative-layout-shift']?.numericValue ?? null,
        tbtMs: data.audits?.['total-blocking-time']?.numericValue ?? null,
        budgetFailed: null,
        warnings: data.runWarnings?.length ? JSON.stringify(data.runWarnings) : null,
      });
    }
    return out;
  }

  async collectArtifacts(runId, dir) {
    const artifactsDir = join(dir, 'artifacts');
    const files = await filesBelow(artifactsDir).catch(() => []);
    for (const f of files) {
      const kind = f.includes('lighthouse') || f.includes('lhci') ? 'lh-html'
        : f.endsWith('.json') ? 'pw-json'
        : f.endsWith('.html') ? 'pw-html'
        : f.includes('trace') ? 'trace'
        : f.includes('video') ? 'video'
        : f.includes('.png') || f.includes('.jpg') ? 'screenshot'
        : 'log';
      const bytes = await readFile(join(artifactsDir, f)).then(b => b.length).catch(() => null);
      this.store.addArtifact({ runId, kind, path: f, bytes });
    }
  }
}
