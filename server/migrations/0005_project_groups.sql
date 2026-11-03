-- T01: Grup project, constraint, backfill
CREATE TABLE project_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES project_groups(id);
CREATE INDEX projects_group ON projects(group_id);

-- Backfill: satu grup per project lama, nama dari project.
-- Kalau ada nama duplikat, INSERT UNIQUE gagal → migrasi berhenti dengan error jelas.
INSERT INTO project_groups (id, name, created_at)
SELECT 'g_' || slug, name, created_at FROM projects;

UPDATE projects SET group_id = 'g_' || slug;

-- Constraint baru: nama project unik global (case-insensitive).
-- Data aktual aman: 3 nama unik.
CREATE UNIQUE INDEX projects_name_nocase ON projects(name COLLATE NOCASE);

-- Path test file unik global, bukan hanya per project.
-- Data aktual aman: 6 path unik.
CREATE UNIQUE INDEX test_files_path_unique ON test_files(path);

-- Default reuse turun dari 240 ke 60 menit.
UPDATE settings SET value = '60'
WHERE key = 'session_reuse_minutes' AND value = '240';
