-- Default jendela reuse turun 60 ke 20 menit, dan sekarang dihitung dari
-- run terakhir (bukan waktu sesi dibuat). Satu sesi = satu sesi kerja.
-- Hanya mengubah nilai bawaan; setelan yang sudah diubah user tidak disentuh.
UPDATE settings SET value = '20'
WHERE key = 'session_reuse_minutes' AND value = '60';
