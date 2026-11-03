-- Query daftar run mengurutkan dari terbaru tanpa index yang cocok, sehingga
-- SQLite memindai seluruh tabel lalu mengurutkan di temp B-tree. Halaman Home
-- memanggilnya tiap 5 detik hanya untuk 8 baris.
CREATE INDEX runs_queued ON runs(queued_at DESC);

-- Grafik harian mengelompokkan per tanggal run final.
CREATE INDEX runs_finalized ON runs(finalized_at) WHERE finalized_at IS NOT NULL;
