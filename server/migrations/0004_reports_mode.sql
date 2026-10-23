-- Laporan: simpan jalur build yang dipakai supaya fallback HTML kelihatan di UI.
-- 'docs' = Docusaurus, 'html' = HTML statis cadangan.
ALTER TABLE reports ADD COLUMN mode TEXT;
