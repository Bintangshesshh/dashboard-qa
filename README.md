# Playbook - QA Dashboard

Dashboard QA internal: sesi run Playwright + Lighthouse CI, hasil per test case, log live, dan laporan sesi yang bisa diterbitkan.

Kontrak produk ada di `docs/PRD.md`, cara install di `docs/SETUP.md` (keduanya internal, tidak di-commit).

## Batas keamanan

**Penulis test bisa menjalankan kode Node apa pun di runner. Ini bukan sandbox.** Jalankan di VM/container terisolasi, tanpa kredensial perusahaan di luar akun test, tanpa Docker socket, tanpa akses DB produksi. `TARGET_ALLOWLIST` hanya membatasi origin target yang dikonfigurasi; ia tidak bisa membatasi kode yang dikirim. Log, trace, screenshot, dan report HTML bisa memuat data sensitif.

## Peta proyek

- `server/index.mjs` - REST API + WebSocket log + penyajian artifact/laporan
- `server/store.mjs` - skema SQLite v5 + migrasi + query
- `server/runner.mjs` - eksekusi Playwright/Lighthouse, cancel, timeout, parsing hasil
- `server/validation.mjs` - validasi request + allowlist target
- `server/migrations/` - `0001_schema_v5.sql` s.d. `0004_reports_mode.sql`
- `web/app/(dashboard)/` - Overview, Playwright, Lighthouse, Reports; `run-terminal.tsx` panel log live, `settings/` admin
- `web/app/(auth)/login/` - login
- `web/lib/playbook.ts` - klien API bertipe
- `scripts/build-session-report.mjs` - adapter DB → HTML laporan di `.reports/<reportId>/`
- `scripts/build-report-docs.mjs`, `report-html.mjs`, `report-md.mjs` - render folder report + markdown evaluasi
- `scripts/migrate.mjs`, `seed-projects.mjs`, `import-test-files.mjs`, `seed-user.mjs` - setup
- `scripts/backup.mjs`, `retention.mjs` - backup DB + retensi
- `lighthouserc.*.js` - seed konfigurasi Lighthouse per target (`import-test-files.mjs`)
- `eureka/` - spec Playwright per target

## Jalankan

```powershell
npm install
npm install --prefix web
npx playwright install chromium
copy .env.example .env      # isi DATABASE_URL, TARGET_ALLOWLIST
node --experimental-sqlite scripts/migrate.mjs
node --experimental-sqlite scripts/seed-projects.mjs
node --experimental-sqlite scripts/import-test-files.mjs
node scripts/seed-user.mjs --username admin --role admin

npm run dev:server          # terminal 1 → http://127.0.0.1:3001
npm run dev:web             # terminal 2 → http://127.0.0.1:3000
```

Perintah lain:

```powershell
npm test                    # unit test backend
npm run test:integration    # verifikasi end-to-end dashboard
npm run backup              # backup DB ke data/backups/
npm run retention           # jalankan retensi data
npm run fixture             # server target lokal untuk uji
```

Detail lengkap, verifikasi tiap langkah, dan troubleshooting: `docs/SETUP.md`.
