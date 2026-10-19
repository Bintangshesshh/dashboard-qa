// Satu pintu buat terminal. Tiap sumber bisa dijalankan sendiri atau bareng.
//
//   npm run cek                              -> semua: Playwright + Lighthouse + gabung
//   npm run cek:pw                           -> Playwright aja
//   npm run cek:lh                           -> Lighthouse aja
//   npm run cek:pw -- eureka/co-jaja.spec.ts -> spec tertentu (default: demo-masdis.spec.ts)
//   npm run cek:pw -- --all                  -> semua spec di eureka/
//   npm run cek:docs                         -> build docusaurus dulu, baru Lighthouse
//
// Argumen pertama (mode) bisa juga manual: node scripts/cek.mjs pw|lh|all
import {spawn} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = ['pw', 'lh', 'all'].includes(argv[0]) ? argv[0] : 'all';
const rest = argv[0] === mode ? argv.slice(1) : argv;
const semuaSpec = rest.includes('--all');
const grep = rest.find((a) => a.startsWith('--grep='));
const specs = rest.filter((a) => !a.startsWith('--'));
// Run satu TC: log dibikin cuma berisi output Playwright.
const senyap = Boolean(grep);

const run = (cmd, args, {senyap = false} = {}) =>
  new Promise((res) => {
    const p = spawn(cmd, args, {
      cwd: root,
      stdio: senyap ? 'ignore' : 'inherit',
      shell: process.platform === 'win32',
    });
    p.on('error', () => res(127));
    p.on('close', (code) => res(code));
  });

const step = (t) => {
  if (!senyap) console.log(`\n=== ${t} ===`);
};
const hasil = [];
const fresh = [];

if (mode === 'all' || mode === 'pw') {
  step('PLAYWRIGHT');
  await mkdir(join(root, 'pw-out'), {recursive: true});
  // Playwright rmdir output dir di awal dan mati kalau nggak bisa (EPERM: sisa run lain
  // masih ke-lock). Bersihin dulu; kalau gagal, pakai dir baru.
  let outDir = 'pw-out/artifacts';
  try {
    await rm(join(root, outDir), {recursive: true, force: true});
  } catch {
    outDir = `pw-out/artifacts-${Date.now()}`;
    console.log(`pw-out/artifacts ke-lock, pakai ${outDir}`);
  }
  const pw = await run('npx', [
    'playwright',
    'test',
    `--output=${outDir}`,
    ...(semuaSpec ? [] : specs.length ? specs : ['eureka/demo-masdis.spec.ts']),
    ...(grep ? [grep] : []),
  ]);
  if (pw === 127) console.log('npx/playwright nggak ketemu - npm i -D @playwright/test');
  hasil.push(['playwright', pw]);
  if (pw === 0) fresh.push('pw');
}

if (mode === 'all' || mode === 'lh') {
  step('LIGHTHOUSE CI');
  const lh = await run('lhci', ['autorun']);
  if (lh === 127) console.log('lhci nggak ada - npm i -D @lhci/cli');
  if (lh !== 0 && lh !== 127) {
    console.log('lhci gagal. Kalau EPERM unlink .lighthouseci/lhr-*.html: masih ada proses (chrome/lhci)');
    console.log('yang megang filenya. Tutup Chrome, atau: Remove-Item -Recurse -Force .lighthouseci');
  }
  hasil.push(['lighthouse', lh]);
  if (lh === 0) fresh.push('lh');
}

step('GABUNG');
// Sumber yang gagal jangan ditandai fresh - gabung bakal nandain datanya 'stale'.
// Run satu TC: output gabung disembunyikan, biar log cuma nampilin tesnya.
await run('node', ['scripts/gabung.mjs', `--only=${fresh.join(',') || 'none'}`], {senyap});

if (!senyap) {
  console.log(`\ncek selesai (mode ${mode}): ${hasil.map(([n, c]) => `${n} exit ${c}`).join(', ')}`);
}
