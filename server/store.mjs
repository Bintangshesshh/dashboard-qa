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
    this.db.exec(`CREATE TABLE IF NOT EXISTS qa_categories (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_suites (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_cases (id TEXT PRIMARY KEY, suite_id TEXT NOT NULL REFERENCES qa_suites(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_logs (run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,seq));
      CREATE INDEX IF NOT EXISTS qa_cases_suite_id ON qa_cases(suite_id);`);
    this.recover();
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

  async ping() { this.db.prepare('SELECT 1').get(); }
  async close() { this.db.close(); }
}
