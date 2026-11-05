-- Schema v5 - Playbook QA dashboard (docs/PRD.md bagian 6)
-- File 0001 = baseline penuh; user_version akhir = 1 (satu file migrasi diterapkan).

-- 1. Login
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,               -- scrypt$N$r$p$salt_b64$hash_b64
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE auth_sessions (                 -- sesi login browser (cookie pb_session)
  id         TEXT PRIMARY KEY,               -- sha256(token)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires ON auth_sessions(expires_at);

-- 2. Yang dites
CREATE TABLE projects (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  base_url         TEXT NOT NULL,
  staging_url      TEXT,
  local_url        TEXT,
  origins          TEXT NOT NULL,            -- JSON array origin yang diizinkan
  allow_production INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);

-- 3. Apa yang dijalankan
CREATE TABLE test_files (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool       TEXT NOT NULL CHECK (tool IN ('pw','lh')),
  path       TEXT NOT NULL,
  label      TEXT NOT NULL,
  code       TEXT NOT NULL,
  config     TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX test_files_project_path ON test_files(project_id, path);
CREATE INDEX test_files_project ON test_files(project_id, tool);

-- 4. Sesi run: satu project + satu environment, boleh banyak run tool
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  env        TEXT NOT NULL CHECK (env IN ('local','staging','production')),
  target_url TEXT NOT NULL,
  label      TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  closed_at  TEXT
);
CREATE INDEX sessions_project_created ON sessions(project_id, created_at DESC);
CREATE UNIQUE INDEX sessions_one_open ON sessions(project_id, env, created_by) WHERE closed_at IS NULL;

-- 5. Satu eksekusi satu tool di dalam sesi
CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  test_file_id TEXT REFERENCES test_files(id) ON DELETE SET NULL,
  tool         TEXT NOT NULL CHECK (tool IN ('pw','lh')),
  status       TEXT NOT NULL CHECK (status IN ('queued','running','uploading','passed','failed','cancelled','interrupted')),
  queued_at    TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  finalized_at TEXT,
  duration_ms  INTEGER,
  exit_code    INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX runs_session ON runs(session_id, queued_at);
CREATE INDEX runs_stale ON runs(status, queued_at);
CREATE INDEX runs_session_status ON runs(session_id, status);

-- 6. Hasil Playwright per test
CREATE TABLE playwright_results (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tc_id       TEXT,
  file        TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','flaky')),
  duration_ms INTEGER,
  retry       INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX playwright_results_run ON playwright_results(run_id, status);
CREATE UNIQUE INDEX playwright_results_tc ON playwright_results(run_id, tc_id) WHERE tc_id IS NOT NULL;

-- 7. Hasil Lighthouse per URL
CREATE TABLE lighthouse_results (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  performance    REAL,
  accessibility  REAL,
  best_practices REAL,
  seo            REAL,
  lcp_ms         INTEGER,
  cls            REAL,
  tbt_ms         INTEGER,
  budget_failed  TEXT,
  warnings       TEXT,
  UNIQUE (run_id, url)
);

-- 8. File mentah hasil tool
CREATE TABLE artifacts (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('pw-html','lh-html','pw-json','lh-json','trace','screenshot','video','log')),
  path       TEXT NOT NULL,
  bytes      INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX artifacts_run ON artifacts(run_id);

-- 9. Laporan HTML per sesi
CREATE TABLE reports (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('pw','lh','both')),
  status     TEXT NOT NULL CHECK (status IN ('queued','building','ready','failed','stale')),
  run_ids    TEXT,
  path       TEXT,
  error      TEXT,
  built_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  built_at   TEXT,
  UNIQUE (session_id, scope)
);

-- 10. Output terminal
CREATE TABLE run_logs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  stream TEXT NOT NULL,
  text   TEXT NOT NULL,
  at     TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

-- 11. Konfigurasi kecil
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('session_reuse_minutes', '240'),
  ('log_max_bytes', '5242880'),
  ('artifact_retention_days', '7'),
  ('report_retention_days', '7'),
  ('log_retention_days', '30'),
  ('max_queue_length', '10'),
  ('max_upload_mb', '100'),
  ('range_default_days', '14');

-- 12. Jejak audit
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_created ON audit_log(created_at DESC);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);
