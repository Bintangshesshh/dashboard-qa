// Uji pemotong baris capture.jsonl + tail live: console/network harus masuk
// run_logs saat run masih berjalan, bukan setelah proses selesai.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutCaptureLines, Runner } from '../runner.mjs';

// Tunggu kondisi sampai ~3 dtk: timer tail bisa tertunda di mesin sibuk,
// jadi jangan pakai sleep tetap yang bikin tes flaky.
async function waitFor(check, message, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.fail(message);
}

test('cutCaptureLines: ambil baris lengkap, sisakan ekor parsial', () => {
  const raw = '{"a":1}\n{"a":2}\n{"a":3}';
  const cut = cutCaptureLines(raw, 0);
  assert.deepEqual(cut.lines, ['{"a":1}', '{"a":2}']);
  assert.equal(cut.offset, 16, 'offset tepat setelah newline terakhir');
});

test('cutCaptureLines: lanjut dari offset tanpa mengulang baris', () => {
  const raw = 'satu\ndua\n';
  const first = cutCaptureLines(raw, 0);
  assert.deepEqual(first.lines, ['satu', 'dua']);
  const next = cutCaptureLines(raw + 'tiga\n', first.offset);
  assert.deepEqual(next.lines, ['tiga']);
  assert.equal(next.offset, raw.length + 5);
});

test('cutCaptureLines: file menyusut → offset direset', () => {
  const cut = cutCaptureLines('a\n', 99);
  assert.deepEqual(cut.lines, []);
  assert.equal(cut.offset, 0);
});

test('cutCaptureLines: belum ada newline → tidak ada baris, offset tetap', () => {
  const cut = cutCaptureLines('{"belum":"selesai"', 0);
  assert.deepEqual(cut.lines, []);
  assert.equal(cut.offset, 0);
});

test('cutCaptureLines: baris kosong dibuang', () => {
  const cut = cutCaptureLines('a\n\n  \nb\n', 0);
  assert.deepEqual(cut.lines, ['a', 'b']);
});

test('tailCapture: console/network masuk log saat run masih berjalan', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-tail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const logged = [];
  const store = { log: async (runId, entry) => { logged.push(entry); } };
  const runner = new Runner(store, { runsDir: dir });

  const runId = 'r1';
  await mkdir(join(dir, runId), { recursive: true });
  const file = join(dir, runId, 'capture.jsonl');
  const state = { runId, seq: 0, chain: Promise.resolve() };

  const stop = await runner.tailCapture(state, file, 20);
  await appendFile(file, JSON.stringify({ stream: 'console', payload: { type: 'log', text: 'halo' } }) + '\n');
  // Tunggu sampai tail benar-benar membaca; jangan bergantung pada satu timer.
  await waitFor(() => logged.some(e => e.stream === 'console'), 'console harus tercatat sebelum stopTail');
  assert.equal(logged.filter(e => e.stream === 'console').length, 1, 'tidak boleh dobel');

  await appendFile(file, JSON.stringify({ stream: 'network', payload: { url: '/x', status: 200 } }) + '\n');
  await waitFor(() => logged.some(e => e.stream === 'network'), 'network harus tercatat sebelum stopTail');
  await stop();

  const netLines = logged.filter(e => e.stream === 'network');
  assert.equal(netLines.length, 1, 'drain penutup tidak menduplikasi baris');
  assert.deepEqual(JSON.parse(netLines[0].text), { url: '/x', status: 200 });
  assert.equal(existsSync(file), false, 'capture.jsonl dihapus setelah selesai');
});
