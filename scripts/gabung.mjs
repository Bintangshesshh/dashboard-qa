// Normalizer: pw-out/hasil.json + lhci-results/manifest.json + .lighthouseci/assertion-results.json
//              -> docusaurus/static/data/latest.json  (plus tabel buat terminal)
//
//   node scripts/gabung.mjs                 -> refresh semua yang ada datanya
//   node scripts/gabung.mjs --only=pw       -> cuma Playwright; Lighthouse dibawa dari run lama (stale)
//   node scripts/gabung.mjs --only=lh       -> cuma Lighthouse
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SPEC, SITES, LIGHTHOUSE_TARGET} from '../qa.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'docusaurus', 'static', 'data', 'latest.json');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const readJsonOrNull = (p) => readJson(p).catch(() => null);
const pad = (s, n) => String(s).padEnd(n);
const pct = (s) => Math.round(s * 100);

const parts = ((process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] || 'all')
  .split(',')
  .flatMap((p) => (p === 'all' ? ['pw', 'lh'] : p));
const wantPw = parts.includes('pw');
const wantLh = parts.includes('lh');
const only = wantPw && wantLh ? 'all' : wantPw ? 'pw' : wantLh ? 'lh' : 'none';
const now = new Date().toISOString();

// ---------- Playwright ----------
const situs = (file) => SITES[SPEC[file]] ?? {site: file, host: '?', akun: false};

let playwright = null;
if (wantPw) {
  const r = await readJsonOrNull(join(root, 'pw-out', 'hasil.json'));
  if (r) {
    const tests = [];
    const walk = (s, file) => {
      const f = s.file ?? file ?? '';
      for (const spec of s.specs ?? []) {
        const res = spec.tests?.[0]?.results ?? [];
        const last = res[res.length - 1] ?? {};
        const nama = f.replace(/^.*[\\/]/, '');
        tests.push({file: nama, ...situs(nama), title: spec.title, status: last.status ?? 'skipped', ms: last.duration ?? 0});
      }
      for (const c of s.suites ?? []) walk(c, f);
    };
    for (const s of r.suites ?? []) walk(s);

    const bySite = new Map();
    for (const t of tests) {
      const k = `${t.site}|${t.host}`;
      const g = bySite.get(k) ?? {site: t.site, host: t.host, akun: t.akun, total: 0, passed: 0, failed: 0};
      g.total++;
      if (t.status === 'passed') g.passed++;
      if (['failed', 'timedOut', 'interrupted'].includes(t.status)) g.failed++;
      bySite.set(k, g);
    }

    playwright = {
      ranAt: now,
      stale: false,
      targets: [...bySite.values()],
      total: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => ['failed', 'timedOut', 'interrupted'].includes(t.status)).length,
      skipped: tests.filter((t) => t.status === 'skipped').length,
      ms: r.stats?.duration ?? 0,
      tests,
    };
  }
}

// ---------- Lighthouse ----------
let lighthouse = null;
if (wantLh) {
  const manifest = await readJsonOrNull(join(root, 'lhci-results', 'manifest.json'));
  if (manifest) {
    // '/index.html' -> '/', '/blog/index.html' -> '/blog/'
    const clean = (p) => p.replace(/index\.html$/, '') || '/';
    const urls = manifest
      .map((r) => ({path: clean(new URL(r.url).pathname), scores: r.summary}))
      // additive:true bikin manifest numpuk run lama - ambil yang terakhir per path.
      .filter((u, i, a) => a.findLastIndex((x) => x.path === u.path) === i)
      .sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));

    const assertions = (await readJsonOrNull(join(root, '.lighthouseci', 'assertion-results.json'))) ?? [];
    // LHCI nyampur warn + error di file yang sama; 'gagal' = level 'error' doang.
    const errors = assertions.filter((a) => a.level === 'error').length;

    lighthouse = {
      ranAt: now,
      stale: false,
      target: LIGHTHOUSE_TARGET,
      runs: urls.length,
      errors,
      warnings: assertions.length - errors,
      urls,
    };
  }
}

// ---------- Gabung + simpan ----------
const prev = await readJsonOrNull(dest);
const carry = (s) => (s ? {...s, stale: true} : null);

const out = {
  generatedAt: now,
  playwright: wantPw ? playwright ?? carry(prev?.playwright) : carry(prev?.playwright),
  lighthouse: wantLh ? lighthouse ?? carry(prev?.lighthouse) : carry(prev?.lighthouse),
};

await mkdir(dirname(dest), {recursive: true});
await writeFile(dest, JSON.stringify(out, null, 2) + '\n');

// ---------- Tabel buat terminal ----------
const tua = (s) => (s?.stale ? '  (data lama, belum dijalankan ulang)' : '');

console.log('\n=== PLAYWRIGHT ===');
if (!out.playwright) {
  console.log('pw-out/hasil.json belum ada');
} else {
  for (const g of out.playwright.targets ?? []) {
    console.log(`${pad(g.site, 26)}${pad(g.host, 22)}${g.akun ? 'butuh akun' : 'tanpa akun'}  ${g.passed}/${g.total} pass`);
  }
  console.log('');
  for (const t of out.playwright.tests) {
    const label = {passed: 'PASS', failed: 'FAIL', timedOut: 'TIMEOUT', interrupted: 'STOP', skipped: 'SKIP'}[t.status] ?? t.status;
    console.log(`${pad(label, 8)}${pad(t.site ?? t.file, 26)}${pad(t.file, 24)}${pad(t.title, 44)}${(t.ms / 1000).toFixed(1)}s`);
  }
  console.log(`${out.playwright.passed} passed, ${out.playwright.failed} failed, ${out.playwright.skipped} skipped (${(out.playwright.ms / 1000).toFixed(1)}s)${tua(out.playwright)}`);
}

console.log('\n=== LIGHTHOUSE ===');
if (!out.lighthouse) {
  console.log('lhci-results/manifest.json belum ada');
} else {
  const t = out.lighthouse.target ?? LIGHTHOUSE_TARGET;
  console.log(`target: ${t.site} - ${t.dist} (server lokal)`);
  console.log(`${pad('path', 14)}${pad('perf', 6)}${pad('a11y', 6)}${pad('bp', 6)}seo`);
  for (const u of out.lighthouse.urls) {
    console.log(`${pad(u.path, 14)}${pad(pct(u.scores.performance), 6)}${pad(pct(u.scores.accessibility), 6)}${pad(pct(u.scores['best-practices']), 6)}${pct(u.scores.seo)}`);
  }
  console.log(`${out.lighthouse.urls.length} url, ${out.lighthouse.errors} error, ${out.lighthouse.warnings} warning${tua(out.lighthouse)}`);
}

console.log(`\nlatest.json -> docusaurus/static/data/latest.json  (mode: ${only})`);
