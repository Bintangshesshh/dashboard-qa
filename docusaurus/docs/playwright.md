---
sidebar_position: 2
title: Playwright
---

Halaman ini buat yang **belum pernah** bikin tes otomatis sama sekali. Dibaca urut dari atas.

---

## 1. Apa itu Playwright?

Playwright = tools buat **tes website secara otomatis**.

Coba bayangin: lu login ke jaja.id manual sekarang - buka browser, isi email, isi password, klik tombol, liat hasilnya. Sekarang ulangi itu **50x setiap hari**. Capek kan?

Playwright nggak capek. Dia:

1. **Buka browser beneran** (Chromium/Firefox/WebKit - mesin asli kayak Chrome)
2. **Klik-klik sendiri** - buka halaman, isi form, tekan tombol
3. **Cek hasilnya** - "setelah klik login, dasbornya kebuka nggak?"
4. **Cetak laporan** - hijau = lulus, merah = gagal + screenshot + video

Yang sama dengan tes manual: dia buka browser asli ke situs asli. Bedanya: konsisten, bisa diulang 50x, kelar dalam hitungan detik, nggak lupa langkah.

---

## 2. Install Playwright

### Prasyarat

Cek dulu Node.js udah ada belum:

```bash
node -v
```

Contoh output: `v22.23.2`

Kalau belum ada atau versinya di bawah v18, download dulu di [nodejs.org](https://nodejs.org/).

### Install

Jalanin command ini di folder project lu (misalnya `D:\Desktop\playwright`):

```bash
npm init playwright@latest
```

Output yang muncul:

```text
Need to install the following packages:
create-playwright@1.17.139
Ok to proceed? (y)
```

Ketik **y**, terus:

```text
Getting started with writing end-to-end tests with Playwright:
Initializing project in '.'
 ✔ Do you want to use TypeScript or JavaScript? · TypeScript
 ✔ Where to put your end-to-end tests? · eureka
 ✔ Add a GitHub Actions workflow? (Y/n) · false
 ✔ Install Playwright browsers? (Y/n) · true
```

- **TypeScript** (lebih ketat, cocok buat project gede)
- **Folder tes**: `eureka` (isi spec tes nanti taro di sini)
- **GitHub Actions**: nggak usah (n / false)
- **Install browser**: iya (Y / true)

### Troubleshoot: Error `EALLOWSCRIPTS`

Kalau muncul error kayak gini:

```text
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

**Fix:**

```bash
npm install --save-dev @playwright/test
npx playwright install
```

Command pertama install package-nya, command kedua download browser (Chromium, Firefox, WebKit, FFmpeg).

Output install browser:

```text
Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243)...
195.6 MiB [====================] 100%
Chrome for Testing downloaded to
C:\Users\Lenovo\AppData\Local\ms-playwright\chromium-1243
```

Kalau FFmpeg timeout, Playwright otomatis pindah ke mirror Microsoft - biarkan aja jalan.

---

## 3. Setup Config

Buat file `playwright.config.ts` di root folder (sejajar `package.json`):

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./eureka",
  fullyParallel: true,
  reporter: "html",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

**Penjelasan:**

- `testDir: "./eureka"` - folder tempat spec tes (file `.spec.ts`)
- `fullyParallel: true` - jalanin tes paralel (lebih cepat)
- `reporter: "html"` - laporan HTML setelah tes jalan
- `trace: "on-first-retry"` - rekam trace (video + screenshot) kalau tes gagal
- `projects` - browser yang dipake. Di sini cuma Chromium dulu.

---

## 4. Tes Pertama (Hello World)

Buat folder `eureka/` (kalau belum ada), terus bikin file `eureka/example.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("cek koneksi", async ({ page }) => {
  await page.goto("https://www.google.com");
  await expect(page).toHaveTitle(/Google/);
});
```

**Jalanin:**

```bash
npx playwright test
```

Output:

```text
Running 1 test using 1 worker
 ✓ [chromium] › eureka/example.spec.ts:3:5 › cek koneksi (1.7s)

 1 passed (1.7s)
```

Kalau hijau ✓ - **lu resmi bisa Playwright.**

---

## 5. Bikin Tes Login (Pake Codegen)

Sekarang bikin tes login ke Eureka Book House.

### 5.1. Rekam dengan Codegen

Playwright punya tools **codegen** buat **rekam aktivitas** lu di browser, terus dia bikinin kode otomatis.

Command:

```bash
npx playwright codegen https://eurekabookhouse.com/auth/login
```

Nanti muncul 2 window:

1. **Browser** (kiri) - situ login manual di sini
2. **Inspector** (kanan) - kode otomatis muncul di sini

Lakukan:

1. Isi email
2. Isi password
3. Klik "Masuk Sekarang"
4. Klik "OK" (kalau ada popup)

Inspector bakal nampilin kode kayak gini:

```ts
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://eurekabookhouse.com/auth/login');
  await page.getByRole('textbox', { name: 'namaanda@email.com' }).click();
  await page.getByRole('textbox', { name: 'namaanda@email.com' }).fill('yessir120@gmail.com');
  await page.getByRole('textbox', { name: '.........' }).click();
  await page.getByRole('textbox', { name: '.........' }).fill('Password');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
});
```

### 5.2. Rapikan Kode

Codegen suka ngasih `.click()` sebelum `.fill()` - nggak perlu. Hapus yang `.click()` buat form:

```ts
import { test, expect } from "@playwright/test";

test("login berhasil", async ({ page }) => {
  await page.goto("https://eurekabookhouse.com/auth/login");
  await page.getByRole("textbox", { name: "namaanda@email.com" }).fill("yessir120@gmail.com");
  await page.getByRole("textbox", { name: "..........." }).fill("Password");
  await page.getByRole("button", { name: "Masuk Sekarang" }).click();
  await page.getByRole("button", { name: "OK" }).click();
});
```

### 5.3. Tambahin Assertions

**Assertions** = pernyataan yang **harus bener**. Kalau nggak bener, tes gagal.

Contoh: "setelah login, URL-nya **bukan** `/login` lagi (pindah ke dashboard)".

```ts
await expect(page).not.toHaveURL(/login/);
```

**Full code** - simpan sebagai `eureka/login-eurekabookhouse.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("login berhasil", async ({ page }) => {
  await page.goto("https://eurekabookhouse.com/auth/login");
  await page.getByRole("textbox", { name: "namaanda@email.com" }).fill("yessir120@gmail.com");
  await page.getByRole("textbox", { name: "..........." }).fill("Password");
  await page.getByRole("button", { name: "Masuk Sekarang" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  
  // Cek: setelah login, bukan di halaman login lagi
  await expect(page).not.toHaveURL(/login/);
});
```

**Jalanin:**

```bash
npx playwright test login-eurekabookhouse.spec.ts --headed
```

Flag `--headed` = browser keliatan di layar (bagus buat nge-debug).

Output:

```text
Running 1 test using 1 worker
 ✓ login-eurekabookhouse.spec.ts:3:5 › login berhasil (5.5s)

 1 passed (6.7s)
```

---

## 6. Command Bawaan Playwright

Semua command di sini **bawaan Playwright resmi** - bukan bikinan repo ini.

| Command | Fungsi |
|---------|--------|
| `npx playwright test` | Jalanin semua tes |
| `npx playwright test eureka/co-ebh.spec.ts` | Jalanin satu spec |
| `npx playwright test --headed` | Browser keliatan di layar |
| `npx playwright test -g "TC-E01"` | Saring tes berdasarkan nama |
| `npx playwright test --list` | Daftar tes (tanpa jalan) |
| `npx playwright show-report` | Buka laporan HTML |
| `npx playwright codegen <URL>` | Rekam aktivitas, bikinin kode |

**Paling ngebantu pemula:**

- `--headed` - liat browser jalan pas debug
- `show-report` - buka laporan HTML (ada screenshot + video + trace tiap tes gagal)

---

## 7. Laporan & Artefak

Setelah tes jalan, Playwright nyimpen:

| Path | Isi |
|------|-----|
| `playwright-report/` | Laporan HTML |
| `test-results/` | Screenshot, video, trace dari tes gagal |

Buka laporan:

```bash
npx playwright show-report
```

Klik tes yang merah → keliatan:

- **Screenshot** - halaman pas gagal
- **Video** - rekaman browser dari awal sampai gagal
- **Trace** - timeline lengkap: klik apa, isi form apa, DOM-nya gimana

---

## 8. Repo Ini: Eureka Group QA

Repo ini nyimpen tes buat **3 situs Eureka Group**:

| Situs | Spec | Tes Login |
|-------|------|-----------|
| Eureka Book House | `eureka/co-ebh.spec.ts` | TC-E01 |
| Jaja.id | `eureka/co-jaja.spec.ts` | TC-J01 |
| Masterdiskon | `eureka/co-masdis.spec.ts` | TC-M02 |

**Jalanin semua:**

```bash
npx playwright test
```

**Jalanin satu situs:**

```bash
npx playwright test eureka/co-ebh.spec.ts
```

---

## 9. Akun & Kredensial

Tes login butuh email & password. **Jangan hardcode di spec** - simpan di `.env`.

Contoh `.env`:

```bash
EBH_EMAIL=yessir120@gmail.com
EBH_PASSWORD=Password
```

File `.env` **jangan di-commit** - taro di `.gitignore`.

---

## 10. Next Steps

1. **Baca spec asli** - `eureka/co-ebh.spec.ts`, liat gimana tes checkout (login → search → cart → checkout → bayar → cancel)
2. **Bikin spec sendiri** - coba rekam dengan `codegen`, rapikan, tambahin assertions
3. **Pelajarin selector** - `.getByRole()`, `.getByText()`, `.locator()` - baca [docs Playwright](https://playwright.dev/docs/locators)
4. **Pelajarin assertions** - `toBeVisible()`, `toHaveText()`, `toHaveURL()` - baca [docs expect](https://playwright.dev/docs/test-assertions)

Kalau udah nyaman, baca **Lighthouse CI** buat audit performa & aksesibilitas.
