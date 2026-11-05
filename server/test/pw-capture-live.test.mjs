// Preload menulis frame layar live tanpa membuka browser: page palsu cukup
// menyediakan screenshot(), isClosed(), dan on().
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('pw-capture: frame layar live ditulis atomik, dibatasi, dan berhenti saat page ditutup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-live-'));
  const live = join(dir, 'live');
  process.env.PLAYBOOK_LIVE_DIR = live;
  process.env.PLAYBOOK_LIVE_INTERVAL_MS = '100';
  process.env.PLAYBOOK_LIVE_MAX_FRAMES = '3';
  delete process.env.PLAYBOOK_CAPTURE_FILE;
  require('../../scripts/pw-capture.cjs');

  const page = new EventEmitter();
  page.screenshot = async () => Buffer.from('jpeg');
  page.isClosed = () => false;

  const context = new EventEmitter();
  context.emit('page', page);
  // Interval minimum 100ms (lindungi CPU), jadi tunggu 4 tick lalu tutup.
  await sleep(460);
  page.emit('close');
  await sleep(120);

  const files = await readdir(live);
  const frames = files.filter(f => /^frame-\d+\.jpg$/.test(f));
  const latest = await readFile(join(live, 'latest.jpg'), 'utf8').catch(() => null);
  await rm(dir, { recursive: true, force: true });

  assert.ok(frames.length >= 2, `frame kurang: ${files.join(',')}`);
  assert.ok(frames.length <= 3, `cap tidak jalan: ${frames.length}`);
  assert.ok(files.includes('latest.jpg'), 'frame terbaru harus ada');
  assert.ok(!files.some(f => f.startsWith('.')), `file tmp tersisa: ${files.join(',')}`);
  assert.equal(latest, 'jpeg');
});
