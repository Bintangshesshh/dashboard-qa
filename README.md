# Playbook - QA Dashboard

Dashboard QA untuk menjalankan **Playwright** dan **Lighthouse CI**, memantau run secara live, dan menerbitkan laporan per sesi. Satu tempat untuk grup produk, project, spec, hasil test case, log, screenshot, video, trace, dan report HTML/JSON/Markdown.

Stack: Node.js 22, Express, SQLite (`node:sqlite`), Next.js 16, React 19, Playwright, LHCI.

## Peringatan keamanan

**Penulis spec bisa menjalankan kode Node apa pun di runner. Ini bukan sandbox.**

Jalankan runner di VM/container terisolasi. Jangan simpan kredensial perusahaan di mesin runner selain akun test. Jangan mount Docker socket, database produksi, atau folder sensitif. `TARGET_ALLOWLIST` dan `origins` project hanya membatasi origin target, bukan kode yang dikirim. Log, trace, screenshot, video, dan report bisa memuat data sensitif.

## Fitur

- **Overview**: KPI pass rate gabungan, grafik run 7/14/30 hari, kartu project per grup, riwayat run per project.
- **Playwright**: banyak spec per project, pilih spec, editor kode dengan autosave, pilih environment, konfirmasi production, antrean run, stop run, log/console/network live, layar live, rekam video, mode debug (slow motion, pause/step), report dan trace.
- **Lighthouse CI**: satu config per project, URL audit ikut environment project, jumlah run, budget per kategori, hasil per URL.
- **Report**: daftar per grup dan project, detail sesi, publish report Playwright/Lighthouse/gabungan, report HTML/JSON/Markdown, retensi.
- **Pengaturan**: grup dan project, URL target per environment, origin yang diizinkan, spec dan config, retensi report, bantuan dan update tool.
- **Keamanan**: login cookie sesi, role `admin` dan `viewer`, allowlist target, audit log. Tidak ada token CLI.

Pass rate = `(TC Playwright lulus + run Lighthouse lulus) / (TC Playwright lulus + TC Playwright gagal + run Lighthouse lulus + run Lighthouse gagal)`. Satu run Lighthouse dihitung satu nilai.

## Kebutuhan

- Node.js **22** atau lebih baru (wajib untuk `node:sqlite`).
- npm.
- Chromium untuk Playwright/Lighthouse.
- Windows, Linux, atau macOS. Docker opsional.

## Instalasi untuk development

Jalankan dari root repo.

```powershell
npm install
npm install --prefix server
npm install --prefix web
npx playwright install chromium
Copy-Item .env.example .env
```

Isi minimal `.env`:

```dotenv
DATABASE_URL=sqlite:./data/playbook.db
TARGET_ALLOWLIST=http://127.0.0.1:3000,http://localhost:3000
```

Buat akun admin pertama (password ditanyakan interaktif):

```powershell
node --experimental-sqlite --env-file=.env scripts/seed-user.mjs --username admin --role admin
```

Opsional, isi 3 grup + 3 project contoh (Jaja.id, Eureka Bookhouse, Master Diskon):

```powershell
node --experimental-sqlite --env-file=.env scripts/seed-projects.mjs
```

Jalankan dua terminal:

```powershell
# terminal 1 - API, WebSocket, runner
npm run dev:server
```

```powershell
# terminal 2 - UI
npm run dev:web
```

Buka `http://127.0.0.1:3100`.

Database dibuat otomatis saat server pertama kali jalan. Migrasi berjalan sendiri sampai `user_version` terbaru (saat ini migrasi `0008`). Untuk menjalankan migrasi manual:

```powershell
node --experimental-sqlite --env-file=.env scripts/migrate.mjs
```

## Konfigurasi `.env`

| Variabel | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | wajib | `sqlite:./data/playbook.db` |
| `TARGET_ALLOWLIST` | wajib | Origin target yang boleh dijalankan. Persis skema+host+port, pisahkan koma, tanpa wildcard |
| `RUNS_DIR` | `.runs` | Log, artifact, frame live per run |
| `REPORTS_DIR` | `.reports` | Report yang sudah diterbitkan |
| `RUN_TIMEOUT_MS` | `300000` | Timeout run Playwright. `.env.example` memakai `900000` |
| `RETENTION_INTERVAL_MS` | `0` | Interval retensi otomatis; `0` = nonaktif. `.env.example` memakai `86400000` |
| `BACKUP_INTERVAL_MS` | `0` | Interval backup otomatis; `0` = nonaktif. `.env.example` memakai `86400000` |
| `BACKUP_DIR` | `data/backups` | Folder backup SQLite |
| `BACKUP_KEEP_DAYS` | `7` | Umur backup yang disimpan |
| `HOST` | `127.0.0.1` | Bind API |
| `PORT` | `3001` | Port API |
| `COOKIE_SECURE` | `false` | Set `true` di belakang HTTPS |
| `API_INTERNAL_URL` | `http://127.0.0.1:3001` | Dipakai proxy UI ke API |
| `PROXY_TIMEOUT_MS` | `120000` | Timeout proxy; generator butuh waktu crawl |
| `FEEDBACK_URL` | kosong | Tautan feedback di tab Bantuan |
| `EUREKABOOKHOUSE_*`, `JAJA_*`, `MASTERDISKON_*` | kosong | Kredensial akun test untuk spec login |

Origin project yang sah ada di dua tempat: `TARGET_ALLOWLIST` dan `projects.origins`. Env `local`, `staging`, dan `production` tetap dicek ke allowlist yang sama.

## Alur pemakaian

1. **Pengaturan > Project**: buat grup, project, `base_url`, `staging_url`, `local_url`, dan `origins`. Centang izin production hanya untuk project yang memang boleh diuji di production.
2. **Pengaturan > Playwright**: buat spec lewat generator (crawl template atau journey) atau tambah spec manual. Spec bisa dinonaktifkan tanpa dihapus.
3. **Playwright**: pilih project, environment, dan spec. Klik **Run**. Untuk production, ketik nama project sebagai konfirmasi. Pantau log dan layar live, lalu buka **Detail sesi**.
4. **Pengaturan > Lighthouse CI**: atur URL tambahan, jumlah run, dan skor minimum per kategori. Satu project hanya punya satu config.
5. **Lighthouse**: pilih project dan environment, lalu **Run**. URL config yang host-nya milik project otomatis digeser ke origin environment terpilih.
6. **Report**: buka sesi, publish report per tool atau gabungan, lalu unduh HTML/JSON/Markdown.

## Aturan penting

- **Hapus permanen project** menghapus sesi, run, report, dan folder artifact. Konfirmasi dengan mengetik nama project.
- Project yang masih punya run sebaiknya **diarsipkan**. Project arsip tidak muncul di dropdown run tetapi report-nya tetap bisa dibuka.
- **Hapus test file** hanya untuk file yang belum pernah dipakai run. File yang sudah dipakai harus **dinonaktifkan**.
- Satu sesi dipakai ulang selama belum ada run baru dalam `session_reuse_minutes` (default 20 menit, diatur di **Pengaturan > Report**). **Sesi baru** memaksa sesi terpisah.
- Semua waktu UI ditampilkan dalam **WIB**.
- File spec Playwright di disk dan `test_files.code` di database disinkronkan. Jika file di disk berubah di luar dashboard, simpan akan ditolak sampai user memilih timpa atau muat ulang.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev:server` | API + WebSocket + runner di port 3001 |
| `npm run dev:web` | UI Next.js di port 3100 |
| `npm test` | Test backend |
| `npm test --prefix server` | Sama dengan di atas |
| `npm run typecheck --prefix web` | Typecheck TypeScript |
| `npm run build` | Build UI production |
| `npm run backup` | Backup SQLite ke `data/backups/` |
| `npm run retention` | Jalankan retensi sekali |
| `npm run fixture` | Server target lokal untuk uji coba |
| `npm run test:report` | Test renderer report HTML |
| `npm run test:md` | Test renderer report Markdown |
| `npm run test:editor` | Cek istilah di editor |
| `npm run test:integration` | Verifikasi alur dashboard |

## Struktur proyek

```text
server/
  index.mjs            REST API, WebSocket log, artifact, layar live, auth
  runner.mjs           eksekusi Playwright/Lighthouse, timeout, cancel, capture
  spec-generator.mjs   generator template dan journey
  store.mjs            SQLite + migrasi + query
  validation.mjs       validasi request dan allowlist target
  migrations/          skema 0001-0008
  test/                test backend
web/
  app/(auth)/login/    halaman login
  app/(dashboard)/     Overview, Playwright, Lighthouse, Report, Pengaturan
  app/_components/     komponen bersama (run bar, editor config LH, dll.)
  lib/playbook.ts      klien API bertipe
scripts/
  pw-capture.cjs       preload Playwright untuk frame layar live
  build-session-report.mjs
  report-html.mjs, report-md.mjs, report-css.mjs
  migrate.mjs, seed-projects.mjs, seed-user.mjs
  backup.mjs, retention.mjs
eureka/                spec Playwright per target
tests/                 spec tambahan
lighthouserc.*.js      config Lighthouse per project (diubah dari UI)
```

## Layar live dan debug

- Frame layar live ditulis sebagai JPEG ke `.runs/<runId>/live/` oleh preload `scripts/pw-capture.cjs`.
- Panel **Layar** hanya menerima frame untuk run yang dimulai setelah backend versi terbaru aktif.
- **Rekam video** menyimpan WebM tiap test dan membuat ukuran artifact lebih besar.
- **Debug** mengaktifkan slow motion, timeout lebih panjang, serta tombol pause/step di panel layar.
- Setelah run final, hanya sekitar 60 frame terakhir yang disimpan untuk scrub.

## Docker

Isi `TARGET_ALLOWLIST` dan variabel lain yang diperlukan, lalu:

```powershell
$env:TARGET_ALLOWLIST="http://host.docker.internal:3000"
docker compose up --build
```

UI tersedia di `http://127.0.0.1:8080` (ubah `DASHBOARD_PORT` bila perlu). Service: `backend` (runner + API), `web` (Next.js), `gateway` (nginx). Data disimpan di volume Docker.

Untuk production, set `COOKIE_SECURE=true` dan taruh gateway di belakang HTTPS.

## Update tool

```powershell
npm install -D @playwright/test@latest @lhci/cli@latest
npx playwright install chromium
```

Versi terpasang bisa dilihat di **Pengaturan > Bantuan**.

## Troubleshooting

- **`EPERM: operation not permitted, unlink ... web/.next/...`**: hentikan semua proses `dev:web`, hapus `web/.next`, lalu jalankan ulang. Jangan menjalankan dua `next dev` sekaligus.
- **`TARGET_ALLOWLIST harus berisi minimal satu origin persis`**: isi `.env` dengan origin lengkap, bukan wildcard.
- **Target ditolak**: pastikan origin ada di `TARGET_ALLOWLIST` atau `origins` project, termasuk port.
- **Layar live kosong / 404**: restart backend setelah update, lalu mulai run baru.
- **Run production ditolak**: centang izin production di project dan ketik nama project persis.
- **Spec tidak bisa dihapus**: file sudah dipakai run. Nonaktifkan lewat tombol **Nonaktifkan**.
