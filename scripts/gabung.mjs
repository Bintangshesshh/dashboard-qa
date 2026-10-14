// Normalizer: lhci-results/manifest.json + .lighthouseci/assertion-results.json
//              -> docusaurus/static/data/latest.json
// ponytail: baru sisi LHCI. Sisi Playwright nambahin setelah ada report JSON
//           nyata (`npx playwright test --reporter=json`), biar bisa diverifikasi.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

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
  lighthouse: {runs: urls.length, errors, warnings: assertions.length - errors, urls},
};

const dest = join(root, 'docusaurus', 'static', 'data');
await mkdir(dest, {recursive: true});
await writeFile(join(dest, 'latest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`latest.json: ${urls.length} url, ${errors} error, ${assertions.length - errors} warning`);
