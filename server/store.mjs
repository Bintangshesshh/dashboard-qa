import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const migrationsDir = join(root, 'server', 'migrations');

// Accepts sqlite:./data/playbook.db, file:/abs, plain path, or :memory:.
export function databasePath(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required; SQLite persistence cannot be disabled');
  const value = connectionString.replace(/^sqlite:/, '').replace(/^file:/, '').replace(/^\/\//, '');
  if (!value) throw new Error('DATABASE_URL must point to a SQLite database file');
  return value === ':memory:' ? value : resolve(value);
}

// Derived session status per PRD §6.5.
const SESSION_STATUS_SQL = `
  CASE
    WHEN EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id AND r.status IN ('queued','running','uploading')) THEN 'running'
    WHEN NOT EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id) THEN CASE WHEN s.closed_at IS NULL THEN 'open' ELSE 'closed' END
    WHEN EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id AND r.status IN ('failed','cancelled','interrupted')) THEN 'failed'
    WHEN s.closed_at IS NOT NULL THEN 'closed'
    ELSE 'passed'
  END`;

export class Store {
  constructor(connectionString) {
    this.path = databasePath(connectionString);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
  }

  async init() {
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    if (this.path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
    this.recover();
  }

  migrate() {
    if (this.path === ':memory:') {
      this.db.exec(readFileSync(join(migrationsDir, '0001_schema_v5.sql'), 'utf8'));
      this.db.exec('PRAGMA user_version = 1');
      return;
    }
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    const pending = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
      .filter(f => Number(f.slice(0, 4)) > version);
    for (const name of pending) {
      const to = Number(name.slice(0, 4));
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      this.db.exec('BEGIN');
      try {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${to}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw new Error(`${name} failed: ${error.message}`);
      }
    }
  }

  recover() {
    this.db.prepare(`UPDATE runs SET status='interrupted', error=COALESCE(error,'Server restarted during execution'), finished_at=COALESCE(finished_at, ?) WHERE status IN ('queued','running','uploading')`).run(new Date().toISOString());
    this.db.prepare(`UPDATE reports SET status='failed', error=COALESCE(error,'Server restarted during report build') WHERE status IN ('queued','building')`).run();
  }

  // ─── Auth: users ─────────────────────────────────────────────────────────
  userByUsername(username) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(username); }
  userById(userId) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(userId); }
  createUser({ id, username, passwordHash, role = 'viewer' }) {
    this.db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(id, username, passwordHash, role, new Date().toISOString());
  }
  touchLogin(userId) { this.db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), userId); }

  // ─── Auth: browser sessions (auth_sessions) ──────────────────────────────
  createAuthSession({ id, userId, expiresAt, ip, userAgent }) {
    this.db.prepare('INSERT INTO auth_sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
      .run(id, userId, new Date().toISOString(), expiresAt, ip ?? null, userAgent ?? null);
  }
  authSessionById(id) { return this.db.prepare('SELECT * FROM auth_sessions WHERE id=?').get(id); }
  deleteAuthSession(id) { this.db.prepare('DELETE FROM auth_sessions WHERE id=?').run(id); }
  deleteAuthSessionsForUser(userId) { this.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId); }

  // ─── Auth: cli tokens ────────────────────────────────────────────────────
  createCliToken({ id, userId, tokenHash, label }) {
    this.db.prepare('INSERT INTO cli_tokens (id, user_id, token_hash, label, created_at) VALUES (?,?,?,?,?)')
      .run(id, userId, tokenHash, label ?? null, new Date().toISOString());
  }
  cliTokenByHash(hash) { return this.db.prepare('SELECT * FROM cli_tokens WHERE token_hash=?').get(hash); }
  touchCliToken(id) { this.db.prepare('UPDATE cli_tokens SET last_used_at=? WHERE id=?').run(new Date().toISOString(), id); }
  listCliTokens(userId) { return this.db.prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM cli_tokens WHERE user_id=? ORDER BY created_at DESC').all(userId); }
  revokeCliToken(id) { return this.db.prepare('UPDATE cli_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(new Date().toISOString(), id).changes > 0; }

  // ─── Projects ────────────────────────────────────────────────────────────
  listProjects() {
    return this.db.prepare(`SELECT p.*,
      (SELECT MAX(r.finished_at) FROM runs r JOIN sessions s2 ON s2.id = r.session_id WHERE s2.project_id = p.id) AS lastRunAt
      FROM projects p WHERE p.active=1 ORDER BY p.name`).all().map(parseOrigins);
  }
  getProject(id) { const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); return row ? parseOrigins(row) : row; }
  patchProject(id, fields) {
    const allowed = ['name', 'base_url', 'staging_url', 'local_url', 'origins', 'allow_production', 'active'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(k === 'origins' ? JSON.stringify(fields[k]) : fields[k]); }
    if (!set.length) return this.getProject(id);
    vals.push(id);
    this.db.prepare(`UPDATE projects SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getProject(id);
  }

  // ─── Test files ──────────────────────────────────────────────────────────
  listTestFiles({ projectId, tool } = {}) {
    let sql = 'SELECT * FROM test_files WHERE enabled=1'; const vals = [];
    if (projectId) { sql += ' AND project_id=?'; vals.push(projectId); }
    if (tool) { sql += ' AND tool=?'; vals.push(tool); }
    sql += ' ORDER BY tool, path';
    return this.db.prepare(sql).all(...vals);
  }
  getTestFile(id) { return this.db.prepare('SELECT * FROM test_files WHERE id=?').get(id); }
  createTestFile({ id, projectId, tool, path, label, code, config, updatedBy }) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO test_files (id, project_id, tool, path, label, code, config, enabled, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,1,?,?,?)')
      .run(id, projectId, tool, path, label, code, config ?? null, now, now, updatedBy ?? null);
  }
  patchTestFile(id, fields) {
    const allowed = ['code', 'config', 'label', 'enabled'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(fields[k]); }
    if (!set.length) return this.getTestFile(id);
    set.push('updated_at=?'); vals.push(new Date().toISOString());
    vals.push(id);
    this.db.prepare(`UPDATE test_files SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getTestFile(id);
  }

  // ─── Sessions ────────────────────────────────────────────────────────────
  getSession(id, withRuns = false) {
    const row = this.db.prepare(`SELECT s.*, ${SESSION_STATUS_SQL} AS status FROM sessions s WHERE s.id=?`).get(id);
    if (!row) return undefined;
    if (withRuns) row.runs = this.listRunsBySession(id);
    return row;
  }
  findOpenSession(projectId, env, createdBy) {
    return this.db.prepare('SELECT id FROM sessions WHERE project_id=? AND env=? AND created_by=? AND closed_at IS NULL').get(projectId, env, createdBy);
  }
  createSession({ id, projectId, env, targetUrl, label, createdBy }) {
    // sessions_one_open (partial unique index) → 409 pada duplikat.
    this.db.prepare('INSERT INTO sessions (id, project_id, env, target_url, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, env, targetUrl, label, createdBy ?? null, new Date().toISOString());
  }
  closeSession(id) { this.db.prepare('UPDATE sessions SET closed_at=? WHERE id=? AND closed_at IS NULL').run(new Date().toISOString(), id); }
  listSessions({ projectId, status, from, to } = {}) {
    let sql = `SELECT s.*, ${SESSION_STATUS_SQL} AS status FROM sessions s WHERE 1=1`; const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    if (from) { sql += ' AND s.created_at>=?'; vals.push(from); }
    if (to) { sql += ' AND s.created_at<=?'; vals.push(to); }
    sql += ' ORDER BY s.created_at DESC';
    const rows = this.db.prepare(sql).all(...vals);
    return status ? rows.filter(r => r.status === status) : rows;
  }
  deleteSession(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
      this.db.exec('COMMIT');
      return true;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ─── Runs ────────────────────────────────────────────────────────────────
  createRun({ id, sessionId, testFileId, tool }) {
    this.db.prepare('INSERT INTO runs (id, session_id, test_file_id, tool, status, queued_at, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, sessionId, testFileId ?? null, tool, 'queued', new Date().toISOString(), new Date().toISOString());
    return this.getRun(id);
  }
  getRun(id) { return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id); }
  listRunsBySession(sessionId) { return this.db.prepare('SELECT * FROM runs WHERE session_id=? ORDER BY queued_at').all(sessionId); }
  countRunsByStatus(sessionId, statuses) {
    const placeholders = statuses.map(() => '?').join(',');
    return this.db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE session_id=? AND status IN (${placeholders})`).get(sessionId, ...statuses).n;
  }
  // Antrean global (bukan per sesi) untuk pagar max_queue_length → 429.
  countActiveRuns() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued','running','uploading')`).get().n;
  }
  patchRun(id, fields) {
    const allowed = ['status', 'started_at', 'finished_at', 'finalized_at', 'duration_ms', 'exit_code', 'error'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(fields[k]); }
    if (!set.length) return this.getRun(id);
    vals.push(id);
    this.db.prepare(`UPDATE runs SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getRun(id);
  }
  deleteRun(id) { this.db.prepare('DELETE FROM runs WHERE id=?').run(id); return true; }

  // ─── Run logs ────────────────────────────────────────────────────────────
  async log(runId, entry) { this.db.prepare('INSERT INTO run_logs (run_id, seq, stream, text, at) VALUES (?,?,?,?,?)').run(runId, entry.seq, entry.stream, String(entry.text), entry.at); }
  logs(runId, after = 0, limit = 5000) {
    const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 10000);
    const rows = this.db.prepare('SELECT seq, stream, text, at FROM run_logs WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?').all(runId, after, safeLimit + 1);
    const hasMore = rows.length > safeLimit;
    const logs = rows.slice(0, safeLimit);
    const nextAfter = logs.length ? logs[logs.length - 1].seq : after;
    return { logs, hasMore, nextAfter };
  }
  logsRaw(runId, after = 0) { return this.db.prepare('SELECT seq, stream, text, at FROM run_logs WHERE run_id=? AND seq>? ORDER BY seq').all(runId, after); }
  async logsText(runId) { return this.db.prepare('SELECT text FROM run_logs WHERE run_id=? ORDER BY seq').all(runId).map(r => r.text).join(''); }

  // ─── Playwright results ──────────────────────────────────────────────────
  addPlaywrightResults(runId, tests) {
    const ins = this.db.prepare(`INSERT INTO playwright_results (id, run_id, tc_id, file, title, status, duration_ms, retry, error) VALUES (?,?,?,?,?,?,?,?,?)`);
    this.db.exec('BEGIN');
    try {
      for (const t of tests) ins.run(randomUUID(), runId, t.tcId ?? null, t.file, t.title, t.status, t.durationMs ?? null, t.retry ?? 0, t.error ?? null);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  listPlaywrightResults(runId) { return this.db.prepare('SELECT * FROM playwright_results WHERE run_id=? ORDER BY file, title').all(runId); }

  // ─── Lighthouse results ──────────────────────────────────────────────────
  addLighthouseResults(runId, rows) {
    const ins = this.db.prepare(`INSERT INTO lighthouse_results (id, run_id, url, performance, accessibility, best_practices, seo, lcp_ms, cls, tbt_ms, budget_failed, warnings) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec('BEGIN');
    try {
      for (const r of rows) ins.run(randomUUID(), runId, r.url, r.performance ?? null, r.accessibility ?? null, r.bestPractices ?? null, r.seo ?? null, r.lcpMs ?? null, r.cls ?? null, r.tbtMs ?? null, r.budgetFailed ?? null, r.warnings ?? null);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  listLighthouseResults(runId) { return this.db.prepare('SELECT * FROM lighthouse_results WHERE run_id=? ORDER BY url').all(runId); }

  // ─── Artifacts ───────────────────────────────────────────────────────────
  addArtifact({ id, runId, kind, path, bytes }) {
    this.db.prepare('INSERT INTO artifacts (id, run_id, kind, path, bytes, created_at) VALUES (?,?,?,?,?,?)').run(id ?? randomUUID(), runId, kind, path, bytes ?? null, new Date().toISOString());
  }
  listArtifacts(runId) { return this.db.prepare('SELECT * FROM artifacts WHERE run_id=? ORDER BY path').all(runId); }

  // ─── Reports ─────────────────────────────────────────────────────────────
  createReport({ id, sessionId, scope, runIds, builtBy }) {
    this.db.prepare('INSERT INTO reports (id, session_id, scope, status, run_ids, built_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, sessionId, scope, 'queued', JSON.stringify(runIds ?? []), builtBy ?? null, new Date().toISOString());
    return this.getReport(id);
  }
  getReport(id) { return this.db.prepare('SELECT * FROM reports WHERE id=?').get(id); }
  listReportsBySession(sessionId) { return this.db.prepare('SELECT * FROM reports WHERE session_id=? ORDER BY created_at DESC').all(sessionId); }
  patchReport(id, fields) {
    const allowed = ['status', 'run_ids', 'path', 'error', 'built_at'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(k === 'run_ids' && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]); }
    if (!set.length) return this.getReport(id);
    vals.push(id);
    this.db.prepare(`UPDATE reports SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getReport(id);
  }
  getReportByScope(sessionId, scope) { return this.db.prepare('SELECT * FROM reports WHERE session_id=? AND scope=?').get(sessionId, scope); }

  // ─── Settings ────────────────────────────────────────────────────────────
  getSetting(key) { const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r?.value; }
  getSettings() { return Object.fromEntries(this.db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])); }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }

  // ─── Audit ───────────────────────────────────────────────────────────────
  audit({ userId, action, entity, entityId, detail }) {
    this.db.prepare('INSERT INTO audit_log (id, user_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), userId ?? null, action, entity, entityId ?? null, detail ?? null, new Date().toISOString());
  }
  listAudit({ limit = 50, entity } = {}) {
    let sql = 'SELECT * FROM audit_log'; const vals = [];
    if (entity) { sql += ' WHERE entity=?'; vals.push(entity); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    vals.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
    return this.db.prepare(sql).all(...vals);
  }

  ping() { this.db.prepare('SELECT 1').get(); }
  close() { this.db.close(); }
}

function parseOrigins(row) {
  if (row && typeof row.origins === 'string') {
    try { row.origins = JSON.parse(row.origins); } catch { /* biarkan string */ }
  }
  return row;
}
