// Backup SQLite sebelum retensi (PRD §8.6/A60). `VACUUM INTO` = salinan konsisten
// dalam satu file walau WAL sedang aktif; tidak butuh tool eksternal.
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DAY = 86400000;
const NAME = /^playbook-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;

// Waktu backup dibaca dari nama file, bukan mtime: hasil copy/restore mengubah mtime.
function stampOf(name) {
  const m = NAME.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

export async function backupDatabase({ store, backupDir, keepDays = 7, now = new Date() } = {}) {
  const dbPath = store.path;
  if (dbPath === ':memory:') throw new Error('Database in-memory tidak bisa dibackup');
  await mkdir(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = join(backupDir, `playbook-${stamp}.db`);
  // ponytail: hanya file DB, bukan .runs/.reports.
  // Kalau artifact perlu ikut, tar RUNS_DIR setelah baris ini.
  store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const bytes = (await stat(file)).size;

  const cutoff = now.getTime() - keepDays * DAY;
  let pruned = 0;
  for (const name of await readdir(backupDir)) {
    const at = stampOf(name);
    if (at === null || at >= cutoff) continue;
    await rm(join(backupDir, name), { force: true });
    pruned++;
  }
  return { file, bytes, pruned, dir: dirname(file) };
}
