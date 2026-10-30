// Jalankan retensi sekali: node --experimental-sqlite --env-file=.env scripts/retention.mjs
// Server juga menjalankannya otomatis tiap RETENTION_INTERVAL_MS (lihat server/index.mjs).
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { runRetention } from '../server/retention.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const store = new Store(process.env.DATABASE_URL);
await store.init();
try {
  const result = await runRetention({
    store,
    runsDir: resolve(process.env.RUNS_DIR ?? join(root, '.runs')),
    reportsDir: resolve(process.env.REPORTS_DIR ?? join(root, '.reports')),
  });
  console.log('retensi:', JSON.stringify(result));
} finally {
  store.close();
}
