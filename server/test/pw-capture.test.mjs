// The capture preload patches EventEmitter, so it can be exercised without a
// browser: emit the same events Playwright emits and inspect the JSONL output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('pw-capture: console, pageerror, network, deduped across emitters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-capture-'));
  const file = join(dir, 'capture.jsonl');
  process.env.PLAYBOOK_CAPTURE_FILE = file;
  require('../../scripts/pw-capture.cjs');

  const emitter = new EventEmitter();
  const consoleMessage = { type: () => 'error', text: () => 'boom', location: () => ({ url: 'https://a.test/x.js' }) };
  const pageError = new Error('kaboom');
  const request = { method: () => 'GET', url: () => 'https://a.test/' };
  const response = { url: () => 'https://a.test/', status: () => 404, request: () => request };

  emitter.emit('request', request);
  emitter.emit('response', response);
  emitter.emit('response', response); // second emitter relaying the same object
  emitter.emit('console', consoleMessage);
  emitter.emit('pageerror', pageError);
  emitter.emit('requestfailed', { url: () => 'https://a.test/x', method: () => 'POST', failure: () => ({ errorText: 'net::ERR_FAILED' }) });

  const rows = (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  await rm(dir, { recursive: true, force: true });

  assert.equal(rows.length, 4, 'response deduped, everything else kept');
  assert.deepEqual(rows[0], { stream: 'network', payload: { url: 'https://a.test/', method: 'GET', status: 404, failure: null, ms: 0 } });
  assert.deepEqual(rows[1], { stream: 'console', payload: { type: 'error', text: 'boom', location: 'https://a.test/x.js' } });
  assert.deepEqual(rows[2], { stream: 'console', payload: { type: 'pageerror', text: 'kaboom', location: null } });
  assert.deepEqual(rows[3].payload, { url: 'https://a.test/x', method: 'POST', status: null, failure: 'net::ERR_FAILED', ms: null });
});

