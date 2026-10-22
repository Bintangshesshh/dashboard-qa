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
    fail(`${name} must contain 1–${max} characters`);
  return value.trim();
}
export function optionalText(value, name, max = 200) {
  if (value === undefined || value === null) return null;
  return text(value, name, max);
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
