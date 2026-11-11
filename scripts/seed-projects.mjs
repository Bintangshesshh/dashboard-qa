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

// PRD 6.2 - staging_url sengaja NULL: env=staging belum bisa dipakai sampai diisi manual.
const now = new Date().toISOString();
const groups = [
  ['g_jaja-id', 'Jaja.id'],
  ['g_eureka-bookhouse', 'Eureka Bookhouse'],
  ['g_master-diskon', 'Master Diskon'],
];
const projects = [
  ['p_jaja', 'jaja-id', 'Jaja.id', 'https://jaja.id', '["https://jaja.id"]', 'g_jaja-id'],
  ['p_ebh', 'eureka-bookhouse', 'Eureka Bookhouse', 'https://eurekabookhouse.com', '["https://eurekabookhouse.com"]', 'g_eureka-bookhouse'],
  ['p_masdis', 'master-diskon', 'Master Diskon', 'https://masterdiskon.com', '["https://masterdiskon.com"]', 'g_master-diskon'],
];

const insertGroup = db.prepare(`INSERT INTO project_groups (id, name, created_at)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name`);

const insertProject = db.prepare(`INSERT INTO projects
  (id, slug, name, base_url, staging_url, local_url, origins, allow_production, active, group_id, created_at)
  VALUES (?, ?, ?, ?, NULL, 'http://localhost:3000', ?, 0, 1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    slug = excluded.slug, name = excluded.name, base_url = excluded.base_url,
    origins = excluded.origins, local_url = excluded.local_url, group_id = excluded.group_id`);

db.exec('BEGIN');
try {
  for (const [id, name] of groups) insertGroup.run(id, name, now);
  for (const [id, slug, name, base, origins, groupId] of projects) insertProject.run(id, slug, name, base, origins, groupId, now);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const rows = db.prepare('SELECT p.id, p.slug, p.name, p.base_url, p.group_id FROM projects p ORDER BY p.id').all();
console.table(rows);
const groupCount = db.prepare('SELECT COUNT(*) AS n FROM project_groups').get().n;
console.log(`projects: ${rows.length}, groups: ${groupCount} - db: ${file}`);
db.close();
