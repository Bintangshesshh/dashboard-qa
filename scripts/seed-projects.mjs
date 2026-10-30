import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.env.DATABASE_URL ?? 'sqlite:./data/playbook.db';
const file = target.replace(/^(sqlite:|file:)\/?/, '') || 'data/playbook.db';
const dbPath = join(root, file);

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < 1) throw new Error(`skema belum dimigrasi (user_version=${version}); jalankan node --experimental-sqlite scripts/migrate.mjs dulu`);

// PRD 6.2 — staging_url sengaja NULL: env=staging belum bisa dipakai sampai diisi manual.
const now = new Date().toISOString();
const projects = [
  ['p_jaja', 'jaja-id', 'Jaja.id', 'https://jaja.id', '["https://jaja.id"]'],
  ['p_ebh', 'eureka-bookhouse', 'Eureka Bookhouse', 'https://eurekabookhouse.com', '["https://eurekabookhouse.com"]'],
  ['p_masdis', 'master-diskon', 'Master Diskon', 'https://masterdiskon.com', '["https://masterdiskon.com"]'],
];

const insert = db.prepare(`INSERT INTO projects
  (id, slug, name, base_url, staging_url, local_url, origins, allow_production, active, created_at)
  VALUES (?, ?, ?, ?, NULL, 'http://localhost:3000', ?, 0, 1, ?)
  ON CONFLICT(id) DO UPDATE SET
    slug = excluded.slug, name = excluded.name, base_url = excluded.base_url,
    origins = excluded.origins, local_url = excluded.local_url`);

db.exec('BEGIN');
try {
  for (const [id, slug, name, base, origins] of projects) insert.run(id, slug, name, base, origins, now);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const rows = db.prepare('SELECT id, slug, name, base_url, staging_url FROM projects ORDER BY id').all();
console.table(rows);
console.log(`projects: ${rows.length} · db: ${file}`);
db.close();
