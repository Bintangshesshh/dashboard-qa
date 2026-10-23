-- Sinkron editor ↔ disk: simpan hash file terakhir yang kita tulis/baca.
-- NULL = belum pernah sinkron (run lama hasil import-test-files).
ALTER TABLE test_files ADD COLUMN disk_hash TEXT;
