// Normalizer: lhci-results/manifest.json + .lighthouseci/assertion-results.json
//              -> docusaurus/static/data/latest.json
// ponytail: baru sisi LHCI. Sisi Playwright nambahin setelah ada report JSON
//           nyata (`npx playwright test --reporter=json`), biar bisa diverifikasi.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const pad = (s, n) => String(s).padEnd(n);
const pct = (s) => Math.round(s * 100);

// ---------- Playwright: pw-out/hasil.json (reporter json di playwright.config.ts) ----------
let playwright = null;
try {
  const r = await readJson(join(root, 'pw-out', 'hasil.json'));
  const tests = [];
  const walk = (s, file) => {
    const f = s.file ?? file ?? '';
    for (const spec of s.specs ?? []) {
      const res = spec.tests?.[0]?.results ?? [];
      const last = res[res.length - 1] ?? {};
      tests.push({
        file: f.replace(/^.*[\\/]/, ''),
        title: spec.title,
        status: last.status ?? 'skipped',
        ms: last.duration ?? 0,
      });
    }
    for (const c of s.suites ?? []) walk(c, f);
  };
  for (const s of r.suites ?? []) walk(s);
  const st = r.stats ?? {};
  playwright = {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => ['failed', 'timedOut', 'interrupted'].includes(t.status)).length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    ms: st.duration ?? 0,
    tests,
  };
} catch {
  // belum ada run Playwright, bukan error
}

const manifest = await readJson(join(root, 'lhci-results', 'manifest.json'));

// '/index.html' -> '/', '/blog/index.html' -> '/blog/'
const clean = (p) => p.replace(/index\.html$/, '') || '/';

const urls = manifest
  .map((r) => ({path: clean(new URL(r.url).pathname), scores: r.summary}))
  .sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));

let assertions = [];
try {
  assertions = await readJson(join(root, '.lighthouseci', 'assertion-results.json'));
} catch {
  // belum ada run LHCI, bukan error
}

// LHCI nyampur warn + error di file yang sama; 'gagal' = level 'error' doang.
const errors = assertions.filter((a) => a.level === 'error').length;

const out = {
  generatedAt: new Date().toISOString(),
  playwright,
  lighthouse: {runs: urls.length, errors, warnings: assertions.length - errors, urls},
};

const dest = join(root, 'docusaurus', 'static', 'data');
await mkdir(dest, {recursive: true});
await writeFile(join(dest, 'latest.json'), JSON.stringify(out, null, 2) + '\n');

// ---------- Tabel buat terminal ----------
if (playwright) {
  console.log('\n=== PLAYWRIGHT ===');
  for (const t of playwright.tests) {
    const label = {passed: 'PASS', failed: 'FAIL', timedOut: 'TIMEOUT', interrupted: 'STOP', skipped: 'SKIP'}[t.status] ?? t.status;
    console.log(`${pad(label, 8)}${pad(t.file, 26)}${pad(t.title, 44)}${(t.ms / 1000).toFixed(1)}s`);
  }
  console.log(`${playwright.passed} passed, ${playwright.failed} failed, ${playwright.skipped} skipped (${(playwright.ms / 1000).toFixed(1)}s)`);
} else {
  console.log('\n=== PLAYWRIGHT ===\npw-out/hasil.json belum ada');
}

console.log('\n=== LIGHTHOUSE ===');
console.log(`${pad('path', 14)}${pad('perf', 6)}${pad('a11y', 6)}${pad('bp', 6)}seo`);
for (const u of urls) {
  console.log(`${pad(u.path, 14)}${pad(pct(u.scores.performance), 6)}${pad(pct(u.scores.accessibility), 6)}${pad(pct(u.scores['best-practices']), 6)}${pct(u.scores.seo)}`);
}
console.log(`${urls.length} url, ${errors} error, ${assertions.length - errors} warning`);
console.log('\nlatest.json -> docusaurus/static/data/latest.json');
