# Playbook - QA Dashboard

Dashboard QA internal: sesi run Playwright + Lighthouse CI, hasil per test case, log live, dan laporan sesi yang bisa diterbitkan.

Kontrak produk ada di `docs/PRD.md`, cara install di `docs/SETUP.md` (keduanya internal, tidak di-commit).

## Batas keamanan

**Penulis test bisa menjalankan kode Node apa pun di runner. Ini bukan sandbox.** Jalankan di VM/container terisolasi, tanpa kredensial perusahaan di luar akun test, tanpa Docker socket, tanpa akses DB produksi. `TARGET_ALLOWLIST` hanya membatasi origin target yang dikonfigurasi; ia tidak bisa membatasi kode yang dikirim. Log, trace, screenshot, dan report HTML bisa memuat data sensitif.

## Peta proyek

- `server/index.mjs` - REST API + WebSocket log + penyajian artifact/laporan
- `server/store.mjs` - skema SQLite v7 + migrasi + query
- `server/runner.mjs` - eksekusi Playwright/Lighthouse, cancel, timeout, parsing hasil
- `server/validation.mjs` - validasi request + allowlist target
- `server/migrations/` - `0001_schema_v5.sql` s.d. `0007_run_indexes.sql` (skema = `user_version` 7)
- `web/app/(dashboard)/` - Overview, Playwright, Lighthouse, Reports; `run-terminal.tsx` panel log live, `settings/` admin
- `web/app/(auth)/login/` - login
- `web/lib/playbook.ts` - klien API bertipe
- `scripts/build-session-report.mjs` - adapter DB → HTML laporan di `.reports/<reportId>/`
- `scripts/build-report-docs.mjs`, `report-html.mjs`, `report-md.mjs` - render folder report + markdown evaluasi
- `scripts/migrate.mjs`, `seed-projects.mjs`, `seed-user.mjs` - setup (grup + project + akun)
- `scripts/backup.mjs`, `retention.mjs` - backup DB + retensi
- `lighthouserc.*.js` - konfigurasi Lighthouse per project, diubah dari tab **Pengaturan > Lighthouse**
- `eureka/` - spec Playwright per target

## Jalankan

```powershell
npm install
npm install --prefix server
npm install --prefix web
npx playwright install chromium
copy .env.example .env      # isi DATABASE_URL, TARGET_ALLOWLIST
node --experimental-sqlite scripts/migrate.mjs
node --experimental-sqlite scripts/seed-projects.mjs   # 3 grup + 3 project
node scripts/seed-user.mjs --username admin --role admin

npm run dev:server          # terminal 1 → http://127.0.0.1:3001
npm run dev:web             # terminal 2 → http://127.0.0.1:3100
```

Perintah lain:

```powershell
npm test                    # unit test backend (wajib hijau sebelum commit)
npm run typecheck --prefix web
npm run build --prefix web
npm run backup              # backup DB ke data/backups/
npm run retention           # jalankan retensi data
npm run fixture             # server target lokal untuk uji
```

Detail lengkap, verifikasi tiap langkah, dan troubleshooting: `docs/SETUP.md`.

## Grup, project, dan arsip

Project dikelompokkan per grup. Semua pengelolaan ada di **Pengaturan**:

| Tab | Isi |
|---|---|
| Project | pohon grup > project, tambah/ubah grup, tambah project, arsip |
| Playwright | spec per project, status aktif/nonaktif |
| Lighthouse | editor `lighthouserc`: URL, jumlah run, budget |
| Report | retensi report dan batas upload |
| Bantuan | versi tool, perintah update, FAQ, tautan feedback |

Aturan penting:

- **Hapus permanen** hanya untuk project tanpa riwayat run. Project yang sudah punya run harus **diarsipkan** (`PATCH active=0`); run dan laporannya tetap bisa dibaca.
- Project arsip tidak muncul di dropdown run, tapi tetap tampil di Reports dengan label `Arsip`.
- Satu sesi dipakai ulang selama belum ada run baru dalam `session_reuse_minutes` (default 20 menit, diatur di **Pengaturan > Report**). Patokannya run terakhir, bukan waktu sesi dibuat, jadi run yang berurutan tetap satu sesi dan sesi yang didiamkan tertutup sendiri. Tombol **Sesi baru** memaksa sesi terpisah; **Tutup sesi** menutup sesi sekarang dan run berikutnya membuat sesi baru.
- Semua waktu di UI ditampilkan dalam WIB.

## Token CLI

Token CLI berbeda dari login dashboard. Token dibuat lewat CLI:

```powershell
npm run playbook -- login --server http://127.0.0.1:3001
```

Token disimpan di `~/.playbook/credentials.json`. Daftar dan pencabutan token ada di **Pengaturan > Bantuan** (tidak ada tombol buat token manual). Cabut dari UI, lalu jalankan `npm run playbook -- logout` di mesin yang memakainya.

## Update tool

```powershell
npm install -D @playwright/test@latest @lhci/cli@latest
npx playwright install
```

Perintah yang sama ditampilkan di **Pengaturan > Bantuan** beserta versi yang terpasang. Isi `FEEDBACK_URL` di `.env` untuk menampilkan tautan feedback di tab itu.
