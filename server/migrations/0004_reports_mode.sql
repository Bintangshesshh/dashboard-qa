-- Laporan: simpan jalur build yang dipakai supaya fallback HTML kelihatan di UI.
-- 'docs' = folder HTML statis (index + halaman per run), 'html' = HTML satu file cadangan.
ALTER TABLE reports ADD COLUMN mode TEXT;
