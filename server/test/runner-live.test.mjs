// Kontrak runner untuk panel layar: config Playwright (video/debug), frame live,
// dan kanal kontrol pause/step berbasis file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { Runner, runConfig, DEBUG_TEST_TIMEOUT_MS } from '../runner.mjs';

async function fixture(t) {
  const store = new Store(':memory:');
  await store.init();
  const runsDir = await mkdtemp(join(tmpdir(), 'pb-runner-live-'));
  const now = new Date().toISOString();
  store.db.prepare(`INSERT INTO projects (id, slug, name, base_url, origins, allow_production, active, created_at)
    VALUES ('p1','p1','P1','http://127.0.0.1:4173','[]',0,1,?)`).run(now);
  store.createSession({ id: 's1', projectId: 'p1', env: 'local', targetUrl: 'http://127.0.0.1:4173', label: 'S', createdBy: null });
  store.createRun({ id: 'r1', sessionId: 's1', testFileId: null, tool: 'pw' });
  const runner = new Runner(store, { runsDir });
  t.after(async () => { store.close(); await rm(runsDir, { recursive: true, force: true }); });
  return { store, runner };
}

test('runConfig: video opt-in, trace, slowMo debug, dan timeout debug', () => {
  const biasa = runConfig('specs', 'a.spec.ts', {});
  assert.ok(!biasa.includes("video: 'on'"), 'video tidak direkam tanpa opt-in');
  assert.ok(biasa.includes("trace: \"retain-on-failure\""));
  assert.ok(!biasa.includes('slowMo'));
  assert.ok(biasa.includes('timeout: 120000'));

  const rekam = runConfig('specs', 'a.spec.ts', { recordVideo: true });
  assert.ok(rekam.includes("video: 'on'"));

  const debug = runConfig('specs', 'a.spec.ts', { debug: true, timeout: DEBUG_TEST_TIMEOUT_MS });
  assert.ok(debug.includes('trace: "on"'), 'debug merekam trace penuh');
  assert.ok(debug.includes('launchOptions: { slowMo: 400 }'));
  assert.ok(debug.includes(`timeout: ${DEBUG_TEST_TIMEOUT_MS}`));
});

test('liveFrames: hanya frame-*.jpg, urut, dan nomor tidak sah ditolak', async t => {
  const { runner } = await fixture(t);
  const dir = runner.liveDir('r1');
  await mkdir(dir, { recursive: true });
  for (const n of [3000, 1000, 2000]) await writeFile(join(dir, `frame-${n}.jpg`), 'x');
  await writeFile(join(dir, 'latest.jpg'), 'x');
  await writeFile(join(dir, '.frame-9.jpg.tmp'), 'x');

  const frames = await runner.liveFrames('r1');
  assert.deepEqual(frames.map(f => f.n), [1000, 2000, 3000]);
  assert.equal(frames[0].at, new Date(1000).toISOString());

  assert.equal(runner.liveFramePath('r1', 0), null);
  assert.equal(runner.liveFramePath('r1', -1), null);
  assert.equal(runner.liveFramePath('r1', 1.5), null);
  assert.equal(runner.liveFramePath('r1', 1000), join(dir, 'frame-1000.jpg'));
});

test('control: pause/step/resume lewat file, guard status dan aksi', async t => {
  const { store, runner } = await fixture(t);
  await assert.rejects(() => runner.control('r1', 'pause'), /belum|tidak sedang berjalan/);
  store.patchRun('r1', { status: 'running' });

  assert.deepEqual(await runner.control('r1', 'pause'), { mode: 'pause' });
  assert.equal((await runner.controlState('r1')).mode, 'pause');
  await writeFile(runner.controlPath('r1') + '.state', JSON.stringify({ label: 'Isi Email', at: 123 }));
  assert.deepEqual((await runner.controlState('r1')).state, { label: 'Isi Email', at: 123 });

  assert.deepEqual(await runner.control('r1', 'step'), { mode: 'step' });
  assert.deepEqual(await runner.control('r1', 'resume'), { mode: 'run' });
  await assert.rejects(() => runner.control('r1', 'hapus'), /tidak dikenal/);

  store.patchRun('r1', { status: 'passed' });
  await assert.rejects(() => runner.control('r1', 'pause'), /tidak sedang berjalan/);
});

test('cleanupLive: sisakan 60 frame terakhir dan buang file kontrol', async t => {
  const { store, runner } = await fixture(t);
  store.patchRun('r1', { status: 'running' });
  const dir = runner.liveDir('r1');
  await mkdir(dir, { recursive: true });
  for (let i = 1; i <= 65; i++) await writeFile(join(dir, `frame-${i * 1000}.jpg`), 'x');
  await runner.control('r1', 'pause');
  await writeFile(runner.controlPath('r1') + '.state', '{}');

  await runner.cleanupLive('r1');

  const left = (await readdir(dir)).filter(f => /^frame-\d+\.jpg$/.test(f))
    .map(name => ({ name, n: Number(name.slice(6, -4)) }))
    .sort((a, b) => a.n - b.n)
    .map(x => x.name);
  assert.equal(left.length, 60);
  assert.equal(left[0], 'frame-6000.jpg');
  assert.equal(left.at(-1), 'frame-65000.jpg');
  assert.deepEqual(await readdir(runner.directory('r1')), ['live']);
});

test('cleanupLive: tidak melempar untuk run tanpa folder', async t => {
  const { runner } = await fixture(t);
  await runner.cleanupLive('tidak-ada');
  assert.equal((await readFile(runner.controlPath('tidak-ada'), 'utf8').catch(() => 'hilang')), 'hilang');
});
