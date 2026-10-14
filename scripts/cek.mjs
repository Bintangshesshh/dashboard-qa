// Satu pintu buat terminal: Playwright + Lighthouse CI + normalizer.
//
//   npm run cek                                  -> eureka/demo-masdis.spec.ts (nggak butuh akun)
//   npm run cek -- eureka/co-jaja.spec.ts        -> spec tertentu
//   npm run cek -- --all                         -> semua spec di eureka/
//   npm run cek:docs                             -> build docusaurus dulu, baru cek
//
// Butuh di PATH: npx playwright (devDependency), lhci (@lhci/cli).
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.includes('--all');
const specs = args.filter((a) => !a.startsWith('--'));

const run = (cmd, argv) =>
  new Promise((res) => {
    const p = spawn(cmd, argv, {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
    p.on('error', () => res(127));
    p.on('close', (code) => res(code));
  });

const step = (t) => console.log(`\n=== ${t} ===`);

await mkdir(join(root, 'pw-out'), {recursive: true});

step('PLAYWRIGHT');
// --output ke pw-out: test-results/ bawaan sering EPERM kalau ada sisa run lain.
const pw = await run('npx', ['playwright', 'test', '--output=pw-out/artifacts', ...(all ? [] : specs.length ? specs : ['eureka/demo-masdis.spec.ts'])]);
if (pw === 127) {
  console.log('npx nggak ketemu - npm i -D @playwright/test');
  process.exit(1);
}

step('LIGHTHOUSE CI');
const lh = await run('lhci', ['autorun']);
if (lh === 127) console.log('lhci nggak ada di PATH - npm i -D @lhci/cli');
if (lh !== 0 && lh !== 127) console.log('lhci gagal - kalau EPERM: file .lighthouseci/ lama punya akun lain, jalanin dari PowerShell lu.');

step('GABUNG');
await run('node', ['scripts/gabung.mjs']);

console.log(`\ncek selesai: playwright exit ${pw}${lh === 127 ? ', lhci dilewati' : `, lhci exit ${lh}`}`);
