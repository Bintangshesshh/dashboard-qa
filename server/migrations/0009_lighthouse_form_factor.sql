-- Lighthouse per device: mobile/desktop boleh punya URL yang sama dalam satu run.
-- Recreate table karena UNIQUE(run_id,url) harus menjadi UNIQUE(run_id,url,form_factor).
CREATE TABLE lighthouse_results_new (
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
  report_path    TEXT,
  form_factor    TEXT NOT NULL DEFAULT 'mobile',
  locale         TEXT,
  UNIQUE (run_id, url, form_factor)
);

INSERT INTO lighthouse_results_new (
  id, run_id, url, performance, accessibility, best_practices, seo,
  lcp_ms, cls, tbt_ms, budget_failed, warnings, report_path, form_factor, locale
)
SELECT
  id, run_id, url, performance, accessibility, best_practices, seo,
  lcp_ms, cls, tbt_ms, budget_failed, warnings, report_path, 'mobile', NULL
FROM lighthouse_results;

DROP TABLE lighthouse_results;
ALTER TABLE lighthouse_results_new RENAME TO lighthouse_results;
