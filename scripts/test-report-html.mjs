// Cek renderer laporan: escaping, lokasi nested, skor, artifact, bundle, tanpa script/link.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildReportDocs } from './build-report-docs.mjs';
import Reporter from './pw-reporter.mjs';

const work = await mkdtemp(join(tmpdir(), 'report-html-test-'));
const runDir = join(work, 'run');
const outDir = join(work, 'out');
const hostile = '<script>alert("MDX")</script>{process.exit(42)}';
async function put(path, data) {
  await mkdir(dirname(join(runDir, path)), { recursive: true });
  await writeFile(join(runDir, path), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

try {
  await put('run.json', { id: 'synthetic', suiteName: 'Suite', status: 'failed', error: hostile, cases: [{ code: 'SECRET_SOURCE_SENTINEL' }] });
  await put('logs.txt', 'Runner error: ' + hostile);
  const reporter = new Reporter({ outputFile: join(runDir, 'artifacts/pw/langkah.json') });
  assert.equal(new Reporter().outputFile, join('pw-out', 'langkah.json'));
  reporter.onTestEnd({
    id: 'nested', titlePath: () => ['chromium', 'Nested API test'], location: { file: 'nested.spec.ts', line: 12 },
    parent: { project: () => ({ name: 'chromium' }) },
  }, { status: 'failed', retry: 1, duration: 42, steps: [{ title: 'outer', steps: [{ title: 'locator.click nested', category: 'pw:api', location: { file: 'nested.spec.ts', line: 17, column: 3 }, error: { message: 'Nested API error' } }] }] });
  reporter.onEnd();
  await put('artifacts/pw/results.json', {
    suites: [{ title: 'checkout', specs: [{ title: hostile, file: 'checkout.spec.ts', line: 8, tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'unexpected', results: [{ status: 'failed', duration: 10, errors: [{ message: 'Locator not visible' }], steps: [{ title: 'outer', steps: [{ title: 'Click checkout', error: { message: hostile } }] }] }] }] }] }],
    errors: [{ message: 'Browser launch warning' }],
  });
  await put('artifacts/lh/report.json', {
    finalUrl: 'https://example.test/', fetchTime: '2026-10-20T00:00:00Z',
    categories: { performance: { title: 'Performance', score: 0.6 } },
    audits: {
      contrast: { id: 'contrast', title: 'Contrast failure', score: 0, description: hostile, details: { items: [{ node: { snippet: '<button>Pay</button>' } }] } },
      success: { id: 'success', title: 'Passing audit', score: 1 },
    },
  });
  await put('artifacts/pw/report/index.html', '<!doctype html><title>Native report</title>');
  await put('artifacts/pw/report/data/trace.zip', Buffer.from([80, 75, 3, 4]));
  await put('artifacts/pw/screen shot.png', Buffer.from('iVBORw0KGgo=', 'base64'));
  await put('artifacts/broken.json', '{');
  await put('docs/stale.txt', 'must not survive rebuild');
  await put('source/private.txt', 'SECRET_SOURCE_SENTINEL');
  await symlink(join(runDir, 'source'), join(runDir, 'artifacts/source-link'), process.platform === 'win32' ? 'junction' : 'dir');

  const index = await buildReportDocs([runDir, join(work, 'gone')], outDir, '/runs/synthetic/docs/');
  assert.equal(index.length, 2);
  assert.equal(index[1].status, 'missing');

  const html = await readFile(join(outDir, 'synthetic/index.html'), 'utf8');
  assert(html.includes('Ringkasan kegagalan lebih dulu'));
  assert(html.includes('locator.click nested'));
  assert(html.includes('nested.spec.ts:17:3'));
  assert(html.includes('Nested API error'));
  assert(html.includes('60/100'));
  assert(html.includes('Audit prioritas'));
  assert(html.includes('<details><summary>Tampilkan log runner asli</summary>'));
  assert(html.includes('Langkah gagal: '));
  assert(html.includes('Click checkout'));
  assert(html.includes('Locator not visible'));
  assert(html.includes('Contrast failure'));
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes('<script>alert('));
  assert(!html.includes('SECRET_SOURCE_SENTINEL'));
  assert(!(await readdir(join(outDir, 'synthetic/artifacts'))).includes('run.json'));
  assert(html.includes('artifacts/pw/screen%20shot.png'));
  assert(html.includes('artifacts/artifacts/pw/report/index.html'.replace(/^artifacts\//, '')) || html.includes('artifacts/pw/report/index.html'));
  assert(html.includes('playwright show-trace'));
  assert(html.includes('Report HTML asli'));
  assert(html.includes('viewer interaktif mungkin tidak jalan'));
  assert(html.includes('<style>'));
  // Satu stylesheet dipakai semua halaman report; tema ikut OS.
  assert(html.includes('prefers-color-scheme:dark'));
  assert(html.includes('<meta name="color-scheme" content="light dark">'));
  assert(html.includes('class="tbl"') || html.includes('class="scores"'));
  assert(!/^\.plain\{/m.test(html));
  assert(html.includes('broken.json'));
  assert(!/<img\b/i.test(html));
  assert(!/<script\b/i.test(html));
  assert(!/<noscript\b/i.test(html));
  assert(!/<link\b[^>]*rel="stylesheet"/i.test(html));
  assert.deepEqual(await readFile(join(outDir, 'synthetic/artifacts/artifacts/pw/report/data/trace.zip')), Buffer.from([80, 75, 3, 4]));

  const page = await readFile(join(outDir, 'index.html'), 'utf8');
  assert(page.includes('Laporan run'));
  assert(page.includes('prefers-color-scheme:dark'));
  assert(page.includes('Run dihapus'));
  assert(!/<script\b/i.test(page));
  // Link folder tanpa index.html dibalas {"error":"Not found"} oleh route artifact.
  assert(page.includes('href="synthetic/index.html"'));
  assert(!/href="synthetic\/"/.test(page));
  // Kolom teks: jalur cepat ambil ringkas.txt dari index.
  assert(page.includes('synthetic/ringkas.txt'));
  // Report asli harus bisa dibuka di tab baru, bukan hanya diunduh.
  assert(/target="_blank" rel="noopener">buka</.test(html));
  // ringkas.txt untuk disalin, satu sumber dengan tabel.
  const ringkas = await readFile(join(outDir, 'synthetic/ringkas.txt'), 'utf8');
  assert(ringkas.includes('status failed'));
  assert(ringkas.includes('Nested API error'));
  assert(ringkas.includes('locator.click nested'));

  // baseUrl tidak valid harus ditolak.
  await assert.rejects(buildReportDocs([runDir], join(work, 'bad'), '/x/y'), /baseUrl/);

  // Rebuild membuang halaman lama milik run yang sudah hilang.
  await rm(runDir, { recursive: true, force: true });
  await buildReportDocs([join(work, 'gone')], outDir, '/runs/x/docs/');
  await assert.rejects(readdir(join(outDir, 'synthetic')), { code: 'ENOENT' });

  console.log('PASS: report-html escaping, locations, scores, artifacts, bundle, sandbox-safe html');
} finally {
  await rm(work, { recursive: true, force: true });
}

