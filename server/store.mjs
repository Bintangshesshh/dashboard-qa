import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAnsi } from './ansi.mjs';

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
    this.logBytesCache = new Map();
  }

  async init() {
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    if (this.path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
    return this.recover();
  }

  migrate() {
    if (this.path === ':memory:') {
      for (const name of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
        this.db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
        this.db.exec(`PRAGMA user_version = ${Number(name.slice(0, 4))}`);
      }
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

  // PRD §8.6: run `uploading` tanpa finalisasi > 24 jam dibersihkan saat startup.
  // store tidak tahu path folder, jadi id-nya dikembalikan untuk dihapus pemanggil.
  recover({ staleUploadMs = 24 * 60 * 60 * 1000 } = {}) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - staleUploadMs).toISOString();
    const stale = this.db.prepare(
      `SELECT id FROM runs WHERE status='uploading' AND COALESCE(started_at, queued_at) < ?`,
    ).all(cutoff).map(r => r.id);
    for (const id of stale) {
      this.db.prepare(`UPDATE runs SET status='interrupted', error=COALESCE(error,'Upload artifact tidak difinalisasi > 24 jam'), finished_at=COALESCE(finished_at, ?) WHERE id=?`)
        .run(now.toISOString(), id);
      // Baris artifact ikut hilang supaya UI tidak menaut ke file yang sudah dibuang.
      this.db.prepare('DELETE FROM artifacts WHERE run_id=?').run(id);
    }
    this.db.prepare(`UPDATE runs SET status='interrupted', error=COALESCE(error,'Server restarted during execution'), finished_at=COALESCE(finished_at, ?) WHERE status IN ('queued','running','uploading')`).run(now.toISOString());
    this.db.prepare(`UPDATE reports SET status='failed', error=COALESCE(error,'Server restarted during report build') WHERE status IN ('queued','building')`).run();
    return stale;
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

  // ─── Project groups ──────────────────────────────────────────────────────
  // Grup hanya wadah: tidak punya URL, spec, config, run, atau report.
  listProjectGroups() {
    return this.db.prepare(`SELECT g.id, g.name, g.created_at,
      (SELECT COUNT(*) FROM projects p WHERE p.group_id = g.id) AS project_count
      FROM project_groups g ORDER BY g.name`).all();
  }
  getProjectGroup(id) { return this.db.prepare('SELECT * FROM project_groups WHERE id=?').get(id); }
  projectGroupByName(name) { return this.db.prepare('SELECT * FROM project_groups WHERE name=? COLLATE NOCASE').get(name); }
  countProjectsInGroup(groupId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE group_id=?').get(groupId).n;
  }
  createProjectGroup({ id, name }) {
    this.db.prepare('INSERT INTO project_groups (id, name, created_at) VALUES (?,?,?)')
      .run(id, name, new Date().toISOString());
    return this.getProjectGroup(id);
  }
  patchProjectGroup(id, name) {
    this.db.prepare('UPDATE project_groups SET name=? WHERE id=?').run(name, id);
    return this.getProjectGroup(id);
  }
  deleteProjectGroup(id) { return this.db.prepare('DELETE FROM project_groups WHERE id=?').run(id).changes > 0; }

  // ─── Projects ────────────────────────────────────────────────────────────
  // includeArchived dipakai report/breadcrumb/Seting: `active=0` = arsip.
  listProjects({ includeArchived = false } = {}) {
    return this.db.prepare(`SELECT p.*, g.name AS group_name,
      (SELECT MAX(r.finished_at) FROM runs r JOIN sessions s2 ON s2.id = r.session_id WHERE s2.project_id = p.id) AS lastRunAt
      FROM projects p LEFT JOIN project_groups g ON g.id = p.group_id
      ${includeArchived ? '' : 'WHERE p.active=1'} ORDER BY p.name`).all().map(parseOrigins);
  }
  getProject(id) {
    const row = this.db.prepare(`SELECT p.*, g.name AS group_name FROM projects p
      LEFT JOIN project_groups g ON g.id = p.group_id WHERE p.id=?`).get(id);
    return row ? parseOrigins(row) : row;
  }
  projectByName(name) { return this.db.prepare('SELECT * FROM projects WHERE name=? COLLATE NOCASE').get(name); }
  createProject({ id, slug, name, base_url, group_id = null, staging_url = null, local_url = null, origins = [], allow_production = 0 }) {
    this.db.prepare('INSERT INTO projects (id, slug, name, group_id, base_url, staging_url, local_url, origins, allow_production, active, created_at)'
      + ' VALUES (?,?,?,?,?,?,?,?,?,1,?)').run(
      id, slug, name, group_id, base_url, staging_url, local_url, JSON.stringify(origins), allow_production, new Date().toISOString(),
    );
    return this.getProject(id);
  }
  projectBySlug(slug) { const row = this.db.prepare('SELECT * FROM projects WHERE slug=?').get(slug); return row ? parseOrigins(row) : row; }
  patchProject(id, fields) {
    const allowed = ['name', 'group_id', 'base_url', 'staging_url', 'local_url', 'origins', 'allow_production', 'active'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(k === 'origins' ? JSON.stringify(fields[k]) : fields[k]); }
    if (!set.length) return this.getProject(id);
    vals.push(id);
    this.db.prepare(`UPDATE projects SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getProject(id);
  }
  // Hapus permanen hanya untuk project tanpa riwayat.
  projectHistory(projectId) {
    return this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM test_files WHERE project_id=?) AS testFiles,
      (SELECT COUNT(*) FROM sessions WHERE project_id=?) AS sessions,
      (SELECT COUNT(*) FROM runs r JOIN sessions s ON s.id=r.session_id WHERE s.project_id=?) AS runs`)
      .get(projectId, projectId, projectId);
  }
  deleteProject(id) { return this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes > 0; }

  // ─── Test files ──────────────────────────────────────────────────────────
  // includeDisabled dipakai halaman seting: spec nonaktif tetap harus kelihatan
  // supaya bisa dinyalakan lagi. Semua pemanggil run memakai default (aktif saja).
  listTestFiles({ projectId, tool, includeDisabled = false } = {}) {
    let sql = 'SELECT * FROM test_files WHERE ' + (includeDisabled ? '1=1' : 'enabled=1'); const vals = [];
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
    const allowed = ['code', 'config', 'label', 'enabled', 'disk_hash'];
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
    const row = this.db.prepare('SELECT id, created_at FROM sessions WHERE project_id=? AND env=? AND created_by=? AND closed_at IS NULL').get(projectId, env, createdBy);
    if (!row) return undefined;
    // ponytail: sesi lama yang lewat jendela ditutup di sini (bukan job retensi)
    // supaya index sessions_one_open bebas untuk sesi baru.
    const minutes = Number(this.getSetting('session_reuse_minutes') ?? 240);
    if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
    const ageMin = (Date.now() - Date.parse(row.created_at)) / 60000;
    if (ageMin <= minutes) return { id: row.id };
    this.closeSession(row.id);
    return undefined;
  }
  createSession({ id, projectId, env, targetUrl, label, createdBy }) {
    // sessions_one_open (partial unique index) → 409 pada duplikat.
    this.db.prepare('INSERT INTO sessions (id, project_id, env, target_url, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, env, targetUrl, label, createdBy ?? null, new Date().toISOString());
  }
  closeSession(id) { this.db.prepare('UPDATE sessions SET closed_at=? WHERE id=? AND closed_at IS NULL').run(new Date().toISOString(), id); }
  listSessions({ projectId, status, from, to } = {}) {
    // Ringkasan run dihitung di SQL (PRD §10.5: jumlah run per tool + gagal),
    // bukan dengan memuat semua baris run ke klien.
    let sql = `SELECT s.*, ${SESSION_STATUS_SQL} AS status,
      (SELECT COUNT(*) FROM runs r WHERE r.session_id=s.id) AS run_count,
      (SELECT COUNT(*) FROM runs r WHERE r.session_id=s.id AND r.tool='pw') AS pw_count,
      (SELECT COUNT(*) FROM runs r WHERE r.session_id=s.id AND r.tool='lh') AS lh_count,
      (SELECT COUNT(*) FROM runs r WHERE r.session_id=s.id AND r.status IN ('failed','cancelled','interrupted')) AS failed_count,
      (SELECT COUNT(*) FROM runs r WHERE r.session_id=s.id AND r.status IN ('queued','running','uploading')) AS active_count
      FROM sessions s WHERE 1=1`; const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    if (from) { sql += ' AND s.created_at>=?'; vals.push(from); }
    if (to) { sql += ' AND s.created_at<=?'; vals.push(to); }
    sql += ' ORDER BY s.created_at DESC';
    const rows = this.db.prepare(sql).all(...vals);
    for (const row of rows) row.reports = this.listReportsBySession(row.id);
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
  getRun(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row?.error) return row;
    const clean = stripAnsi(row.error);
    return clean === row.error ? row : { ...row, error: clean };
  }
  listRunsBySession(sessionId) { return this.db.prepare('SELECT * FROM runs WHERE session_id=? ORDER BY queued_at').all(sessionId); }
  listRuns({ projectId, tool, limit = 10 } = {}) {
    // Username pemilik sesi ikut dipilih: feed "Run terakhir" menampilkan siapa
    // yang menjalankan, bukan cuma project dan waktu.
    let sql = `SELECT r.*, s.label AS session_label, s.env AS env, p.name AS project_name,
      COALESCE(u.username, 'sistem') AS run_by,
      EXISTS(SELECT 1 FROM artifacts a WHERE a.run_id=r.id AND a.kind=(CASE r.tool WHEN 'lh' THEN 'lh-html' ELSE 'pw-html' END)) AS has_html
      FROM runs r JOIN sessions s ON s.id=r.session_id JOIN projects p ON p.id=s.project_id
      LEFT JOIN users u ON u.id=s.created_by WHERE 1=1`;
    const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    if (tool) { sql += ' AND r.tool=?'; vals.push(tool); }
    sql += ' ORDER BY r.queued_at DESC LIMIT ?';
    vals.push(Math.min(Math.max(Number(limit) || 10, 1), 50));
    return this.db.prepare(sql).all(...vals);
  }
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
  // PRD §7/A33: total log per run dibatasi `log_max_bytes`; bagian tengah
  // dipotong dan diganti penanda, head & tail dipertahankan.
  logBytes(runId) {
    return this.db.prepare('SELECT coalesce(sum(length(text)),0) AS n FROM run_logs WHERE run_id=?').get(runId).n;
  }
  log(runId, entry) {
    const text = String(entry.text);
    this.db.prepare('INSERT INTO run_logs (run_id, seq, stream, text, at) VALUES (?,?,?,?,?)')
      .run(runId, entry.seq, entry.stream, text, entry.at);
    const limit = Number(this.getSetting('log_max_bytes') ?? 5242880);
    const used = (this.logBytesCache.get(runId) ?? this.logBytes(runId) - text.length) + text.length;
    this.logBytesCache.set(runId, used);
    if (used > limit) this.trimLogs(runId, limit);
  }
  // Baris `system` di luar runner (mis. jejak run production) tanpa perlu tahu seq.
  lastLogSeq(runId) { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM run_logs WHERE run_id=?').get(runId).n; }
  systemLog(runId, text) {
    this.log(runId, { seq: this.lastLogSeq(runId) + 1, stream: 'system', text: text.endsWith('\n') ? text : `${text}\n`, at: new Date().toISOString() });
  }
  // Batch dari CLI: satu transaksi, trim sekali di akhir.
  // seq dihitung server (lanjut dari baris terakhir) supaya baris `system` yang
  // sudah ditulis saat run dibuat tidak menabrak seq kiriman klien.
  logsBatch(runId, entries) {
    if (!entries.length) return;
    const ins = this.db.prepare('INSERT INTO run_logs (run_id, seq, stream, text, at) VALUES (?,?,?,?,?)');
    const base = this.lastLogSeq(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      entries.forEach((e, i) => ins.run(runId, base + i + 1, e.stream, String(e.text), e.at));
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    const limit = Number(this.getSetting('log_max_bytes') ?? 5242880);
    const total = this.logBytes(runId);
    this.logBytesCache.set(runId, total);
    if (total > limit) this.trimLogs(runId, limit);
  }
  trimLogs(runId, limit) {
    const rows = this.db.prepare('SELECT seq, length(text) AS n FROM run_logs WHERE run_id=? ORDER BY seq').all(runId);
    const total = rows.reduce((s, r) => s + r.n, 0);
    if (total <= limit) { this.logBytesCache.set(runId, total); return; }
    const budget = Math.floor(limit * 0.8); // sisakan ruang untuk log berikutnya
    const headBudget = Math.floor(budget * 0.4);
    let cutTo = -1, cum = 0, head = 0;
    for (let i = 0; i < rows.length; i++) {
      const after = cum + rows[i].n;
      if (cum <= headBudget) head = i + 1;
      if (total - after >= budget - headBudget) cutTo = i;
      cum = after;
    }
    // ponytail: satu baris tunggal > limit tak bisa dipotong tengah.
    // Kalau perlu, potong per karakter di sini (head/tail char).
    if (cutTo < head) return;
    const removed = rows.slice(head, cutTo + 1);
    if (!removed.length) return;
    const markerSeq = removed[0].seq;
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM run_logs WHERE run_id=? AND seq BETWEEN ? AND ?`).run(runId, markerSeq, removed.at(-1).seq);
      db.prepare('INSERT INTO run_logs (run_id, seq, stream, text, at) VALUES (?,?,?,?,?)')
        .run(runId, markerSeq, 'system', `… [${removed.length} baris dipotong] …\n`, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    this.logBytesCache.set(runId, this.logBytes(runId));
  }
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
  listPlaywrightResults(runId) {
    // Baris lama menyimpan ANSI mentah; bersihkan saat dibaca.
    return this.db.prepare('SELECT * FROM playwright_results WHERE run_id=? ORDER BY file, title').all(runId)
      .map(r => (r.error ? { ...r, error: stripAnsi(r.error) } : r));
  }

  // ─── Lighthouse results ──────────────────────────────────────────────────
  addLighthouseResults(runId, rows) {
    const ins = this.db.prepare(`INSERT INTO lighthouse_results (id, run_id, url, performance, accessibility, best_practices, seo, lcp_ms, cls, tbt_ms, budget_failed, warnings, report_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec('BEGIN');
    try {
      for (const r of rows) ins.run(randomUUID(), runId, r.url, r.performance ?? null, r.accessibility ?? null, r.bestPractices ?? null, r.seo ?? null, r.lcpMs ?? null, r.cls ?? null, r.tbtMs ?? null, r.budgetFailed ?? null, r.warnings ?? null, r.reportPath ?? null);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  listLighthouseResults(runId) { return this.db.prepare('SELECT * FROM lighthouse_results WHERE run_id=? ORDER BY url').all(runId); }
  listLighthouseByProject({ projectId, limit = 20 } = {}) {
    let sql = `SELECT l.*, r.status AS run_status, r.queued_at, r.session_id, s.label AS session_label, s.env
      FROM lighthouse_results l
      JOIN runs r ON r.id=l.run_id
      JOIN sessions s ON s.id=r.session_id
      WHERE 1=1`;
    const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    sql += ' ORDER BY r.queued_at DESC, l.url LIMIT ?';
    vals.push(Math.min(Math.max(Number(limit) || 20, 1), 200));
    return this.db.prepare(sql).all(...vals);
  }

  // ─── Artifacts ───────────────────────────────────────────────────────────
  addArtifact({ id, runId, kind, path, bytes }) {
    this.db.prepare('INSERT INTO artifacts (id, run_id, kind, path, bytes, created_at) VALUES (?,?,?,?,?,?)').run(id ?? randomUUID(), runId, kind, path, bytes ?? null, new Date().toISOString());
  }
  listArtifacts(runId) { return this.db.prepare('SELECT * FROM artifacts WHERE run_id=? ORDER BY path').all(runId); }

  // ─── Reports ─────────────────────────────────────────────────────────────
  createReport({ id, sessionId, scope, runIds, builtBy }) {
    this.db.prepare(`INSERT INTO reports (id, session_id, scope, status, run_ids, built_by, created_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(session_id, scope) DO UPDATE SET
        status='queued', run_ids=excluded.run_ids, path=NULL, error=NULL, built_by=excluded.built_by,
        created_at=excluded.created_at, built_at=NULL`)
      .run(id, sessionId, scope, 'queued', JSON.stringify(runIds ?? []), builtBy ?? null, new Date().toISOString());
    return this.getReportByScope(sessionId, scope);
  }
  getReport(id) { return this.db.prepare('SELECT * FROM reports WHERE id=?').get(id); }
  listReportsBySession(sessionId) { return this.db.prepare('SELECT * FROM reports WHERE session_id=? ORDER BY created_at DESC').all(sessionId); }
  patchReport(id, fields) {
    const allowed = ['status', 'run_ids', 'path', 'error', 'built_at', 'mode'];
    const set = []; const vals = [];
    for (const k of allowed) if (k in fields) { set.push(`${k}=?`); vals.push(k === 'run_ids' && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]); }
    if (!set.length) return this.getReport(id);
    vals.push(id);
    this.db.prepare(`UPDATE reports SET ${set.join(', ')} WHERE id=?`).run(...vals);
    return this.getReport(id);
  }
  getReportByScope(sessionId, scope) { return this.db.prepare('SELECT * FROM reports WHERE session_id=? AND scope=?').get(sessionId, scope); }
  markReportsStale(sessionId) {
    this.db.prepare("UPDATE reports SET status='stale' WHERE session_id=? AND status='ready'").run(sessionId);
  }

  // ─── Stats (PRD §10.2) ───────────────────────────────────────────────────
  stats({ projectId, from } = {}) {
    const where = ['1=1']; const vals = [];
    if (projectId) { where.push('s.project_id=?'); vals.push(projectId); }
    if (from) { where.push('r.queued_at>=?'); vals.push(from); }
    const w = where.join(' AND ');
    const tc = this.db.prepare(`
      SELECT
        sum(CASE WHEN pr.status IN ('passed','flaky') THEN 1 ELSE 0 END) AS passed,
        sum(CASE WHEN pr.status='failed' THEN 1 ELSE 0 END) AS failed
      FROM playwright_results pr
      JOIN runs r ON r.id = pr.run_id
      JOIN sessions s ON s.id = r.session_id
      WHERE r.tool='pw' AND r.finalized_at IS NOT NULL AND ${w}`).get(...vals);
    const sessions = this.db.prepare(`
      SELECT count(*) AS total FROM sessions s WHERE ${projectId ? 's.project_id=?' : '1=1'}
        ${from ? ' AND s.created_at>=?' : ''}`).get(...(projectId ? [projectId] : []), ...(from ? [from] : []));
    const runs = this.db.prepare(`
      SELECT count(*) AS total, avg(r.duration_ms) AS avg_ms,
        sum(CASE WHEN r.status IN ('failed','cancelled','interrupted') THEN 1 ELSE 0 END) AS failed
      FROM runs r JOIN sessions s ON s.id = r.session_id
      WHERE r.finalized_at IS NOT NULL AND ${w}`).get(...vals);
    const lh = this.db.prepare(`
      SELECT avg(l.performance) AS perf, avg(l.accessibility) AS a11y,
        avg(l.best_practices) AS bp, avg(l.seo) AS seo, count(*) AS urls
      FROM lighthouse_results l
      JOIN runs r ON r.id = l.run_id
      JOIN sessions s ON s.id = r.session_id
      WHERE r.tool='lh' AND r.finalized_at IS NOT NULL AND ${w}`).get(...vals);
    // Run yang belum final tidak masuk statistik final, tapi harus terlihat.
    const active = this.db.prepare(`
      SELECT count(*) AS total FROM runs r JOIN sessions s ON s.id = r.session_id
      WHERE r.status IN ('queued','running','uploading') AND ${w}`).get(...vals);
    return {
      tcPassed: tc.passed ?? 0,
      tcFailed: tc.failed ?? 0,
      passRate: (tc.passed ?? 0) + (tc.failed ?? 0) > 0 ? (tc.passed ?? 0) / ((tc.passed ?? 0) + (tc.failed ?? 0)) : null,
      sessions: sessions.total,
      runs: runs.total,
      activeRuns: active.total,
      failedRuns: runs.failed ?? 0,
      avgDurationMs: runs.avg_ms == null ? null : Math.round(runs.avg_ms),
      lighthouse: lh.urls ? {
        urls: lh.urls,
        performance: lh.perf, accessibility: lh.a11y, bestPractices: lh.bp, seo: lh.seo,
      } : null,
    };
  }

  // PRD 10.2: "Kegagalan terbaru → klik ke /reports/<sessionId>".
  listRecentFailures({ projectId, from, limit = 5 } = {}) {
    let sql = `SELECT r.id, r.session_id, r.tool, r.status, r.error, r.finished_at,
      s.label AS session_label, s.env, p.name AS project_name
      FROM runs r
      JOIN sessions s ON s.id = r.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE r.status IN ('failed','cancelled','interrupted')`;
    const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    if (from) { sql += ' AND r.queued_at>=?'; vals.push(from); }
    sql += ' ORDER BY r.queued_at DESC LIMIT ?';
    vals.push(Math.min(Math.max(Number(limit) || 5, 1), 50));
    return this.db.prepare(sql).all(...vals);
  }

  // PRD 10.2: grafik run per hari, tanggal Jakarta.
  runsPerDay({ projectId, from } = {}) {
    let sql = `SELECT date(r.queued_at, '+7 hours') AS day, count(*) AS total,
      sum(CASE WHEN r.status='passed' THEN 1 ELSE 0 END) AS passed
      FROM runs r JOIN sessions s ON s.id = r.session_id WHERE r.finalized_at IS NOT NULL`;
    const vals = [];
    if (projectId) { sql += ' AND s.project_id=?'; vals.push(projectId); }
    if (from) { sql += ' AND r.queued_at>=?'; vals.push(from); }
    sql += ' GROUP BY day ORDER BY day';
    return this.db.prepare(sql).all(...vals);
  }

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
    // Username di-join supaya UI bisa menampilkan siapa pelakunya, bukan id mentah.
    let sql = `SELECT a.id, a.user_id, a.action, a.entity, a.entity_id, a.detail, a.created_at,
      COALESCE(u.username, 'sistem') AS username
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`;
    const vals = [];
    if (entity) { sql += ' WHERE a.entity=?'; vals.push(entity); }
    sql += ' ORDER BY a.created_at DESC LIMIT ?';
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
