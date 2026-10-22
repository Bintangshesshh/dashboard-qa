// Backup manual: npm run backup
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { backupDatabase } from '../server/backup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const store = new Store(process.env.DATABASE_URL);
await store.init();
try {
  const result = await backupDatabase({
    store,
    backupDir: resolve(process.env.BACKUP_DIR ?? join(root, 'data', 'backups')),
    keepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 7),
  });
  console.log('backup:', JSON.stringify(result));
} finally {
  store.close();
}
