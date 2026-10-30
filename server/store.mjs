import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const tables = { suites: 'qa_suites', cases: 'qa_cases', runs: 'qa_runs', categories: 'qa_categories' };

// Accepts sqlite:./data/qa.db, file:/data/qa.db, a plain path or :memory:.
export function databasePath(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required; SQLite persistence cannot be disabled');
  const value = connectionString.replace(/^sqlite:/, '').replace(/^file:/, '').replace(/^\/\//, '');
  if (!value) throw new Error('DATABASE_URL must point to a SQLite database file');
  return value === ':memory:' ? value : resolve(value);
}

export class Store {
  constructor(connectionString) {
    this.path = databasePath(connectionString);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
  }
  async init() {
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS qa_categories (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_suites (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_cases (id TEXT PRIMARY KEY, suite_id TEXT NOT NULL REFERENCES qa_suites(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_logs (run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,seq));
      CREATE TABLE IF NOT EXISTS qa_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','member')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS qa_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES qa_users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS qa_cases_suite_id ON qa_cases(suite_id);
      CREATE INDEX IF NOT EXISTS qa_sessions_user_id ON qa_sessions(user_id);
      CREATE INDEX IF NOT EXISTS qa_sessions_expires_at ON qa_sessions(expires_at);`);
    this.recover();
    await this.cleanupSessions();
  }
  recover() {
    this.db.prepare(`UPDATE qa_runs SET data = json_set(data,'$.status','interrupted','$.docsStatus','interrupted','$.finishedAt',?,'$.error','Server restarted during execution') WHERE json_extract(data,'$.status') IN ('queued','running','cancelling')`).run(new Date().toISOString());
    this.db.prepare(`UPDATE qa_runs SET data = json_set(data,'$.docsStatus','interrupted','$.docsError','Server restarted during report generation') WHERE json_extract(data,'$.docsStatus') = 'building'`).run();
  }

  // ─── List with pagination ────────────────────────────────────────────────
  async list(kind, suiteId, { limit, offset } = {}) {
    const table = this.table(kind);
    if (kind === 'cases' && suiteId) {
      return this.db.prepare(`SELECT data FROM ${table} WHERE suite_id=? ORDER BY json_extract(data,'$.createdAt')`)
        .all(suiteId).map(row => JSON.parse(row.data));
    }
    // Apply pagination with safe defaults
    const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    return this.db.prepare(`SELECT data FROM ${table} ORDER BY json_extract(data,'$.createdAt') DESC LIMIT ? OFFSET ?`)
      .all(safeLimit, safeOffset).map(row => JSON.parse(row.data));
  }

  // ─── Count ───────────────────────────────────────────────────────────────
  async count(kind) {
    const table = this.table(kind);
    return this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
  }

  table(kind) { const name = tables[kind]; if (!name) throw new Error('Invalid table'); return name; }
  async get(kind,id) { const row = this.db.prepare(`SELECT data FROM ${this.table(kind)} WHERE id=?`).get(id); return row ? JSON.parse(row.data) : undefined; }

  async patch(kind,id,transform) {
    const table=this.table(kind);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
      if(!row){this.db.exec('COMMIT');return undefined;}
      const data=transform(JSON.parse(row.data));
      this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(data),id);
      this.db.exec('COMMIT');return data;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }

  async put(kind,data) {
    if(kind === 'cases') this.db.prepare('INSERT INTO qa_cases(id,suite_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET suite_id=EXCLUDED.suite_id, data=EXCLUDED.data').run(data.id,data.suiteId,JSON.stringify(data));
    else this.db.prepare(`INSERT INTO ${this.table(kind)}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`).run(data.id,JSON.stringify(data));
    return data;
  }

  async delete(kind,id) { return this.db.prepare(`DELETE FROM ${this.table(kind)} WHERE id=?`).run(id).changes > 0; }

  // ─── Delete category atomically — nullify categoryId on all related suites ─
  async deleteCategory(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Nullify categoryId on all suites that reference this category
      const suites = this.db.prepare(`SELECT id, data FROM qa_suites WHERE json_extract(data,'$.categoryId')=?`).all(id);
      for (const row of suites) {
        const data = JSON.parse(row.data);
        data.categoryId = null;
        this.db.prepare(`UPDATE qa_suites SET data=? WHERE id=?`).run(JSON.stringify(data), row.id);
      }
      const result = this.db.prepare(`DELETE FROM qa_categories WHERE id=?`).run(id);
      this.db.exec('COMMIT');
      return result.changes > 0;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }

  async log(runId,entry) { this.db.prepare('INSERT INTO qa_logs(run_id,seq,data) VALUES(?,?,?)').run(runId,entry.seq,JSON.stringify(entry)); }

  // ─── Logs with limit ─────────────────────────────────────────────────────
  async logs(runId, after = 0, limit = 5000) {
    const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 10000);
    const rows = this.db.prepare('SELECT data FROM qa_logs WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?')
      .all(runId, after, safeLimit + 1);
    const hasMore = rows.length > safeLimit;
    const entries = rows.slice(0, safeLimit).map(row => JSON.parse(row.data));
    const nextAfter = entries.length ? entries[entries.length - 1].seq : after;
    return { logs: entries, hasMore, nextAfter };
  }

  // ─── Raw logs for backward compat (returns array only) ───────────────────
  async logsRaw(runId, after = 0) {
    return this.db.prepare('SELECT data FROM qa_logs WHERE run_id=? AND seq>? ORDER BY seq')
      .all(runId, after).map(row => JSON.parse(row.data));
  }

  // ─── All logs as text for download ───────────────────────────────────────
  async logsText(runId) {
    return this.db.prepare('SELECT data FROM qa_logs WHERE run_id=? ORDER BY seq')
      .all(runId).map(row => JSON.parse(row.data).text).join('');
  }

  // ─── Accounts and sessions ───────────────────────────────────────────────
  userFromRow(row) {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async countUsers() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM qa_users').get().count;
  }

  async countAdmins() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM qa_users WHERE role='admin'").get().count;
  }

  async getUser(id) {
    const row = this.db.prepare('SELECT * FROM qa_users WHERE id=?').get(id);
    return row ? this.userFromRow(row) : undefined;
  }

  async getUserByEmail(email) {
    const row = this.db.prepare('SELECT * FROM qa_users WHERE email=? COLLATE NOCASE').get(email);
    return row ? this.userFromRow(row) : undefined;
  }

  async listUsers() {
    return this.db.prepare('SELECT * FROM qa_users ORDER BY created_at').all().map(row => this.userFromRow(row));
  }

  async createUser(user) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const role = user.role ?? (this.db.prepare('SELECT COUNT(*) AS count FROM qa_users').get().count === 0 ? 'admin' : 'member');
      if (!['admin', 'member'].includes(role)) throw new Error('Invalid user role');
      const now = new Date().toISOString();
      const email = user.email.trim().toLowerCase();
      this.db.prepare(`INSERT INTO qa_users(id,email,name,password_hash,role,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(
        user.id, email, user.name, user.passwordHash, role,
        user.createdAt ?? now, user.updatedAt ?? now,
      );
      this.db.exec('COMMIT');
      return this.getUser(user.id);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async updateUser(id, patch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM qa_users WHERE id=?').get(id);
      if (!row) { this.db.exec('COMMIT'); return undefined; }
      const current = this.userFromRow(row);
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      if (!['admin', 'member'].includes(next.role)) throw new Error('Invalid user role');
      if (current.role === 'admin' && next.role !== 'admin') {
        if (this.db.prepare("SELECT COUNT(*) AS count FROM qa_users WHERE role='admin'").get().count <= 1) {
          throw Object.assign(new Error('Cannot demote the last administrator'), { code: 'LAST_ADMIN' });
        }
      }
      this.db.prepare(`UPDATE qa_users SET email=?, name=?, password_hash=?, role=?, updated_at=? WHERE id=?`)
        .run(next.email.trim().toLowerCase(), next.name, next.passwordHash, next.role, next.updatedAt, id);
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async deleteUser(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM qa_users WHERE id=?').get(id);
      if (!row) { this.db.exec('COMMIT'); return false; }
      if (row.role === 'admin' && this.db.prepare("SELECT COUNT(*) AS count FROM qa_users WHERE role='admin'").get().count <= 1) {
        throw Object.assign(new Error('Cannot remove the last administrator'), { code: 'LAST_ADMIN' });
      }
      this.db.prepare('DELETE FROM qa_sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM qa_users WHERE id=?').run(id);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async createSession(session) {
    this.db.prepare(`INSERT INTO qa_sessions(token_hash,user_id,csrf_token,created_at,expires_at)
      VALUES(?,?,?,?,?)`).run(
      session.tokenHash, session.userId, session.csrfToken, session.createdAt, session.expiresAt,
    );
    return session;
  }

  async getSession(tokenHash) {
    const row = this.db.prepare(`SELECT s.token_hash, s.csrf_token, s.created_at, s.expires_at,
        u.id AS user_id, u.email, u.name, u.password_hash, u.role,
        u.created_at AS user_created_at, u.updated_at AS user_updated_at
      FROM qa_sessions s JOIN qa_users u ON u.id = s.user_id
      WHERE s.token_hash=?`).get(tokenHash);
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: row.user_created_at,
        updatedAt: row.user_updated_at,
      },
    };
  }

  async deleteSession(tokenHash) {
    return this.db.prepare('DELETE FROM qa_sessions WHERE token_hash=?').run(tokenHash).changes > 0;
  }

  async deleteUserSessions(userId) {
    return this.db.prepare('DELETE FROM qa_sessions WHERE user_id=?').run(userId).changes;
  }

  async cleanupSessions(now = new Date().toISOString()) {
    this.db.prepare('DELETE FROM qa_sessions WHERE expires_at <= ?').run(now);
  }

  async ping() { this.db.prepare('SELECT 1').get(); }
  async close() { this.db.close(); }
}
