import { timingSafeEqual } from 'node:crypto';

export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function id(value) {
  // UUID (sesi/run/report) atau ID berawalan seperti p_ebh, tf_lighthouserc_ebh_js.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value))
    fail('Invalid ID');
  return value;
}
export function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(`${name} must contain 1-${max} characters`);
  return value.trim();
}
export function optionalText(value, name, max = 200) {
  if (value === undefined || value === null) return null;
  return text(value, name, max);
}
// Kode sumber disimpan apa adanya: trim akan membuat DB beda dari file di disk
// dan memicu status "belum disimpan" palsu di editor.
export function code(value, max = 200000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(`code must contain 1-${max} characters`);
  return value;
}
// env dari PRD §6: hanya local | staging | production
export function env(value) {
  if (!['local', 'staging', 'production'].includes(value)) fail('env must be local|staging|production');
  return value;
}
export function tool(value) {
  if (!['pw', 'lh'].includes(value)) fail('tool must be pw|lh');
  return value;
}
export function allowlist(value = '') {
  return value.split(',').filter(Boolean).map(entry => {
    const u = new URL(entry.trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash)
      throw new Error('TARGET_ALLOWLIST entries must be HTTP(S) origins');
    return u.origin;
  });
}
export function target(value, origins) {
  let u;
  try { u = new URL(value); } catch { fail('Invalid targetUrl'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !origins.includes(u.origin))
    fail('Target origin is not allowlisted');
  return u.href;
}
// URL biasa (kolom projects.*): wajib http(s), tanpa kredensial. Origin tidak
// dibatasi karena admin yang mengisi; yang dicegah hanya skema aneh (javascript:).
export function url(value, name = 'url') {
  let u;
  try { u = new URL(value); } catch { fail(`Invalid ${name}`); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    fail(`${name} harus URL http(s) tanpa kredensial`);
  return u.href;
}
// Daftar origin dari input JSON; allowlist() melempar Error biasa → ubah ke 400.
export function originList(value) {
  if (!Array.isArray(value)) fail('origins harus array origin');
  try { return allowlist(value.join(',')); } catch (e) { fail(e.message); }
}
// Timing-safe compare, returns boolean.
export function authorized(value, token) {
  if (typeof value !== 'string' || !token) return false;
  const a = Buffer.from(value), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function cursor(value = 0) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail('Invalid log cursor');
  return n;
}
export function rangeDays(query, fallback = 14) {
  const v = query.range;
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) fail('range must be a positive integer');
  return n;
}
export function isoTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('Invalid timestamp');
  return new Date(value).toISOString();
}
// boolean integer untuk kolom SQLite
export function bool(value, name) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 1 || value === 0) return value;
  fail(`${name} must be boolean`);
}

// ─── Test file (PRD §9) ─────────────────────────────────────────────────────
// Path relatif ke root repo, unik global: spec/config antar project tidak
// saling menimpa di disk.
export function testFilePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('path must contain 1-500 characters');
  const p = value.trim();
  if (p.includes('..')) fail('path tidak boleh mengandung ..');
  if (/^([a-zA-Z]:|[\\/])/.test(p)) fail('path harus relatif');
  if (!/\.(spec|test)\.[cm]?[jt]sx?$|\.(c|m)?js$|\.json$/.test(p)) fail('path harus spec/test atau config .js/.json');
  return p.replaceAll('\\', '/');
}

// Config Lighthouse (PRD §4/§9). Invalid = 400; tidak ada fallback ke file .js.
export const LH_MAX_EXTRA_URLS = 4;      // target sesi memakai 1 dari 5 slot
export const LH_MAX_RUNS = 10;
export const LH_BUDGET_KEYS = [
  'categories:performance', 'categories:accessibility',
  'categories:best-practices', 'categories:seo',
];

export function parseLhConfig(config) {
  if (config === null || config === undefined || config === '') return null;
  if (typeof config !== 'string') return config;
  try { return JSON.parse(config); } catch { fail('config Lighthouse bukan JSON valid'); }
}

export function checkLhConfig(config, { allowedOrigins = [] } = {}) {
  const cfg = parseLhConfig(config);
  if (cfg === null) return null;
  if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('config Lighthouse harus object JSON');

  if (cfg.urls !== undefined) {
    if (!Array.isArray(cfg.urls)) fail('urls harus array');
    const seen = new Set();
    const urls = [];
    for (const raw of cfg.urls) {
      let u;
      try { u = new URL(String(raw)); } catch { fail('urls harus URL http(s) absolute'); }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) fail('urls harus URL http(s) absolute');
      if (!allowedOrigins.includes(u.origin)) fail(`Origin ${u.origin} tidak diizinkan untuk project ini`);
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      urls.push(u.href);
    }
    if (urls.length > LH_MAX_EXTRA_URLS) fail(`Maksimal ${LH_MAX_EXTRA_URLS} URL tambahan per run Lighthouse`);
    cfg.urls = urls;
  }

  if (cfg.numberOfRuns !== undefined) {
    const n = cfg.numberOfRuns;
    if (!Number.isInteger(n) || n < 1 || n > LH_MAX_RUNS) fail(`numberOfRuns harus bilangan bulat 1-${LH_MAX_RUNS}`);
  }

  if (cfg.budgets !== undefined) {
    if (!cfg.budgets || typeof cfg.budgets !== 'object' || Array.isArray(cfg.budgets)) fail('budgets harus object');
    for (const [key, val] of Object.entries(cfg.budgets)) {
      if (!LH_BUDGET_KEYS.includes(key)) fail(`Kategori budget tidak dikenal: ${key}`);
      const score = val?.minScore;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        fail(`minScore untuk ${key} harus angka 0-1`);
      }
    }
  }

  return cfg;
}

// Config Playwright per project (PRD T09/S03). Hanya 4 key ini yang disimpan;
// key lain ditolak supaya salah ketik tidak diam-diam masuk ke config runner.
export const PW_TIMEOUT_LIMITS = [10000, 900000];
export const PW_WORKERS_LIMITS = [1, 8];
export const PW_RETRIES_LIMITS = [0, 3];
export const PW_ENVS = ['local', 'staging', 'production'];

const pwInt = (value, [min, max], name) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name} harus bilangan bulat ${min}-${max}`);
  return n;
};

export function checkPwConfig(config) {
  if (config === null || config === undefined || config === '') return null;
  const cfg = typeof config === 'string'
    ? (() => { try { return JSON.parse(config); } catch { fail('config Playwright bukan JSON valid'); } })()
    : config;
  if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('config Playwright harus object JSON');
  const out = {};
  if (cfg.configPath !== undefined && cfg.configPath !== null) {
    if (typeof cfg.configPath !== 'string' || !cfg.configPath.trim()) fail('configPath harus string');
    out.configPath = cfg.configPath;
  }
  if (cfg.timeout !== undefined) out.timeout = pwInt(cfg.timeout, PW_TIMEOUT_LIMITS, 'timeout');
  if (cfg.workers !== undefined) out.workers = pwInt(cfg.workers, PW_WORKERS_LIMITS, 'workers');
  if (cfg.retries !== undefined) out.retries = pwInt(cfg.retries, PW_RETRIES_LIMITS, 'retries');
  if (cfg.env !== undefined) {
    if (!PW_ENVS.includes(cfg.env)) fail(`env harus salah satu: ${PW_ENVS.join(', ')}`);
    out.env = cfg.env;
  }
  return Object.keys(out).length ? out : null;
}

// Data lama menyimpan target utama di `urls`. Buang URL yang sama dengan URL
// project supaya tidak dihitung sebagai URL tambahan (PRD FR-04).
export function normalizeLhUrls(cfg, project) {
  if (!cfg || !Array.isArray(cfg.urls)) return cfg;
  const own = new Set([project?.base_url, project?.staging_url, project?.local_url]
    .filter(Boolean).map(u => { try { return new URL(u).href; } catch { return u; } }));
  return { ...cfg, urls: cfg.urls.filter(u => !own.has(u)) };
}
