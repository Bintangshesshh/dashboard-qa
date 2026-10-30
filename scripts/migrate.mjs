import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const migrationsDir = join(root, 'server', 'migrations');
const target = process.env.DATABASE_URL ?? 'sqlite:./data/playbook.db';
const file = target.replace(/^(sqlite:|file:)\/?/, '') || 'data/playbook.db';
const dbPath = join(root, file);

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const version = db.prepare('PRAGMA user_version').get().user_version;
const pending = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  .filter(f => Number(f.slice(0, 4)) > version);

if (!pending.length) console.log(`up to date: ${file} at user_version=${version}`);
for (const name of pending) {
  const to = Number(name.slice(0, 4));
  const sql = readFileSync(join(migrationsDir, name), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${to}`);
    db.exec('COMMIT');
    console.log(`applied ${name} → user_version=${to}`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`${name} failed: ${error.message}`);
  }
}
db.close();
