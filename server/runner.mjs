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

  async start(runId, testFile, sessionId = null) {
    if (this.active) throw Object.assign(new Error('Another run is active'), { status: 409 });
    const state = { runId, sessionId, testFile, seq: 0, chain: Promise.resolve(), child: null, cancelled: false, startTime: Date.now() };
    this.active = state;
    state.done = this.execute(state).finally(() => { this.active = null; });
    return state.done;
  }

  async cancel(runId) {
    if (!this.active || this.active.runId !== runId) return false;
    this.active.cancelled = true;
    const child = this.active.child;
    if (!child) return true;
    // shell:true → child.pid adalah shell; matikan seluruh pohon proses.
    this.killTree(child);
    // PRD §8.6: tunggu 10 s, lalu SIGKILL.
    setTimeout(() => { if (child.exitCode === null) this.killTree(child, true); }, 10000).unref();
    return true;
  }

  killTree(child, hard = false) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill(hard ? 'SIGKILL' : 'SIGTERM');
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

  // Bunuh proses saat melewati timeout; PRD §8.3.
  arm(state) {
    state.timer = setTimeout(() => {
      state.timedOut = true;
      if (state.child) this.killTree(state.child);
    }, this.timeout);
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
    this.arm(state);

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
    } finally {
      clearTimeout(state.timer);
    }
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
  }

  // Jalankan satu spec Playwright langsung (fase 1: CLI lokal menjalankan).
  async runPlaywright(state) {
    const { runId, testFile } = state;
    const dir = this.directory(runId);
    const targetUrl = null; // diisi oleh CLI/API pada fase selanjutnya; untuk saat ini hardcode dari test_file code
    await this.log(state, 'system', `[runner] Menjalankan Playwright ${testFile.path}\n`);
    const specPath = testFile.path.replaceAll('\\', '/'); // relatif: path absolut Windows dibaca Playwright sebagai regex
    const env = {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, 'artifacts', 'report.json'),
      // Report HTML ditulis ke folder run supaya bisa disajikan sebagai artifact.
      PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, 'artifacts', 'playwright-report'),
    };
    const args = ['playwright', 'test', specPath, '--reporter=json,html', `--output=${join(dir, 'artifacts')}`];
    const child = spawn('npx', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => { child.on('close', res); child.on('error', e => { this.log(state, 'stderr', e.message + '\n'); res(1); }); });
    state.child = null;
    await state.chain;

    // Parse hasil JSON Playwright → playwright_results
    const results = await this.parsePlaywright(dir);
    const status = state.cancelled ? 'cancelled'
      : state.timedOut ? 'failed'
      : !results.length ? 'failed'
      : code === 0 && results.every(r => r.status === 'passed') ? 'passed' : 'failed';
    const error = state.timedOut ? 'timeout'
      : !results.length && !state.cancelled ? 'JSON Playwright tidak ditemukan' : null;
    await this.store.patchRun(runId, {
      status,
      error,
      finished_at: new Date().toISOString(),
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
    });
    if (results.length) await this.store.addPlaywrightResults(runId, results);
    await this.collectArtifacts(runId, dir, 'pw');
    await this.store.patchRun(runId, { finalized_at: new Date().toISOString() });
    this.store.markReportsStale(state.sessionId);
  }

  async runLighthouse(state) {
    const { runId, testFile } = state;
    const dir = this.directory(runId);
    await this.log(state, 'system', `[runner] Menjalankan Lighthouse CI ${testFile.path}\n`);
    const configPath = join(root, testFile.path);
    const outDir = join(dir, 'artifacts');
    await mkdir(outDir, { recursive: true });
    // cwd = dir: lhci menulis .lighthouseci/ relatif cwd, jadi tiap run terisolasi.
    const child = spawn('npx', ['lhci', 'autorun', '--config=' + configPath, '--upload.target=filesystem', '--upload.outputDir=' + outDir], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => { child.on('close', res); child.on('error', e => { this.log(state, 'stderr', e.message + '\n'); res(1); }); });
    state.child = null;
    await state.chain;

    const results = await this.parseLighthouse(dir);
    const status = state.cancelled ? 'cancelled' : state.timedOut ? 'failed' : !results.length ? 'failed' : code === 0 ? 'passed' : 'failed';
    const error = state.timedOut ? 'timeout' : !results.length && !state.cancelled ? 'JSON Lighthouse tidak ditemukan' : null;
    await this.store.patchRun(runId, {
      status,
      error,
      finished_at: new Date().toISOString(),
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
    });
    if (results.length) await this.store.addLighthouseResults(runId, results);
    await this.collectArtifacts(runId, dir, 'lh');
    await this.store.patchRun(runId, { finalized_at: new Date().toISOString() });
    this.store.markReportsStale(state.sessionId);
  }

  async parsePlaywright(dir) {
    const files = await filesBelow(join(dir, 'artifacts')).catch(() => []);
    const jsonFile = files.find(f => f.endsWith('.json') && f.includes('report'));
    if (!jsonFile) return [];
    const data = await readFile(join(dir, 'artifacts', jsonFile), 'utf8').then(JSON.parse).catch(() => null);
    if (!data?.suites) return [];
    const out = [];
    // Playwright menyimpan spec di suite bersarang: suites[].suites[].specs[]
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const last = (t.results ?? []).at(-1);
          const raw = last?.status ?? 'failed';
          const status = raw === 'timedOut' ? 'failed' : raw === 'interrupted' ? 'failed' : raw;
          if (status === 'skipped') continue;
          out.push({
            file: suite.file ?? spec.file ?? 'unknown',
            title: spec.title ?? t.title ?? '',
            tcId: (spec.title ?? t.title ?? '').match(/TC-[A-Z0-9-]+/)?.[0] ?? null,
            status: ['passed', 'failed', 'skipped'].includes(status) ? status : (t.status === 'flaky' ? 'flaky' : 'failed'),
            durationMs: last?.duration ?? null,
            retry: t.retry ?? 0,
            error: last?.error?.message ? String(last.error.message).slice(0, 3000) : null,
          });
        }
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of data.suites) walk(suite);
    return out;
  }

  async parseLighthouse(dir) {
    const files = await filesBelow(join(dir, 'artifacts')).catch(() => []);
    const out = [];
    // Assertion yang gagal → budget_failed per URL. lhci menaruhnya di .lighthouseci/ (cwd),
    // bukan di upload dir; cek keduanya.
    const assertFile = files.find(f => f.includes('assertion-results'));
    const assertRaw = assertFile
      ? await readFile(join(dir, 'artifacts', assertFile), 'utf8').catch(() => null)
      : await readFile(join(dir, '.lighthouseci', 'assertion-results.json'), 'utf8').catch(() => null);
    const assertFailed = new Map();
    if (assertRaw) {
      const rows = (() => { try { return JSON.parse(assertRaw); } catch { return []; } })();
      for (const a of Array.isArray(rows) ? rows : []) {
        if (a.level !== 'error' && a.level !== 'warn') continue;
        const key = a.url ?? '';
        const label = a.auditId && a.auditProperty ? `${a.auditId}:${a.auditProperty}` : a.auditId ?? a.name ?? 'assertion';
        assertFailed.set(key, [...(assertFailed.get(key) ?? []), label]);
      }
    }
    // lhci filesystem target menulis manifest.json: url → htmlPath/jsonPath absolut.
    const manifest = await readFile(join(dir, 'artifacts', 'manifest.json'), 'utf8').then(JSON.parse).catch(() => []);
    const htmlByUrl = new Map();
    for (const m of Array.isArray(manifest) ? manifest : []) {
      if (m.url && m.htmlPath) htmlByUrl.set(m.url, relative(join(dir, 'artifacts'), m.htmlPath).replaceAll('\\', '/'));
    }
    for (const f of files.filter(f => f.endsWith('.json'))) {
      if (f === 'manifest.json') continue;
      const data = await readFile(join(dir, 'artifacts', f), 'utf8').then(JSON.parse).catch(() => null);
      if (!data?.categories) continue;
      const cat = (k) => data.categories[k]?.score ?? null;
      const url = data.finalUrl ?? data.requestedUrl ?? f;
      out.push({
        url,
        performance: cat('performance'),
        accessibility: cat('accessibility'),
        bestPractices: cat('best-practices'),
        seo: cat('seo'),
        lcpMs: data.audits?.['largest-contentful-paint']?.numericValue ?? null,
        cls: data.audits?.['cumulative-layout-shift']?.numericValue ?? null,
        tbtMs: data.audits?.['total-blocking-time']?.numericValue ?? null,
        budgetFailed: assertFailed.get(url)?.join(', ') ?? null,
        warnings: data.runWarnings?.length ? JSON.stringify(data.runWarnings) : null,
        reportPath: htmlByUrl.get(url) ?? null,
      });
    }
    return out;
  }

  async collectArtifacts(runId, dir, tool = 'pw') {
    const artifactsDir = join(dir, 'artifacts');
    const files = await filesBelow(artifactsDir).catch(() => []);
    for (const f of files) {
      const kind = f.endsWith('.json') ? (tool === 'lh' ? 'lh-json' : 'pw-json')
        : f.endsWith('.html') ? (tool === 'lh' ? 'lh-html' : 'pw-html')
        : f.includes('trace') ? 'trace'
        : f.includes('video') ? 'video'
        : /\.(png|jpe?g)$/i.test(f) ? 'screenshot'
        : 'log';
      const bytes = await readFile(join(artifactsDir, f)).then(b => b.length).catch(() => null);
      this.store.addArtifact({ runId, kind, path: f, bytes });
    }
  }
}
