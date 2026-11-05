// Captures console + network for every Playwright run, including specs that
// create pages themselves. Playwright exposes no per-page reporter hook, so this
// preload (NODE_OPTIONS=--require) taps the events Page and BrowserContext emit.
// Both emitters fire for the same payload, hence the seen-set dedupe.
//
// Also streams the visible page as JPEG frames (PLAYBOOK_LIVE_DIR) so the
// dashboard can show what the bot is doing while the run is still going.
const { appendFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');

const out = process.env.PLAYBOOK_CAPTURE_FILE;
const liveDir = process.env.PLAYBOOK_LIVE_DIR;

if (out || liveDir) {
  const MAX_LINES = 3000;
  let lines = 0;
  const emit = (stream, payload) => {
    if (!out) return;
    if (lines > MAX_LINES) return;
    if (lines++ === MAX_LINES) {
      appendFileSync(out, JSON.stringify({ stream: 'system', payload: { text: `[capture] capped at ${MAX_LINES} lines` } }) + '\n');
      return;
    }
    appendFileSync(out, JSON.stringify({ stream, payload }) + '\n');
  };

  // ── Frame layar live ─────────────────────────────────────────────────────
  const intervalMs = Math.max(100, Number(process.env.PLAYBOOK_LIVE_INTERVAL_MS) || 1000);
  const maxFrames = Math.max(1, Number(process.env.PLAYBOOK_LIVE_MAX_FRAMES) || 600);
  const framesStarted = new WeakSet();
  const frameFiles = [];
  if (liveDir) {
    try { mkdirSync(liveDir, { recursive: true }); } catch { /* capture tidak boleh gagal */ }
  }

  const writeAtomic = (name, body) => {
    const tmp = join(liveDir, `.${name}.tmp`);
    writeFileSync(tmp, body);
    renameSync(tmp, join(liveDir, name));
  };

  const startFrames = (page) => {
    if (!liveDir) return;
    if (!page || typeof page.screenshot !== 'function' || framesStarted.has(page)) return;
    framesStarted.add(page);
    let busy = false;
    const takeFrame = async () => {
      if (busy) return;
      busy = true;
      try {
        if (typeof page.isClosed === 'function' && page.isClosed()) return;
        const shot = await page.screenshot({ type: 'jpeg', quality: 45, timeout: 2000 });
        const n = Date.now();
        writeAtomic(`frame-${n}.jpg`, shot);
        writeAtomic('latest.jpg', shot);
        frameFiles.push(`frame-${n}.jpg`);
        while (frameFiles.length > maxFrames) {
          const old = frameFiles.shift();
          try { unlinkSync(join(liveDir, old)); } catch { /* sudah hilang */ }
        }
      } catch {
        // Navigasi/penutupan page bisa membuat screenshot gagal sesaat.
        // Frame berikutnya menyusul; capture tidak boleh menggagalkan test.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(takeFrame, intervalMs);
    // unref: interval tidak boleh menahan proses worker tetap hidup.
    if (typeof timer.unref === 'function') timer.unref();
    // Test pendek (<1 dtk) tidak akan pernah kena tick pertama; ambil frame
    // saat page dibuat dan saat navigasi selesai supaya tetap ada bukti visual.
    takeFrame();
    for (const event of ['domcontentloaded', 'load']) {
      try { page.on(event, () => { takeFrame(); }); } catch { /* bukan emitter */ }
    }
    if (typeof page.on === 'function') {
      try { page.on('close', () => clearInterval(timer)); } catch { /* bukan emitter */ }
    }
  };

  // ── Console + network ────────────────────────────────────────────────────
  const originalEmit = EventEmitter.prototype.emit;
  const startedAt = new WeakMap();
  const seen = new WeakSet();

  // ── Hook browser ─────────────────────────────────────────────────────────
  // Page dibuat oleh emitter internal Playwright (bukan EventEmitter Node),
  // jadi event `page` tidak terlihat dari patch di bawah. Bungkus launch/newPage
  // supaya setiap page baru langsung mulai mengambil frame.
  const attachContext = (ctx) => {
    if (!ctx || ctx.__pbLiveHooked) return;
    ctx.__pbLiveHooked = true;
    try { for (const p of ctx.pages()) startFrames(p); } catch { /* bukan context */ }
    try { ctx.on('page', p => startFrames(p)); } catch { /* emitter lain */ }
    const origNewPage = ctx.newPage;
    if (typeof origNewPage === 'function') {
      ctx.newPage = async function (...args) {
        const p = await origNewPage.apply(this, args);
        try { startFrames(p); } catch { /* capture tidak boleh gagal */ }
        return p;
      };
    }
  };

  const attachBrowser = (browser) => {
    if (!browser || browser.__pbLiveHooked) return;
    browser.__pbLiveHooked = true;
    try { for (const c of browser.contexts()) attachContext(c); } catch { /* bukan browser */ }
    try { browser.on('context', c => attachContext(c)); } catch { /* emitter lain */ }
    for (const method of ['newContext', 'newPage']) {
      const orig = browser[method];
      if (typeof orig !== 'function') continue;
      browser[method] = async function (...args) {
        const out = await orig.apply(this, args);
        try { method === 'newContext' ? attachContext(out) : startFrames(out); } catch { /* idem */ }
        return out;
      };
    }
  };

  const hookBrowser = () => {
    if (!liveDir) return;
    let chromium;
    try { ({ chromium } = require('playwright-core')); } catch { return; }
    const proto = chromium && Object.getPrototypeOf(chromium);
    if (!proto || proto.__pbLiveHooked) return;
    proto.__pbLiveHooked = true;
    const launch = proto.launch;
    if (typeof launch === 'function') {
      proto.launch = async function (...args) {
        const browser = await launch.apply(this, args);
        try { attachBrowser(browser); } catch { /* capture tidak boleh gagal */ }
        return browser;
      };
    }
    const persistent = proto.launchPersistentContext;
    if (typeof persistent === 'function') {
      proto.launchPersistentContext = async function (...args) {
        const ctx = await persistent.apply(this, args);
        try { attachContext(ctx); } catch { /* idem */ }
        return ctx;
      };
    }
  };

  hookBrowser();

  EventEmitter.prototype.emit = function (event, ...args) {
    if (event === 'page' && args[0]) {
      try { startFrames(args[0]); } catch { /* capture tidak boleh gagal */ }
    }

    const payload = args[0];
    if (payload && typeof payload === 'object') {
      if (event === 'request') {
        if (!startedAt.has(payload)) startedAt.set(payload, Date.now());
      } else if (event === 'console' || event === 'pageerror' || event === 'response' || event === 'requestfailed') {
        if (!seen.has(payload)) {
          seen.add(payload);
          try {
            if (event === 'console') {
              emit('console', { type: payload.type(), text: payload.text(), location: payload.location()?.url || null });
            } else if (event === 'pageerror') {
              // Page emits an Error; BrowserContext emits { error, page }.
              const err = payload.error ?? payload;
              emit('console', { type: 'pageerror', text: err.message ?? String(err), location: null });
            } else if (event === 'requestfailed') {
              emit('network', {
                url: payload.url(), method: payload.method(), status: null,
                failure: payload.failure()?.errorText ?? 'failed', ms: null,
              });
            } else {
              const url = payload.url();
              if (!url.startsWith('data:') && !url.startsWith('blob:')) {
                const start = startedAt.get(payload.request());
                emit('network', {
                  url, method: payload.request().method(), status: payload.status(), failure: null,
                  ms: start ? Date.now() - start : null,
                });
              }
            }
          } catch {
            // Capture must never break a test.
          }
        }
      }
    }
    return originalEmit.call(this, event, ...args);
  };
}
