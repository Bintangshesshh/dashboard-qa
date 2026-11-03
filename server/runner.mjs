import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, appendFile, readdir, readFile, rm, copyFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { target as validateTarget } from './validation.mjs';
import { stripAnsi } from './ansi.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
// Resolve installed CLIs by path: `npx` resolves against cwd, and lhci runs with
// cwd inside .runs/<id>, where npx pulled an unrelated package from the registry.
const binDir = pkg => dirname(require.resolve(pkg + '/package.json'));
const lhciBin = join(binDir('@lhci/cli'), 'src/cli.js');
const pwBin = join(binDir('@playwright/test'), 'cli.js');
const pwCapture = require.resolve('./scripts/pw-capture.cjs').replaceAll('\\', '/');

// Config Playwright untuk spec yang datang dari database. testDir = folder spec
// asli supaya import relatif (`./creds`) tetap jalan.
const runConfig = (testDir, specFile, cfg = {}) => `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: ${JSON.stringify(testDir)},
  testMatch: ${JSON.stringify(specFile)},
  fullyParallel: false,
  workers: ${cfg.workers ?? 1},
  timeout: ${cfg.timeout ?? 120000},
  retries: ${cfg.retries ?? 0},
  reporter: [
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME }],
    ['html', { outputDir: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR, open: 'never' }],
  ],
  // ignoreHTTPSErrors: target lokal sering pakai sertifikat self-signed (basicSsl).
  use: { ...devices['Desktop Chrome'], navigationTimeout: 90000, ignoreHTTPSErrors: true },
});
`;

// Lighthouse (PRD FR-04/FR-05): target sesi + maksimal 4 URL tambahan.
export const MAX_LH_URLS = 5;
export const MAX_LH_RUNS = 10;
// Lantai 15 menit: killing lhci mid-run membuang report, jadi 1 URL pun dapat lantai.
const MIN_LH_TIMEOUT_MS = 900_000;
const LH_TIMEOUT_CAP_MS = 120 * 60_000;

// timeout = max(15 menit, 5 menit + URL x run x 90 detik), cap 120 menit.
// Flat 900.000 ms aman untuk 1-2 URL, tapi tidak proporsional untuk 5 URL x 10 run.
export function lhTimeout(urlCount, runsPerUrl = 1) {
  const urls = Math.max(1, Number(urlCount) || 1);
  const runs = Math.max(1, Number(runsPerUrl) || 1);
  const dynamic = 5 * 60_000 + urls * runs * 90_000;
  return Math.min(Math.max(MIN_LH_TIMEOUT_MS, dynamic), LH_TIMEOUT_CAP_MS);
}

// Jumlah audit untuk timeout: URL sesi ikut dihitung, duplikat dibuang.
export function lhAuditShape(testFile, targetUrl) {
  const cfg = (() => { try { return JSON.parse(testFile?.config ?? 'null'); } catch { return null; } })();
  const urls = lhUrls(cfg, targetUrl);
  return [urls.length || 1, cfg?.numberOfRuns ?? 1];
}

export function lhUrls(cfg, targetUrl) {
  return [...new Set([...(targetUrl ? [targetUrl] : []), ...(cfg?.urls ?? [])])];
}

// Target lokal HTTPS biasanya self-signed (vite basicSsl). Hanya loopback yang
// dilewati cek sertifikat; staging/production tetap divalidasi penuh.
// ignoreHTTPSErrors TIDAK dipakai: LHCI collect mengabaikannya, yang jalan hanya
// chromeFlags (diverifikasi dengan sertifikat self-signed di localhost).
const isLoopback = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
const localHttps = urls => urls.some(u => { try { const x = new URL(u); return x.protocol === 'https:' && isLoopback(x.hostname); } catch { return false; } });

export function lhConfig(cfg, targetUrl, outDir, { allowedOrigins = [] } = {}) {
  const urls = lhUrls(cfg, targetUrl);
  if (!urls.length) throw new Error('Tidak ada URL untuk diaudit: sesi tanpa targetUrl dan config tanpa urls');
  if (urls.length > MAX_LH_URLS) throw new Error(`Maksimal ${MAX_LH_URLS} URL per run Lighthouse (diminta ${urls.length})`);
  // URL tambahan dicek sebelum spawn: bentuk URL + origin yang diizinkan project.
  for (const u of urls) {
    let origin;
    try { origin = new URL(u).origin; } catch { throw new Error(`URL tidak valid: ${u}`); }
    if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
      throw new Error(`Origin ${origin} tidak diizinkan untuk project ini`);
    }
  }
  const runs = cfg?.numberOfRuns ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_LH_RUNS) {
    throw new Error(`numberOfRuns harus bilangan bulat 1-${MAX_LH_RUNS}`);
  }
  // Budget memakai 'error': skor di bawah batas = run failed (PRD FR-04).
  const assertions = Object.fromEntries(
    Object.entries(cfg?.budgets ?? {}).map(([k, v]) => [k, ['error', { minScore: v?.minScore ?? 0.6 }]]),
  );
  return `module.exports = ${JSON.stringify({
    ci: {
      collect: {
        numberOfRuns: runs,
        url: urls,
        ...(localHttps(urls) ? { settings: { chromeFlags: ['--ignore-certificate-errors'] } } : {}),
      },
      assert: { assertions },
      upload: { target: 'filesystem', outputDir: String(outDir).replaceAll('\\', '/') },
    },
  }, null, 2)};\n`;
}

// PRD Â§8.8: runWarnings LH ikut ke run_logs (`system`). Tahan nilai yang bukan
// JSON valid (lhci kadang menulis string mentah).
export function warningLines(results) {
  const out = [];
  for (const r of results ?? []) {
    if (!r?.warnings) continue;
    const list = (() => { try { return JSON.parse(r.warnings); } catch { return [r.warnings]; } })();
    for (const w of Array.isArray(list) ? list : [list]) {
      out.push(`[lh] ${r.url ?? '?'}: ${typeof w === 'string' ? w : JSON.stringify(w)}\n`);
    }
  }
  return out;
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [v]; } catch { return []; }
}

// Ambil baris JSONL yang sudah lengkap sejak `offset`. Baris terakhir tanpa
// newline sengaja ditinggal: appendFileSync antar worker bisa memotong satu
// baris jadi dua write.
export function cutCaptureLines(raw, offset = 0) {
  if (raw.length < offset) return { lines: [], offset: 0 }; // file ditulis ulang
  const chunk = raw.slice(offset);
  const end = chunk.lastIndexOf('\n');
  if (end < 0) return { lines: [], offset };
  return { lines: chunk.slice(0, end).split('\n').filter(l => l.trim()), offset: offset + end + 1 };
}

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

  async start(runId, testFile, sessionId = null, targetUrl = null) {
    // Antrekan, jangan tolak: hanya satu proses tool yang boleh jalan sekaligus.
    // `this.chain` selalu di-catch supaya satu run gagal tidak mematikan antrean.
    const run = (this.chain ?? Promise.resolve()).then(() => this._start(runId, testFile, sessionId, targetUrl));
    this.chain = run.catch(() => {});
    return run;
  }

  async _start(runId, testFile, sessionId, targetUrl) {
    // Run bisa dibatalkan saat masih antre; jangan dijalankan sama sekali.
    if (this.store.getRun(runId)?.status === 'cancelled') return;
    // Baris `system` bisa sudah ditulis route sebelum runner jalan (jejak production),
    // jadi seq dimulai dari yang sudah ada supaya tidak bentrok primary key.
    const state = { runId, sessionId, testFile, targetUrl, seq: this.store.lastLogSeq(runId), chain: Promise.resolve(), child: null, cancelled: false, startTime: Date.now() };
    this.active = state;
    state.done = this.execute(state).finally(() => { this.active = null; });
    return state.done;
  }

  async cancel(runId) {
    if (!this.active || this.active.runId !== runId) return false;
    this.active.cancelled = true;
    const child = this.active.child;
    if (!child) return true;
    // shell:true â†’ child.pid adalah shell; matikan seluruh pohon proses.
    this.killTree(child);
    // PRD Â§8.6: tunggu 10 s, lalu SIGKILL.
    setTimeout(() => { if (child.exitCode === null) this.killTree(child, true); }, 10000).unref();
    return true;
  }

  killTree(child, hard = false) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill(hard ? 'SIGKILL' : 'SIGTERM');
  }

  async log(state, stream, text) {
    const plain = stripAnsi(text);
    const entry = { seq: ++state.seq, stream, text: plain, at: new Date().toISOString() };
    state.chain = state.chain.then(async () => {
      await this.store.log(state.runId, entry);
      await appendFile(join(this.directory(state.runId), 'logs.txt'), entry.text);
      this.emit('log', { type: 'log', runId: state.runId, ...entry });
    });
    return state.chain;
  }

  // Killing lhci mid-run throws away the report, so Lighthouse gets a floor.
  arm(state, timeout = this.timeout) {
    state.timer = setTimeout(() => {
      state.timedOut = true;
      if (state.child) this.killTree(state.child);
    }, timeout);
  }

  async status(patch) {
    this.emit('status', { type: 'status', runId: this.active?.runId, run: await this.store.patchRun(this.active?.runId, patch) });
  }

  // Origin yang boleh ditembak runner: allowlist server + project (origin
  // base/staging/local + projects.origins). `env local` tetap dikecualikan.
  allowedOriginsFor(state) {
    const session = state.sessionId ? this.store.getSession(state.sessionId) : null;
    const project = session ? this.store.getProject(session.project_id) : null;
    const declared = [project?.base_url, project?.staging_url, project?.local_url]
      .filter(Boolean).map(v => { try { return new URL(v).origin; } catch { return null; } }).filter(Boolean);
    return [...this.origins, ...(project?.origins ?? []), ...declared];
  }

  async execute(state) {
    const { runId, testFile } = state;
    // PRD Â§7/G11: runner tidak percaya pemanggil - target harus tetap di allowlist.
    // Origin milik project (dari sesi) ikut diizinkan, sama seperti resolveTarget.
    if (state.targetUrl) {
      const allowed = this.allowedOriginsFor(state);
      try { state.targetUrl = validateTarget(state.targetUrl, allowed); }
      catch (error) {
        await this.store.patchRun(runId, { status: 'failed', error: stripAnsi(error.message), finished_at: new Date().toISOString() });
        this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
        return;
      }
    }
    const dir = this.directory(runId);
    await mkdir(dir, { recursive: true });
    await this.store.patchRun(runId, { status: 'running', started_at: new Date().toISOString() });
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
    this.arm(state, testFile.tool === 'lh' ? lhTimeout(...lhAuditShape(testFile, state.targetUrl)) : this.timeout);

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
      await this.store.patchRun(runId, { status: 'failed', error: stripAnsi(error.message), finished_at: new Date().toISOString(), duration_ms: Date.now() - started });
    } finally {
      clearTimeout(state.timer);
    }
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
  }

  // Jalankan satu spec Playwright langsung (fase 1: CLI lokal menjalankan).
  async runPlaywright(state) {
    const { runId, testFile, targetUrl } = state;
    const dir = this.directory(runId);
    await this.log(state, 'system', `[runner] Menjalankan Playwright ${testFile.path}\n`);
    let specPath = testFile.path.replaceAll('\\', '/'); // relatif: path absolut Windows dibaca Playwright sebagai regex
    const captureFile = join(dir, 'capture.jsonl');
    const env = {
      ...process.env,
      ...(targetUrl ? { BASE_URL: targetUrl } : {}),
      PLAYBOOK_CAPTURE_FILE: captureFile,
      // Preload: page events are only reachable from inside the worker.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${pwCapture}`].filter(Boolean).join(' '),
      PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, 'artifacts', 'report.json'),
      // Report HTML ditulis ke folder run supaya bisa disajikan sebagai artifact.
      PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, 'artifacts', 'playwright-report'),
    };
    // `config` opsional: { configPath } untuk config Playwright khusus (quick check).
    const pwCfg = (() => { try { return JSON.parse(testFile.config ?? '{}') ?? {}; } catch { return {}; } })();
    let cfgPath = pwCfg.configPath ?? null;
    // Kode dari DB (editor dashboard) menang atas file di disk. Ditulis di sebelah
    // spec aslinya karena spec eureka mengimpor `./creds` - memindahkan file ke
    // folder run akan memutus import relatif. Config ditaruh di root repo supaya
    // `@playwright/test` bisa di-resolve. Keduanya dihapus setelah run.
    let generated = null;
    let generatedCfg = null;
    if (testFile.code?.trim()) {
      const original = join(root, testFile.path);
      generated = join(dirname(original), `.playbook-${runId.slice(0, 8)}.spec.ts`);
      // Folder spec bisa belum ada (mis. project baru). Buat dulu; tanpa ini
      // error-nya ENOENT mentah yang tidak bisa dimengerti user.
      try {
        await mkdir(dirname(generated), { recursive: true });
        await writeFile(generated, testFile.code);
      } catch (err) {
        throw new Error(`Folder spec tidak bisa dibuat: ${dirname(generated)} (${err.code ?? err.message})`);
      }
      generatedCfg = join(root, `.playbook-${runId.slice(0, 8)}.config.mjs`);
      await writeFile(generatedCfg, runConfig(dirname(original), basename(generated), pwCfg));
      cfgPath = generatedCfg;
      specPath = basename(generated);
      await this.log(state, 'system', `[runner] Spec dari database â†’ ${basename(generated)}\n`);
    }
    // `--output` (test-results) harus terpisah dari folder report HTML; kalau
    // bersarang, Playwright menolak karena reporter HTML menghapus foldernya.
    const args = [pwBin, 'test', specPath, `--output=${join(dir, 'artifacts', 'test-results')}`];
    if (cfgPath) args.push('--config=' + cfgPath);
    else args.push('--reporter=json,html');
    // Tail dimulai sebelum spawn: console/network harus mengalir bersama log.
    const stopTail = await this.tailCapture(state, captureFile);
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => { child.on('close', res); child.on('error', e => { this.log(state, 'stderr', e.message + '\n'); res(1); }); });
    state.child = null;
    if (generated) await rm(generated, { force: true }).catch(() => {});
    if (generatedCfg) await rm(generatedCfg, { force: true }).catch(() => {});
    await state.chain;

    // Parse hasil JSON Playwright â†’ playwright_results
    const results = await this.parsePlaywright(dir);
    const status = state.cancelled ? 'cancelled'
      : state.timedOut ? 'failed'
      : !results.length ? 'failed'
      : code === 0 && results.every(r => r.status === 'passed') ? 'passed' : 'failed';
    const error = state.timedOut ? 'timeout'
      : !results.length && !state.cancelled ? 'JSON Playwright tidak ditemukan' : null;
    if (results.length) await this.store.addPlaywrightResults(runId, results);
    await stopTail();
    await this.ingestCapture(state, captureFile);
    await this.collectArtifacts(runId, dir, 'pw');
    const finishedAt = new Date().toISOString();
    await this.writeRunJson(state, dir, { status, exitCode: code, error, mode: 'pw', finishedAt });
    // Status final di-patch paling akhir: UI berhenti polling begitu status final,
    // jadi artifact harus sudah masuk DB sebelum itu.
    await this.store.patchRun(runId, {
      status,
      error,
      finished_at: finishedAt,
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
      finalized_at: finishedAt,
    });
    this.store.markReportsStale(state.sessionId);
  }

  async runLighthouse(state) {
    const { runId, testFile, targetUrl } = state;
    const dir = this.directory(runId);
    await this.log(state, 'system', `[runner] Menjalankan Lighthouse CI ${testFile.path}\n`);
    const outDir = join(dir, 'artifacts');
    await mkdir(outDir, { recursive: true });
    // Config digenerate dari test_files.config (PRD Â§8.3): URL sesi + urls tambahan.
    // Tanpa ini, memilih env local/staging tetap menembak URL produksi di file repo.
    const cfg = (() => { try { return JSON.parse(testFile.config ?? 'null'); } catch { return null; } })();
    let configPath = isAbsolute(testFile.path) ? testFile.path : join(root, testFile.path);
    if (cfg) {
      configPath = join(dir, 'lighthouserc.cjs');
      // Origin URL tambahan divalidasi di sini juga: config bisa ditulis CLI.
      const allowed = this.allowedOriginsFor(state);
      await writeFile(configPath, lhConfig(cfg, targetUrl, outDir, { allowedOrigins: allowed }));
      const audited = lhUrls(cfg, targetUrl);
      await this.log(state, 'system', `[runner] Config LH digenerate (${cfg.numberOfRuns ?? 1}x, ${audited.length} URL)\n`);
    }
    // cwd = dir: lhci menulis .lighthouseci/ relatif cwd, jadi tiap run terisolasi.
    // Console/network Lighthouse hanya ada di LHR, jadi muncul setelah selesai.
    await this.log(state, 'system', '[runner] Console & network Lighthouse diambil dari LHR dan muncul setelah audit selesai.\n');
    const child = spawn(process.execPath, [lhciBin, 'autorun', '--config=' + configPath, '--upload.target=filesystem', '--upload.outputDir=' + outDir], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    child.stdout.on('data', d => this.log(state, 'stdout', d));
    child.stderr.on('data', d => this.log(state, 'stderr', d));
    const code = await new Promise(res => { child.on('close', res); child.on('error', e => { this.log(state, 'stderr', e.message + '\n'); res(1); }); });
    state.child = null;
    await state.chain;

    const results = await this.parseLighthouse(dir, state);
    const status = state.cancelled ? 'cancelled' : state.timedOut ? 'failed' : !results.length ? 'failed' : code === 0 ? 'passed' : 'failed';
    const error = state.timedOut ? 'timeout' : !results.length && !state.cancelled ? 'JSON Lighthouse tidak ditemukan' : null;
    if (results.length) await this.store.addLighthouseResults(runId, results);
    // PRD Â§8.8: runWarnings LH juga tampil di terminal, bukan cuma kolom warnings.
    for (const line of warningLines(results)) await this.log(state, 'system', line);
    await this.collectArtifacts(runId, dir, 'lh');
    const finishedAt = new Date().toISOString();
    await this.writeRunJson(state, dir, { status, exitCode: code, error, mode: 'lh', finishedAt });
    // Sama seperti Playwright: artifact dulu, status final terakhir.
    await this.store.patchRun(runId, {
      status,
      error,
      finished_at: finishedAt,
      exit_code: code,
      duration_ms: Date.now() - state.startTime,
      finalized_at: finishedAt,
    });
    this.store.markReportsStale(state.sessionId);
  }

  // PRD Â§8.8: console/network dari reporter masuk ke run_logs sebagai stream terpisah.
  // Tail capture.jsonl selama proses jalan. Reporter menulis live; tanpa ini
  // panel Console/Network baru terisi setelah run selesai.
  async tailCapture(state, file, interval = 700) {
    let offset = 0;
    // Dua drain bisa tumpang tindih kalau baca file lambat; tanpa penjaga,
    // keduanya memakai offset lama dan baris sama masuk dua kali.
    let busy = false;
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        const raw = await readFile(file, 'utf8').catch(() => '');
        const cut = cutCaptureLines(raw, offset);
        offset = cut.offset;
        for (const line of cut.lines) {
          let item;
          try { item = JSON.parse(line); } catch { continue; }
          if (!item?.stream || !item?.payload) continue;
          await this.log(state, item.stream, JSON.stringify(item.payload) + '\n');
        }
      } finally { busy = false; }
    };
    const timer = setInterval(() => { drain().catch(() => {}); }, interval);
    return async () => {
      clearInterval(timer);
      // Tutup saat satu drain masih jalan: tunggu, lalu sedot sisa baris.
      while (busy) await new Promise(r => setTimeout(r, 20));
      await drain();
      await rm(file, { force: true }).catch(() => {});
    };
  }

  async ingestCapture(state, file) {
    const raw = await readFile(file, 'utf8').catch(() => '');
    if (!raw.trim()) return;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      if (!item?.stream || !item?.payload) continue;
      await this.log(state, item.stream, JSON.stringify(item.payload) + '\n');
    }
    await rm(file, { force: true }).catch(() => {});
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
            error: last?.error?.message ? stripAnsi(last.error.message).slice(0, 3000) : null,
          });
        }
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of data.suites) walk(suite);
    return out;
  }

  // Console & network untuk Lighthouse: LHR sudah memuatnya
  // (audits.network-requests / audits.errors-in-console), jadi tidak perlu hook
  // browser seperti Playwright. Baris ditulis sebagai JSON satu baris, format
  // sama dengan reporter Playwright.
  // ponytail: dipotong di 500 request per halaman; naikkan kalau halaman berat
  // butuh semua request (log_max_bytes 5 MB tetap jadi batas akhir).
  async captureLighthouse(state, data, pageUrl) {
    const MAX = 500;
    const reqs = data.audits?.['network-requests']?.details?.items ?? [];
    for (const r of reqs.slice(0, MAX)) {
      if (!r?.url) continue;
      const ms = Number.isFinite(r.networkEndTime) && Number.isFinite(r.networkRequestTime)
        ? Math.round(r.networkEndTime - r.networkRequestTime) : null;
      await this.log(state, 'network', JSON.stringify({
        url: r.url,
        method: null, // LHR tidak menyimpan method HTTP
        status: r.statusCode ?? null,
        failure: r.finished === false ? 'tidak selesai' : null,
        ms,
      }) + '\n');
    }
    if (reqs.length > MAX) {
      await this.log(state, 'system', `[lh] network dipotong di ${MAX} dari ${reqs.length} request (${pageUrl})\n`);
    }
    for (const e of data.audits?.['errors-in-console']?.details?.items ?? []) {
      const loc = e?.sourceLocation;
      await this.log(state, 'console', JSON.stringify({
        type: 'error',
        text: String(e?.description ?? '').slice(0, 2000),
        location: loc?.url ? (loc.line ? `${loc.url}:${loc.line}` : loc.url) : null,
      }) + '\n');
    }
  }

  // Lighthouse writes LHRs and the HTML report to `.lighthouseci/` first and the
  // filesystem upload copies them afterwards. Reading both keeps scores when a
  // run is killed before upload finishes.
  async parseLighthouse(dir, state = null) {
    const artifactsDir = join(dir, 'artifacts');
    const lhciDir = join(dir, '.lighthouseci');
    const files = await filesBelow(artifactsDir).catch(() => []);
    const out = new Map();

    const assertRaw = await readFile(join(artifactsDir, 'assertion-results.json'), 'utf8').catch(() => null)
      ?? await readFile(join(lhciDir, 'assertion-results.json'), 'utf8').catch(() => null);
    const assertFailed = new Map();
    for (const a of parseJsonArray(assertRaw)) {
      if (a.level !== 'error' && a.level !== 'warn') continue;
      const key = a.url ?? '';
      const label = a.auditId && a.auditProperty ? `${a.auditId}:${a.auditProperty}` : a.auditId ?? a.name ?? 'assertion';
      assertFailed.set(key, [...(assertFailed.get(key) ?? []), label]);
    }

    const manifest = parseJsonArray(await readFile(join(artifactsDir, 'manifest.json'), 'utf8').catch(() => null));
    const htmlByUrl = new Map();
    for (const m of manifest) {
      if (m.url && m.htmlPath) htmlByUrl.set(m.url, relative(artifactsDir, m.htmlPath).replaceAll('\\', '/'));
    }

    let lhrFiles = files.filter(f => f.endsWith('.json') && f !== 'manifest.json');
    let lhrDir = artifactsDir;
    if (!lhrFiles.length) {
      lhrFiles = (await filesBelow(lhciDir).catch(() => [])).filter(f => /^lhr-.+\.json$/.test(basename(f)));
      lhrDir = lhciDir;
    }

    const fileByUrl = new Map();
    const lhrByUrl = new Map();
    for (const f of lhrFiles) {
      const data = await readFile(join(lhrDir, f), 'utf8').then(JSON.parse).catch(() => null);
      if (!data?.categories) continue;
      const url = data.finalUrl ?? data.requestedUrl ?? f;
      const at = Number(data.fetchTime ?? 0);
      // numberOfRuns > 1 yields several LHRs per URL; keep the newest.
      if ((out.get(url)?.at ?? -1) > at) continue;
      if (state) lhrByUrl.set(url, data);
      const cat = (k) => data.categories[k]?.score ?? null;
      fileByUrl.set(url, f);
      out.set(url, {
        at,
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

    // Capture sekali per URL, dari LHR yang menang (bukan tiap file LHR).
    if (state) for (const [url, data] of lhrByUrl) await this.captureLighthouse(state, data, url);

    // Report never uploaded: adopt the lhci copy so the link still resolves.
    if (out.size) await mkdir(artifactsDir, { recursive: true }).catch(() => {});
    for (const [url, row] of out) {
      delete row.at;
      if (row.reportPath) continue;
      const name = basename(fileByUrl.get(url) ?? '').replace(/\.json$/, '.html');
      const ok = await copyFile(join(lhrDir, name), join(artifactsDir, 'lh-' + name)).then(() => true).catch(() => false);
      if (ok) row.reportPath = 'lh-' + name;
    }
    return [...out.values()];
  }
  // Snapshot run untuk pipeline laporan HTML (scripts/build-report-docs.mjs).
  // Hanya fakta run; kode spec sengaja tidak ikut supaya tidak bocor ke report statis.
  async writeRunJson(state, dir, { status, exitCode, error, mode, finishedAt }) {
    const run = this.store.getRun(state.runId);
    const data = {
      id: state.runId,
      suiteName: state.testFile?.label ?? state.testFile?.path ?? null,
      targetUrl: state.targetUrl ?? null,
      mode,
      status,
      startedAt: run?.started_at ?? null,
      finishedAt: finishedAt ?? run?.finished_at ?? null,
      durationMs: run?.duration_ms ?? null,
      exitCode: exitCode ?? null,
      error: error ?? null,
    };
    await writeFile(join(dir, 'run.json'), JSON.stringify(data, null, 2)).catch(() => {});
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
