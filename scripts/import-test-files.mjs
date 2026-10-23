import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const target = process.env.DATABASE_URL ?? 'sqlite:./data/playbook.db';
const file = target.replace(/^(sqlite:|file:)\/?/, '') || 'data/playbook.db';
const dbPath = join(root, file);

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < 1) throw new Error(`skema belum dimigrasi (user_version=${version}); jalankan node --experimental-sqlite scripts/migrate.mjs dulu`);

// PRD 17.2 — peta file repo → test_files. Key = path relatif dari root repo.
const PW = [
  ['eureka/cart-jaja.spec.ts', 'p_jaja', 'Cart — Jaja.id'],
  ['eureka/cart-ebh.spec.ts', 'p_ebh', 'Cart — Eureka Bookhouse'],
  ['eureka/cart-masdis.spec.ts', 'p_masdis', 'Demo — Master Diskon'],
];
const LH = [
  ['lighthouserc.jaja.js', 'p_jaja', 'Lighthouse — Jaja.id'],
  ['lighthouserc.ebh.js', 'p_ebh', 'Lighthouse — Eureka Bookhouse'],
  ['lighthouserc.masdis.js', 'p_masdis', 'Lighthouse — Master Diskon'],
];

const warnings = [];
const rows = [];
const now = new Date().toISOString();

for (const [path, projectId, label] of PW) {
  const abs = join(root, path);
  let code;
  try {
    code = readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`file spec tidak ditemukan: ${path}`);
  }
  // PRD 6/17.2: PW idealnya pakai process.env.BASE_URL supaya bisa menunjuk local/staging.
  // Demo sekarang masih memakai URL production apa adanya, jadi hanya dicatat, bukan diblokir.
  if (!/process\.env\.BASE_URL/.test(code)) {
    warnings.push(`${path}: masih hardcode URL production (tidak ada process.env.BASE_URL) — ok untuk demo, belum bisa dipakai env=local/staging`);
  }
  rows.push({
    id: 'tf_' + path.replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''),
    project_id: projectId,
    tool: 'pw',
    path,
    label,
    code,
    config: null,
    disk_hash: createHash('sha256').update(code).digest('hex'),
  });
}

for (const [path, projectId, label] of LH) {
  const abs = join(root, path);
  let code, ci;
  try {
    code = readFileSync(abs, 'utf8');
    ci = require(abs).ci;
  } catch (error) {
    throw new Error(`config LH tidak bisa dibaca: ${path} (${error.message})`);
  }
  const assertions = ci?.assert?.assertions ?? {};
  const budgets = {};
  for (const [name, value] of Object.entries(assertions)) {
    const minScore = Array.isArray(value) ? value[1]?.minScore : value?.minScore;
    if (typeof minScore === 'number') budgets[name] = { minScore };
  }
  rows.push({
    id: 'tf_' + path.replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''),
    project_id: projectId,
    tool: 'lh',
    path,
    label,
    code,
    config: JSON.stringify({
      urls: ci?.collect?.url ?? [],
      numberOfRuns: ci?.collect?.numberOfRuns ?? 1,
      budgets,
    }),
  });
}

const insert = db.prepare(`INSERT INTO test_files
  (id, project_id, tool, path, label, code, config, enabled, created_at, updated_at, updated_by, disk_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)
  ON CONFLICT(project_id, path) DO UPDATE SET
    tool = excluded.tool, label = excluded.label, code = excluded.code,
    config = excluded.config, updated_at = excluded.updated_at, disk_hash = excluded.disk_hash`);

db.exec('BEGIN');
try {
  for (const r of rows) insert.run(r.id, r.project_id, r.tool, r.path, r.label, r.code, r.config, now, now, r.disk_hash ?? null);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const list = db.prepare(`SELECT p.slug AS project, t.tool, t.path, t.label,
  length(t.code) AS code_bytes, t.config FROM test_files t JOIN projects p ON p.id = t.project_id
  ORDER BY t.tool, p.slug`).all();
for (const r of list) {
  console.log(`${r.project.padEnd(18)} ${r.tool}  ${r.path.padEnd(30)} ${String(r.code_bytes).padStart(5)}B  ${r.label}`);
  if (r.config) console.log(`  config: ${r.config}`);
}
console.log(`\ntest_files: ${list.length} · db: ${file}`);
if (warnings.length) {
  console.log('\nperingatan:');
  for (const w of warnings) console.log('  - ' + w);
}
db.close();
