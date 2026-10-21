import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const scryptAsync = promisify(scrypt);
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : (i >= 0 ? true : undefined);
}
const username = flag('username');
const role = flag('role') ?? 'viewer';
const reset = flag('reset-password') === true;
const dryRun = flag('dry-run') === true;

const HELP = `node scripts/seed-user.mjs
  --username <nama>          wajib
  --role <admin|viewer>      default: viewer
  --reset-password           ganti password user yang sudah ada
  --dry-run                  tampil tanpa menulis DB`;

if (!username || typeof username !== 'string' || !/^[a-z0-9._-]{2,32}$/i.test(username)) {
  console.error(HELP);
  console.error('error: --username wajib diisi (huruf/angka/._-, 2-32 karakter)');
  process.exit(1);
}
if (!['admin', 'viewer'].includes(role)) {
  console.error(HELP);
  console.error(`error: --role harus admin atau viewer, dapat "${role}"`);
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.env.DATABASE_URL ?? 'sqlite:./data/playbook.db';
const file = target.replace(/^(sqlite:|file:)\/?/, '') || 'data/playbook.db';
const dbPath = join(root, file);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < 1) {
  console.error(`error: skema belum dimigrasi (user_version=${version}); jalankan node --experimental-sqlite scripts/migrate.mjs dulu`);
  process.exit(1);
}

async function askPassword() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.error('Ketik password (min 8 karakter; ketikan tidak tampil):');
  const first = await rl.question('');
  if (first.length < 8) {
    rl.close();
    console.error('error: password terlalu pendek');
    process.exit(1);
  }
  console.error('Ulangi password:');
  const again = await rl.question('');
  rl.close();
  if (first !== again) {
    console.error('error: password tidak cocok');
    process.exit(1);
  }
  return first;
}

const N = 16384, R = 8, P = 1;
async function hash(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verify(stored, password) {
  const [scheme, n, r, p, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt') throw new Error('format password_hash tidak dikenal');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const got = await scryptAsync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(got, expected);
}

const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
const action = existing ? (reset ? 'reset-password' : 'skip') : 'create';

if (action === 'skip') {
  console.log(`${username} sudah ada (role=${existing.role}). Tanpa --reset-password tidak ada yang berubah.`);
} else {
  if (action === 'reset-password' && !reset) { /* unreachable */ }
  const password = await askPassword();
  const passwordHash = await hash(password);

  if (dryRun) {
    console.log(`(dry-run) akan ${action} user=${username} role=${role} password_hash=${passwordHash.slice(0, 20)}…`);
  } else {
    db.exec('BEGIN');
    try {
      if (existing) {
        db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(passwordHash, role, existing.id);
        // PRD 6.3: reset password menghapus semua sesi login + token CLI user itu
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(existing.id);
        db.prepare('DELETE FROM cli_tokens WHERE user_id = ?').run(existing.id);
        console.log(`password ${username} diganti; auth_sessions + cli_tokens user ini dihapus`);
      } else {
        db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), username, passwordHash, role, new Date().toISOString());
        console.log(`user ${username} dibuat (role=${role})`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

// Bukti
const row = db.prepare('SELECT username, role, length(password_hash) AS hash_len, created_at FROM users WHERE username = ?').get(username);
console.table(row);
db.close();
