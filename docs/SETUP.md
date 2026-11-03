# Setup Playbook

Panduan menjalankan dashboard Playbook dari nol. Ikuti berurutan; setiap langkah punya cara verifikasi.

---

## 1. Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | 22.5+ atau 24+ | 22.5–23 butuh flag `--experimental-sqlite` |
| npm | 10+ | ikut Node |
| Chromium (Playwright) | sesuai `@playwright/test` | `npx playwright install chromium` |
| SQLite CLI | opsional | hanya untuk backup manual |

Cek cepat:

```bash
node --version     # v22.21.1
npm --version
```

---

## 2. Ambil kode & install

```bash
git clone <repo-url> dashboard
cd dashboard
npm install
npm install --prefix web
```

Verifikasi: `node_modules/@playwright/test` dan `node_modules/@lhci/cli` ada.

---

## 3. Install browser Playwright

```bash
npx playwright install chromium
```

Linux server juga butuh dependency sistem:

```bash
npx playwright install-deps chromium
```

Verifikasi: `npx playwright --version` jalan tanpa error.

---

## 4. Buat file `.env`

```bash
cp .env.example .env
```

Isi minimal:

```env
DATABASE_URL=sqlite:./data/playbook.db
HOST=127.0.0.1
PORT=3001
DASHBOARD_PORT=8080
API_INTERNAL_URL=http://127.0.0.1:3001
RUNS_DIR=.runs
REPORTS_DIR=.reports
RUN_TIMEOUT_MS=600000
COOKIE_SECURE=false

# kredensial akun test (jangan commit)
JAJA_EMAIL=
JAJA_PASSWORD=
EUREKABOOKHOUSE_EMAIL=
EUREKABOOKHOUSE_PASSWORD=
MASTERDISKON_EMAIL=
MASTERDISKON_PASSWORD=
```

Catatan: `OPERATOR_TOKEN` **tidak dipakai lagi**. Autentikasi memakai tabel `users`.

---

## 5. Siapkan database

```bash
node --experimental-sqlite scripts/migrate.mjs       # buat 15 tabel, set user_version=5
node --experimental-sqlite scripts/seed-projects.mjs # isi 3 grup + 3 project
```

Verifikasi:

```bash
node --experimental-sqlite -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/playbook.db');console.log(db.prepare('PRAGMA user_version').get(), db.prepare('select count(*) c from project_groups').get(), db.prepare('select count(*) c from projects').get())"
```

Harapan: `user_version=5` (migrasi `0001_schema_v5.sql` s.d. `0005_project_groups.sql`), `project_groups=3`, `projects=3`.

Database lama ikut termigrasi: setiap project yang belum punya grup mendapat grup `g_<slug>` hasil backfill, jadi tidak ada project yatim. Isi `projects` dan seluruh riwayat run tetap utuh. Rollback: lihat §14.

---

## 6. Buat akun pertama (tanpa registrasi)

```bash
node scripts/seed-user.mjs --username admin --role admin
# password diminta interaktif

node scripts/seed-user.mjs --username viewer --role viewer   # opsional
```

Lupa password:

```bash
node scripts/seed-user.mjs --username admin --reset-password
```

Verifikasi: baris muncul di tabel `users`.

---

## 7. Jalankan (dua proses, dua terminal)

Terminal 1 — API:

```bash
node --experimental-sqlite --env-file=.env server/index.mjs
# → QA backend listening { address: '127.0.0.1', port: 3001 }
```

Terminal 2 — Web:

```bash
npm run dev:web
# → QA web listening on http://127.0.0.1:3100
```

Buka `http://127.0.0.1:3100` → diarahkan ke `/login`.

---

## 8. Login pertama

- Username + password dari langkah 6.
- Setelah masuk: sidebar kiri **Overview / Playwright / Lighthouse / Reports**, tombol **Logout** di paling bawah.
- Header menampilkan judul view + pilihan Project (Jaja.id, Eureka Bookhouse, Master Diskon) + Range (7/14/30/90 hari).

---

## 9. Run pertama dari dashboard

1. Buka `/playwright`, pilih project **Eureka Bookhouse**.
2. Pilih test file `eureka/cart-ebh.spec.ts`.
3. Pilih environment `local` (butuh dev server target jalan) atau `staging`.
4. Klik **Run** → terminal live muncul → tunggu selesai.
5. Setelah selesai: tabel TC (TC-EB-C1 … C5) + tombol **Buka report mentah** (HTML asli Playwright).

## 10. Run dari CLI

**Belum tersedia.** Paket `playbook` (login/run/record) belum ada di repo ini; run dijalankan oleh worker di server saat tombol **Run** ditekan. Kalau CLI dibutuhkan, itu pekerjaan terpisah (lihat `docs/RENCANA-3-HARI.md` bagian 4).

---

## 11. Terbitkan laporan sesi

1. Buka `/reports/<sessionId>`.
2. Klik **Laporan Playwright** → laporan berisi tabel TC.
3. Setelah run Lighthouse selesai, klik **Gabungan** → laporan berisi keduanya + verdict.
4. Status: `queued → building → ready`. Kalau `failed`, pesan error tampil dan hasil run tetap bisa dibuka.
5. Build ulang menimpa laporan yang sama; kalau ada run final baru, badge berubah `stale` + tombol **Build ulang**.

Laporan adalah HTML statis di `.reports/<reportId>/index.html`, disajikan di `/artifacts/reports/<reportId>/index.html`.

---

## 11b. Seting: grup, project, dan token

Halaman **Seting** hanya untuk role admin. Isinya lima tab: Project, Playwright, Lighthouse, Report, Bantuan.

1. **Project** - tambah grup, tambah project di dalam grup, ubah URL, arsipkan, atau hapus permanen.
   - Hapus permanen ditolak (409) bila project sudah punya riwayat run; pakai arsip.
   - Project arsip tetap bisa dibaca di Reports dan diberi label `Arsip`, tetapi tidak muncul di dropdown run.
2. **Playwright** - daftar spec per project, aktif/nonaktif, tambah spec baru.
3. **Lighthouse** - editor config per project: URL (maks 5, termasuk base), jumlah run (maks 10), dan budget per kategori. Config tidak valid ditolak 400 dengan pesan alasannya.
4. **Report** - `session_reuse_minutes` (default 60), retensi report, batas upload.
5. **Bantuan** - versi terpasang, perintah update, FAQ, tautan feedback (dari `FEEDBACK_URL`).

Token CLI **tidak** dibuat dari dashboard. Buat lewat `npm run playbook -- login --server <url>`; daftar dan pencabutan ada di tab Bantuan.

Verifikasi cepat: buat satu grup + project, jalankan satu run di project itu, lalu coba hapus permanen - harus muncul pesan agar diarsipkan.

---

## 12. Verifikasi sistem

| Cek | Perintah / langkah | Harapan |
|---|---|---|
| API hidup | `curl -s localhost:3001/api/health` | `{"ok":true,"database":"sqlite"}` |
| Web hidup | buka `http://127.0.0.1:3100` | redirect ke `/login` |
| Stats | `GET /api/stats?range=7` | `passRate` hanya dari run `pw`; `null` bila tak ada data |
| Auth | login salah 3× | tetap di `/login`, pesan generik |
| Artifact | buka `/artifacts/<runId>/playwright-report/index.html` tanpa sesi | 401 / redirect login |
| Filter | `/reports?project=jaja-id&range=7` | daftar menyempit, filter bertahan saat pindah menu |
| Grup | `GET /api/project-groups` | 3 grup, masing-masing 1 project |
| Arsip | PATCH `/api/projects/p_ebh` `{active:0}` | hilang dari dropdown run, tetap ada di Reports + label `Arsip` |
| Hapus aman | DELETE `/api/projects/p_ebh` | 409, pesan menyuruh arsipkan |

Uji manual lengkap ada di PRD bagian 17.5. `npm run test:integration` (`scripts/verify-dashboard.mjs`) **belum bisa dipakai** sebagai bukti verifikasi; pakai `npm test`, `npm run typecheck --prefix web`, dan `npm run build --prefix web`.

---

## 13. Backup & restore

```bash
# backup: hentikan backend dulu supaya WAL ikut tenang, lalu salin file DB
copy data\playbook.db data\backup-YYYYMMDD.db

# restore
# 1. hentikan backend
# 2. timpa data/playbook.db dengan file backup (+ hapus -wal/-shm lama)
# 3. jalankan backend lagi
```

Sertakan folder `.runs/` dan `.reports/` saat backup penuh; tanpa keduanya histori run tetap ada tapi report mentah hilang.

---

## 14. Rollback rilis

1. Salin `data/playbook.db` sebelum migrasi apa pun.
2. Migrasi gagal → hentikan backend → kembalikan DB dari backup → jalankan kode versi sebelumnya.
3. Semua pengguna harus login ulang (cookie `pb_session` lama menunjuk baris yang sudah hilang).
4. Detail aturan migrasi: PRD bagian 17.4.

---

## 15. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `DATABASE_URL is required` | `.env` tidak terbaca | jalankan dengan `--env-file=.env` |
| `SQLite is an experimental feature` warning | Node 22 | normal; atau pakai Node 24 |
| `Executable doesn't exist at ...chromium` | browser belum diinstall | `npx playwright install chromium` |
| Web 502 `Backend unavailable` | API mati atau port beda | cek terminal 1, cek `API_INTERNAL_URL` |
| Login sukses tapi API 401 | cookie tidak terkirim (`COOKIE_SECURE=true` di HTTP) | set `COOKIE_SECURE=false` untuk lokal |
| Report iframe kosong | artifact belum final / run gagal infra | buka detail run, lihat `error` |
| Build laporan gagal | `.reports/` tidak bisa ditulis, atau run_ids menunjuk run yang hilang | lihat pesan `error` di baris laporan; hasil run tetap utuh |
| Port bentrok | 3001/3100 dipakai proses lain | ubah `PORT` (backend) / `PORT` (web) |
| Test gagal semua di `env=local` | dev server target tidak jalan di mesin yang sama | jalankan dev server dulu, atau pakai `env=staging` |
| `npx` diblokir PowerShell | execution policy | pakai `npx.cmd`, atau `Set-ExecutionPolicy -Scope Process RemoteSigned` |

---

## 16. Sebelum menyerahkan hasil

- [ ] `data/playbook.db` ada, `user_version=5`, 3 grup, 3 project.
- [ ] Project lama punya `group_id` (backfill), tidak ada project tanpa grup.
- [ ] Bisa login, sidebar 4 menu + Logout.
- [ ] Satu run Playwright selesai dan report mentahnya tampil di iframe.
- [ ] Satu run Lighthouse selesai dan skor 4 kategori tampil.
- [ ] Laporan `pw` dan `both` bisa diterbitkan dan dibuka.
- [ ] Filter project + range jalan dan tersimpan di URL.
- [ ] `docs/RENCANA-3-HARI.md` diperbarui dengan status nyata per item.
