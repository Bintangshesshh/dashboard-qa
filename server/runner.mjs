import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, appendFile, readdir, readFile, rm, copyFile, unlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { target as validateTarget } from './validation.mjs';
import { stripAnsi } from './ansi.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
// Resolve CLI by path: `npx` resolves against cwd, and lhci runs cwd inside .runs/<id>.
const binDir = pkg => dirname(require.resolve(pkg + '/package.json'));
const lhciBin = join(binDir('@lhci/cli'), 'src/cli.js');
const pwBin = join(binDir('@playwright/test'), 'cli.js');
const pwCapture = require.resolve('./scripts/pw-capture.cjs').replaceAll('\\', '/');

// Config Playwright untuk spec dari database; testDir = folder spec asli agar import relatif (`./creds`) tetap jalan.
export const runConfig = (testDir, specFile, cfg = {}) => {
  // Opsi rekam/debug per-run. Video "on" mahal, jadi hanya saat diminta user;
  // trace hanya berguna untuk membedah kegagalan, jadi default retain-on-failure.
  const use = [
    `...devices['Desktop Chrome'],`,
    `navigationTimeout: 90000,`,
    `ignoreHTTPSErrors: true,`,
    cfg.recordVideo ? `video: 'on',` : null,
    `trace: ${JSON.stringify(cfg.debug ? 'on' : 'retain-on-failure')},`,
    cfg.debug ? `screenshot: 'only-on-failure',` : null,
    cfg.debug ? `launchOptions: { slowMo: ${Number(cfg.slowMo) || 400} },` : null,
  ].filter(Boolean).join('\n    ');
  return `import { defineConfig, devices } from '@playwright/test';

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
  use: { ${use} },
});
`;
};

// Lighthouse (PRD FR-04/FR-05): target sesi + maksimal 4 URL tambahan.
export const MAX_LH_URLS = 5;
export const MAX_LH_RUNS = 10;

// Mode debug menahan test di checkpoint (pause/step), jadi timeout normal
// 2 menit akan membunuh run yang sedang dijeda. Batas ini juga dipakai runner.
export const DEBUG_TEST_TIMEOUT_MS = 30 * 60_000;
export const DEBUG_RUN_TIMEOUT_MS = 35 * 60_000;
// Frame live disimpan untuk scrub setelah run; sisakan 1 menit terakhir saja.
const LIVE_FRAMES_KEPT = 60;
// Lantai 15 menit: killing lhci mid-run membuang report, jadi 1 URL pun dapat lantai.
const MIN_LH_TIMEOUT_MS = 900_000;
const LH_TIMEOUT_CAP_MS = 120 * 60_000;

// timeout = max(15 menit, 5 menit + URL x run x device x 90 detik), cap 120 menit;
// flat 900 dtk tidak proporsional untuk 5 URL x 10 run, apalagi mode both (2 device).
export function lhTimeout(urlCount, runsPerUrl = 1, devices = 1) {
  const urls = Math.max(1, Number(urlCount) || 1);
  const runs = Math.max(1, Number(runsPerUrl) || 1);
  const dev = Math.max(1, Number(devices) || 1);
  const dynamic = 5 * 60_000 + urls * runs * dev * 90_000;
  return Math.min(Math.max(MIN_LH_TIMEOUT_MS, dynamic), LH_TIMEOUT_CAP_MS);
}

// Jumlah audit untuk timeout: URL sesi ikut dihitung, duplikat dibuang; satu run selalu 2 device.
export function lhAuditShape(testFile, targetUrl) {
  const cfg = (() => { try { return JSON.parse(testFile?.config ?? 'null'); } catch { return null; } })();
  const urls = lhUrls(cfg, targetUrl);
  return [urls.length || 1, cfg?.numberOfRuns ?? 1, 2];
}

// URL config bisa ditulis pada host env mana pun (production paling umum).
// Kalau host-nya milik project, pindahkan ke origin target sesi supaya env
// local/staging tidak ikut menembak production.
export function lhUrls(cfg, targetUrl, projectUrls = []) {
  const origin = value => { try { return new URL(value).origin; } catch { return null; } };
  const known = new Set(projectUrls.map(origin).filter(Boolean));
  const base = targetUrl ? origin(targetUrl) : null;
  const urls = (cfg?.urls ?? []).map(raw => {
    if (!base) return raw;
    try {
      const u = new URL(raw);
      return known.has(u.origin) ? base + u.pathname + u.search + u.hash : raw;
    } catch { return raw; }
  });
  return [...new Set([...(targetUrl ? [targetUrl] : []), ...urls])];
}

// Hanya loopback HTTPS yang dilewati cek sertifikat; staging/production tetap divalidasi penuh.
// ignoreHTTPSErrors TIDAK dipakai: LHCI collect mengabaikannya, yang jalan hanya chromeFlags.
const isLoopback = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
const localHttps = urls => urls.some(u => { try { const x = new URL(u); return x.protocol === 'https:' && isLoopback(x.hostname); } catch { return false; } });

export function lhConfig(cfg, targetUrl, outDir, { allowedOrigins = [], projectUrls = [], device } = {}) {
  const urls = lhUrls(cfg, targetUrl, projectUrls);
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
  const formFactor = device ?? (cfg?.formFactor === 'desktop' ? 'desktop' : 'mobile');
  const settings = { locale: cfg?.locale === 'en' ? 'en' : 'id' };
  if (formFactor === 'desktop') settings.preset = 'desktop';
  // Loopback HTTPS saja yang dilewati cek sertifikat.
  if (localHttps(urls)) settings.chromeFlags = ['--ignore-certificate-errors'];
  return `module.exports = ${JSON.stringify({
    ci: {
      collect: { numberOfRuns: runs, url: urls, settings },
      assert: { assertions },
      upload: { target: 'filesystem', outputDir: String(outDir).replaceAll('\\', '/') },
    },
  }, null, 2)};\n`;
}

// PRD §8.8: runWarnings LH ikut ke run_logs (`system`); tahan nilai yang bukan JSON valid.
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

// Halaman pemilih device untuk mode both. Statis, tanpa dependency; hash #mobile/#desktop memilih tab awal.
export function lighthouseDeviceReport(rows, locale = 'id') {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const devices = ['mobile', 'desktop'];
  const tab = (name, label) => `<button type="button" data-tab="${name}">${label}</button>`;
  const panels = devices.map(name => {
    const items = (rows ?? []).filter(r => r.formFactor === name && r.reportPath);
    const options = items.map(r => `<option value="${esc(r.reportPath)}">${esc(r.url)}</option>`).join('');
    const src = items[0]?.reportPath ?? 'about:blank';
    return `<section class="panel" data-panel="${name}">
  ${items.length > 1 ? `<label>URL <select data-src>${options}</select></label>` : `<p class="url">${esc(items[0]?.url ?? 'Report tidak tersedia')}</p>`}
  <iframe title="Report ${name}" src="${esc(src)}" loading="lazy"></iframe>
</section>`;
  }).join('');
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : 'id'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report Lighthouse</title>
<style>
:root{color-scheme:light dark}body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
.tabs{display:flex;gap:4px;padding:8px 10px;background:#1e293b}.tabs button{border:0;border-radius:6px;padding:8px 14px;background:transparent;color:#cbd5e1;font:inherit;cursor:pointer}.tabs button.active{background:#38bdf8;color:#082f49;font-weight:600}
.panel{display:none}.panel.active{display:block}.panel label{display:flex;gap:8px;align-items:center;padding:8px 12px}.panel .url{padding:8px 12px;margin:0;color:#cbd5e1;overflow-wrap:anywhere}
iframe{display:block;width:100%;height:calc(100vh - 58px);border:0;background:#fff}
</style></head><body>
<nav class="tabs" role="tablist">${tab('mobile', 'Mobile')}${tab('desktop', 'Desktop')}</nav>
${panels}
<script>
const panels = [...document.querySelectorAll('[data-panel]')];
const tabs = [...document.querySelectorAll('[data-tab]')];
function show(name) {
  const active = name === 'desktop' ? 'desktop' : 'mobile';
  for (const panel of panels) panel.classList.toggle('active', panel.dataset.panel === active);
  for (const button of tabs) button.classList.toggle('active', button.dataset.tab === active);
  if (location.hash.slice(1) !== active) history.replaceState(null, '', '#' + active);
}
for (const button of tabs) button.addEventListener('click', () => show(button.dataset.tab));
for (const select of document.querySelectorAll('select[data-src]')) select.addEventListener('change', () => {
  select.closest('[data-panel]').querySelector('iframe').src = select.value;
});
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || 'mobile');
</script></body></html>`;
}

// Ambil baris JSONL lengkap sejak `offset`; baris terakhir tanpa newline ditinggal agar write terpotong tidak terbaca.
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

  liveDir(runId) { return join(this.directory(runId), 'live'); }

  controlPath(runId) { return join(this.directory(runId), 'control.json'); }

  async start(runId, testFile, sessionId = null, targetUrl = null, options = {}) {
    // Antrekan, jangan tolak: hanya satu proses tool sekaligus; `this.chain` selalu di-catch agar satu run gagal tidak mematikan antrean.
    const run = (this.chain ?? Promise.resolve()).then(() => this._start(runId, testFile, sessionId, targetUrl, options));
    const tail = run.catch(() => {});
    this.chain = tail;
    // Jangan biarkan rantai promise tumbuh selama proses hidup.
    tail.finally(() => { if (this.chain === tail) this.chain = null; });
    return run;
  }

  async _start(runId, testFile, sessionId, targetUrl, options = {}) {
    // Run bisa dibatalkan saat masih antre; jangan dijalankan sama sekali.
    if (this.store.getRun(runId)?.status === 'cancelled') return;
    // Baris `system` bisa sudah ditulis route sebelum runner jalan; mulai seq dari yang ada agar tidak bentrok primary key.
    const state = { runId, sessionId, testFile, targetUrl, options, seq: this.store.lastLogSeq(runId), chain: Promise.resolve(), child: null, cancelled: false, startTime: Date.now() };
    this.active = state;
    state.done = this.execute(state).finally(() => { this.active = null; });
    return state.done;
  }

  // Kontrol debug dari dashboard. File, bukan IPC: test berjalan di proses
  // worker Playwright yang terpisah dan tidak punya kanal balik ke server.
  async control(runId, action) {
    const run = this.store.getRun(runId);
    if (!run) throw Object.assign(new Error('Data tidak ditemukan'), { status: 404 });
    if (run.status !== 'running') throw Object.assign(new Error('Run tidak sedang berjalan'), { status: 409 });
    const mode = action === 'resume' ? 'run'
      : action === 'pause' || action === 'step' || action === 'skip' ? action
      : null;
    if (!mode) throw Object.assign(new Error('Aksi kontrol tidak dikenal'), { status: 400 });
    // Run yang sedang berjalan sudah punya folder, tapi mkdir membuat kontrol
    // tetap aman kalau dipanggil tepat saat run baru mulai.
    await mkdir(dirname(this.controlPath(runId)), { recursive: true }).catch(() => {});
    await writeFile(this.controlPath(runId), JSON.stringify({ mode, at: Date.now() }));
    return { mode };
  }

  async controlState(runId) {
    const raw = await readFile(this.controlPath(runId), 'utf8').catch(() => null);
    let mode = 'run';
    try { mode = JSON.parse(raw)?.mode ?? 'run'; } catch { /* file belum ada */ }
    const stateRaw = await readFile(this.controlPath(runId) + '.state', 'utf8').catch(() => null);
    let state = null;
    try { state = JSON.parse(stateRaw); } catch { /* checkpoint belum tercapai */ }
    return { mode, state };
  }

  async liveFrames(runId) {
    const dir = this.liveDir(runId);
    const names = (await readdir(dir).catch(() => [])).filter(f => /^frame-\d+\.jpg$/.test(f));
    // Urut numerik: nama file memuat epoch ms, dan sort string akan salah
    // kalau panjang angkanya berbeda (mis. frame uji 1000 vs 10000).
    return names.map(name => {
      const n = Number(name.slice(6, -4));
      return { n, at: new Date(n).toISOString() };
    }).sort((a, b) => a.n - b.n);
  }

  liveFramePath(runId, n) {
    return Number.isSafeInteger(n) && n > 0 ? join(this.liveDir(runId), `frame-${n}.jpg`) : null;
  }

  // Sisa frame setelah run selesai: cukup 1 menit terakhir untuk scrub.
  async cleanupLive(runId) {
    const dir = this.liveDir(runId);
    const names = (await readdir(dir).catch(() => []))
      .filter(f => /^frame-\d+\.jpg$/.test(f))
      .map(name => ({ name, n: Number(name.slice(6, -4)) }))
      .sort((a, b) => a.n - b.n);
    for (const { name } of names.slice(0, Math.max(0, names.length - LIVE_FRAMES_KEPT))) {
      await unlink(join(dir, name)).catch(() => {});
    }
    await unlink(this.controlPath(runId)).catch(() => {});
    await unlink(this.controlPath(runId) + '.state').catch(() => {});
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

  // URL project per env: dipakai untuk menggeser URL config ke origin sesi.
  projectUrlsFor(state) {
    const session = state.sessionId ? this.store.getSession(state.sessionId) : null;
    const project = session ? this.store.getProject(session.project_id) : null;
    return [project?.base_url, project?.staging_url, project?.local_url].filter(Boolean);
  }

  // Origin yang boleh ditembak runner: allowlist server + project (base/staging/local + projects.origins); env local ikut dicek.
  allowedOriginsFor(state) {
    const session = state.sessionId ? this.store.getSession(state.sessionId) : null;
    const project = session ? this.store.getProject(session.project_id) : null;
    const declared = [project?.base_url, project?.staging_url, project?.local_url]
      .filter(Boolean).map(v => { try { return new URL(v).origin; } catch { return null; } }).filter(Boolean);
    return [...this.origins, ...(project?.origins ?? []), ...declared];
  }

  async execute(state) {
    const { runId, testFile } = state;
    // PRD §7/G11: runner tidak percaya pemanggil, target harus tetap di allowlist; origin project ikut diizinkan.
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
    const runTimeout = state.options?.debug ? DEBUG_RUN_TIMEOUT_MS : this.timeout;
    this.arm(state, testFile.tool === 'lh' ? lhTimeout(...lhAuditShape(testFile, state.targetUrl)) : runTimeout);

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
      // Frame live dan file kontrol tidak boleh tertinggal setelah run final.
      if (testFile.tool === 'pw') await this.cleanupLive(runId).catch(() => {});
    }
    this.emit('status', { type: 'status', runId, run: await this.store.getRun(runId) });
  }

  // Jalankan satu spec Playwright langsung (fase 1: CLI lokal menjalankan).
  async runPlaywright(state) {
    const { runId, testFile, targetUrl } = state;
    const dir = this.directory(runId);
    await this.log(state, 'system', `[runner] Menjalankan Playwright ${testFile.path}\n`);
    if (state.options?.debug) {
      await this.log(state, 'system', `[runner] Mode debug: slowMo ${Number(state.options.slowMo) || 400}ms, pause/step aktif, timeout ${DEBUG_TEST_TIMEOUT_MS / 60000} menit\n`);
    }
    if (state.options?.recordVideo) await this.log(state, 'system', '[runner] Merekam video tiap test\n');
    let specPath = testFile.path.replaceAll('\\', '/'); // relatif: path absolut Windows dibaca Playwright sebagai regex
    const captureFile = join(dir, 'capture.jsonl');
    // Layar live + kanal kontrol debug. Keduanya file-based karena worker
    // Playwright tidak punya koneksi balik ke proses server.
    const liveDir = this.liveDir(runId);
    await mkdir(liveDir, { recursive: true }).catch(() => {});
    await writeFile(this.controlPath(runId), JSON.stringify({ mode: 'run', at: Date.now() })).catch(() => {});
    const env = {
      ...process.env,
      ...(targetUrl ? { BASE_URL: targetUrl } : {}),
      PLAYBOOK_CAPTURE_FILE: captureFile,
      PLAYBOOK_LIVE_DIR: liveDir,
      PLAYBOOK_CONTROL_FILE: this.controlPath(runId),
      // Preload: page events are only reachable from inside the worker.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${pwCapture}`].filter(Boolean).join(' '),
      PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, 'artifacts', 'report.json'),
      // Report HTML ditulis ke folder run supaya bisa disajikan sebagai artifact.
      PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, 'artifacts', 'playwright-report'),
    };
    // `config` opsional: { configPath } untuk config Playwright khusus (quick check).
    const parsedCfg = (() => { try { return JSON.parse(testFile.config ?? '{}') ?? {}; } catch { return {}; } })();
    // Opsi dashboard menang atas config tersimpan: user memilihnya per run.
    const pwCfg = {
      ...parsedCfg,
      ...(state.options?.recordVideo ? { recordVideo: true } : {}),
      ...(state.options?.debug
        ? { debug: true, slowMo: Number(state.options.slowMo) || 400, timeout: DEBUG_TEST_TIMEOUT_MS }
        : {}),
    };
    let cfgPath = parsedCfg.configPath ?? null;
    // Kode dari DB (editor dashboard) menang atas file di disk. Ditulis di sebelah
    // spec aslinya karena spec eureka mengimpor `./creds` - memindahkan file ke
    // folder run akan memutus import relatif. Config ditaruh di root repo supaya
    // `@playwright/test` bisa di-resolve. Keduanya dihapus setelah run.
    let generated = null;
    let generatedCfg = null;
    if (testFile.code?.trim()) {
      const original = join(root, testFile.path);
      generated = join(dirname(original), `.playbook-${runId.slice(0, 8)}.spec.ts`);
      // Folder spec bisa belum ada; buat dulu agar error ENOENT mentah tidak muncul.
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
    // `--output` (test-results) harus terpisah dari report HTML; bersarang membuat Playwright menolak.
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

    // Parse hasil JSON Playwright → playwright_results
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
    // Prune frame sebelum status final: UI berhenti polling saat final, jadi
    // daftar frame yang dilihatnya harus sudah final juga (tidak menaut 404).
    await this.cleanupLive(runId);
    const finishedAt = new Date().toISOString();
    await this.writeRunJson(state, dir, { status, exitCode: code, error, mode: 'pw', finishedAt });
    // Status final di-patch paling akhir: UI berhenti polling saat final, jadi artifact harus sudah masuk DB.
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
    const artifactsRoot = join(dir, 'artifacts');
    await mkdir(artifactsRoot, { recursive: true });
    // Config digenerate dari test_files.config (PRD §8.3); tanpa ini env local/staging tetap menembak URL produksi di file repo.
    const cfg = (() => { try { return JSON.parse(testFile.config ?? 'null'); } catch { return null; } })();
    // UI tidak lagi menyediakan pilihan device: setiap run Lighthouse mengaudit mobile lalu desktop.
    const formFactor = 'both';
    const devices = ['mobile', 'desktop'];
    const allowed = this.allowedOriginsFor(state);
    const projectUrls = this.projectUrlsFor(state);
    // Origin URL tambahan divalidasi sebelum spawn: config bisa ditulis CLI.
    const lhConfigs = devices.map(device => {
      if (!cfg) return null;
      const workspace = formFactor === 'both' ? join(dir, 'lh', device) : dir;
      const outDir = formFactor === 'both' ? join(artifactsRoot, device) : artifactsRoot;
      return { device, workspace, outDir, body: lhConfig(cfg, targetUrl, outDir, { allowedOrigins: allowed, projectUrls, device }) };
    });
    const audited = lhUrls(cfg, targetUrl, projectUrls);
    await this.log(state, 'system', `[runner] Config LH ${devices.join(' + ')} (${cfg?.numberOfRuns ?? 1}x, ${audited.length} URL)\n`);
    // cwd terisolasi per device: lhci menulis .lighthouseci/ relatif cwd, console/network LH muncul setelah audit selesai.
    await this.log(state, 'system', '[runner] Console & network Lighthouse diambil dari LHR dan muncul setelah audit selesai.\n');

    const specs = [];
    let exitCode = 0;
    for (const device of devices) {
      if (state.cancelled || state.timedOut) break;
      const generated = lhConfigs.find(c => c?.device === device);
      const workspace = generated?.workspace ?? dir;
      const outDir = generated?.outDir ?? artifactsRoot;
      await mkdir(workspace, { recursive: true });
      await mkdir(outDir, { recursive: true });
      let configPath = isAbsolute(testFile.path) ? testFile.path : join(root, testFile.path);
      if (generated) {
        configPath = join(workspace, 'lighthouserc.cjs');
        await writeFile(configPath, generated.body);
      }
      specs.push({ formFactor: device, artifactsDir: outDir, lhciDir: join(workspace, '.lighthouseci'), reportRoot: artifactsRoot });
      await this.log(state, 'system', `[runner] Lighthouse ${device} dimulai\n`);

      let code = 1;
      try {
        const child = spawn(process.execPath, [lhciBin, 'autorun', '--config=' + configPath, '--upload.target=filesystem', '--upload.outputDir=' + outDir], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        state.child = child;
        child.stdout.on('data', d => this.log(state, 'stdout', d));
        child.stderr.on('data', d => this.log(state, 'stderr', d));
        code = await new Promise(res => { child.on('close', res); child.on('error', e => { this.log(state, 'stderr', e.message + '\n'); res(1); }); });
      } catch (error) {
        await this.log(state, 'stderr', error.message + '\n');
      }
      state.child = null;
      await state.chain;
      if (code !== 0) exitCode = code || 1;
      await this.log(state, 'system', `[runner] Lighthouse ${device} selesai (exit ${code})\n`);
    }

    const results = await this.parseLighthouse(dir, state, specs);
    // Mode both: satu halaman pemilih device; hash #mobile/#desktop dipasang UI.
    if (formFactor === 'both' && results.length) {
      const page = lighthouseDeviceReport(results, cfg?.locale);
      const reportPath = 'lh-report.html';
      const ok = await writeFile(join(artifactsRoot, reportPath), page).then(() => true).catch(() => false);
      if (ok) for (const r of results) r.reportPath = reportPath;
    }
    const status = state.cancelled ? 'cancelled' : state.timedOut ? 'failed' : !results.length ? 'failed' : exitCode === 0 ? 'passed' : 'failed';
    const error = state.timedOut ? 'timeout' : !results.length && !state.cancelled ? 'JSON Lighthouse tidak ditemukan' : null;
    if (results.length) await this.store.addLighthouseResults(runId, results);
    // PRD §8.8: runWarnings LH juga tampil di terminal, bukan cuma kolom warnings.
    for (const line of warningLines(results)) await this.log(state, 'system', line);
    await this.collectArtifacts(runId, dir, 'lh');
    const finishedAt = new Date().toISOString();
    await this.writeRunJson(state, dir, { status, exitCode, error, mode: 'lh', finishedAt });
    // Sama seperti Playwright: artifact dulu, status final terakhir.
    await this.store.patchRun(runId, {
      status,
      error,
      finished_at: finishedAt,
      exit_code: exitCode,
      duration_ms: Date.now() - state.startTime,
      finalized_at: finishedAt,
    });
    this.store.markReportsStale(state.sessionId);
  }

  // PRD §8.8: console/network reporter masuk run_logs sebagai stream terpisah; tail live agar panel terisi sebelum run selesai.
  async tailCapture(state, file, interval = 700) {
    let offset = 0;
    // Dua drain bisa tumpang tindih saat baca lambat; tanpa penjaga, offset lama membuat baris masuk dua kali.
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

  // Console & network Lighthouse dari LHR (audits.network-requests/errors-in-console), format JSON sama dengan reporter Playwright.
  // ponytail: dipotong 500 request/halaman; naikkan kalau perlu (log_max_bytes 5 MB tetap batas akhir).
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

  // Baca LHR/report dari `.lighthouseci/` juga: upload filesystem menyalin belakangan, jadi skor tetap ada saat run dibunuh sebelum upload.
  // `devices` kosong = layout lama (artifacts/ + .lighthouseci/ di root run). Mode both memakai satu entri per device.
  async parseLighthouse(dir, state = null, devices = null) {
    const rootArtifacts = join(dir, 'artifacts');
    const list = devices ?? [{
      formFactor: 'mobile',
      artifactsDir: rootArtifacts,
      lhciDir: join(dir, '.lighthouseci'),
      reportRoot: rootArtifacts,
    }];
    const out = [];
    for (const device of list) {
      const rows = await this.parseLighthouseDevice(state, device);
      for (const row of rows) out.push({ ...row, formFactor: device.formFactor });
    }
    return out;
  }

  async parseLighthouseDevice(state, { artifactsDir, lhciDir, reportRoot }) {
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
      if (m.url && m.htmlPath) htmlByUrl.set(m.url, relative(reportRoot, m.htmlPath).replaceAll('\\', '/'));
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
      const dest = join(artifactsDir, 'lh-' + name);
      const ok = await copyFile(join(lhrDir, name), dest).then(() => true).catch(() => false);
      if (ok) row.reportPath = relative(reportRoot, dest).replaceAll('\\', '/');
    }
    return [...out.values()];
  }
  // Snapshot run untuk pipeline laporan HTML; kode spec sengaja tidak ikut agar tidak bocor ke report statis.
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
