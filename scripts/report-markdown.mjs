// Katalog markdown bahan evaluasi di docusaurus/docs/evaluasi/.
//   node scripts/report-markdown.mjs
// Sumber: tabel reports + run/results di DB (read-only), bukan latest.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { renderReportMarkdown } from './report-md.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docusaurus', 'docs', 'evaluasi');

const slug = value => String(value ?? '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const store = new Store(process.env.DATABASE_URL);
await store.init();

const sessions = store.listSessions({});
const rows = [];
let position = 1;

for (const session of sessions) {
  const project = session.project_id ? store.getProject(session.project_id) : null;
  for (const report of session.reports ?? []) {
    const ids = JSON.parse(report.run_ids ?? '[]');
    const runs = [];
    for (const runId of ids) {
      const run = store.getRun(runId);
      if (!run) continue;
      runs.push({
        run: { ...run, artifacts: store.listArtifacts(run.id) },
        results: run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id),
      });
    }
    const name = `${slug(session.label) || session.id.slice(0, 8)}-${report.scope}`;
    const md = renderReportMarkdown({ session, project, report, runs, position: position++, frontmatter: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, name + '.md'), md);
    rows.push({ name, session, report, runs });
  }
}

// index.md: daftar semua report, urut sesi terbaru.
const baris = rows.map(({ name, session, report, runs }) => {
  const gagal = runs.filter(r => r.run.status !== 'passed').length;
  const built = report.built_at
    ? new Date(report.built_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    : '-';
  return `| [${session.label}](${name}.md) | ${report.scope} | ${report.status} | ${runs.length} | ${gagal} | ${built} |`;
});

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.md'), [
  '---',
  'title: "Katalog evaluasi"',
  'sidebar_position: 5',
  '---',
  '',
  '# Katalog evaluasi',
  '',
  '> Dihasilkan otomatis oleh `npm run evaluasi`. Jangan edit manual.',
  '',
  'Satu halaman per report sesi: verdict run, kegagalan Playwright, audit Lighthouse di bawah 100%, dan checklist temuan.',
  '',
  rows.length
    ? ['| Sesi | Cakupan | Status | Run | Gagal | Dibangun |', '| --- | --- | --- | --- | --- | --- |', ...baris].join('\n')
    : '_Belum ada report. Terbitkan report dari halaman sesi di dashboard._',
  '',
].join('\n'));

store.close();
console.log(`evaluasi -> ${rows.length} halaman di docusaurus/docs/evaluasi/`);
