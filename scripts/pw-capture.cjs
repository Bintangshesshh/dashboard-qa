// Captures console + network for every Playwright run, including specs that
// create pages themselves. Playwright exposes no per-page reporter hook, so this
// preload (NODE_OPTIONS=--require) taps the events Page and BrowserContext emit.
// Both emitters fire for the same payload, hence the seen-set dedupe.
const { appendFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');

const out = process.env.PLAYBOOK_CAPTURE_FILE;
if (out) {
  const MAX_LINES = 3000;
  let lines = 0;
  const emit = (stream, payload) => {
    if (lines > MAX_LINES) return;
    if (lines++ === MAX_LINES) {
      appendFileSync(out, JSON.stringify({ stream: 'system', payload: { text: `[capture] capped at ${MAX_LINES} lines` } }) + '\n');
      return;
    }
    appendFileSync(out, JSON.stringify({ stream, payload }) + '\n');
  };

  const originalEmit = EventEmitter.prototype.emit;
  const startedAt = new WeakMap();
  const seen = new WeakSet();

  EventEmitter.prototype.emit = function (event, ...args) {
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
