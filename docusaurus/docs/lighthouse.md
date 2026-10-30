---
sidebar_position: 3
title: Lighthouse CI
---

Halaman ini buat yang **belum pernah** pakai Lighthouse sama sekali. Dibaca urut dari atas.

---

## 1. Apa itu Lighthouse?

Buka Chrome sekarang, tekan **F12** (DevTools), cari tab **Lighthouse**, tekan **Analyze page load**.

Chrome bakal ngukur halaman yang lagi kebuka, terus ngasih **4 skor**:

1. **Performance** - halaman kebuka secepat apa
2. **Accessibility** - gampang dipakai nggak (pembaca layar, kontras warna, label tombol)
3. **Best Practices** - ngikut standar web modern nggak (HTTPS, gambar aman, API nggak usang)
4. **SEO** - gampang ditemuin mesin pencari nggak

Itu **Lighthouse**.

**Lighthouse CI (lhci)** = Lighthouse yang sama, tapi jalan dari **terminal** - jadi bisa otomatis, bisa diulang, dan hasilnya **file**, bukan tampilan di browser.

Bedanya cuma satu: yang satu lu klik sendiri, yang satu dijalankan script. **Mesin pengukurnya identik.**

---

## 2. Skor: 0-100

Skalanya **0 sampai 100**:

| Skor | Warna | Artinya |
|------|-------|---------|
| 90-100 | Hijau | Bagus |
| 50-89 | Oranye | Perlu diperbaiki |
| 0-49 | Merah | Parah |

Tiap kategori (Performance, Accessibility, Best Practices, SEO) punya skornya sendiri.

---

## 3. Performance dari Mana?

Bukan tebakan. Performance dihitung dari **5 metrik**, masing-masing punya bobot:

| Metrik | Artinya | Bobot |
|--------|---------|-------|
| **FCP** - First Contentful Paint | Kapan konten pertama muncul | 10% |
| **LCP** - Largest Contentful Paint | Kapan elemen terbesar selesai muncul | 25% |
| **TBT** - Total Blocking Time | Berapa lama halaman nggak bisa dibalas klik | 30% |
| **CLS** - Cumulative Layout Shift | Berapa banyak layout lompat-lompat pas loading | 25% |
| **SI** - Speed Index | Seberapa cepat halaman kelihatan jadi | 10% |

**TBT** bobotnya paling gede (30%). Makanya situs yang banyak JavaScript biasanya skor performance-nya jatuh walau halamannya keliatan cepat.

---

## 4. Install Lighthouse CI

### Prasyarat

Repo ini udah nyimpen `@lhci/cli` di `devDependencies`. Kalau belum install:

```bash
npm install
```

Atau install manual:

```bash
npm install -D @lhci/cli
```

Cek udah ada belum:

```bash
npx lhci --version
```

Output: `0.15.0` (atau versi lain).

---

## 5. Jalanin Lighthouse CI (Command Asli)

Command **bawaan LHCI** (bukan wrapper):

```bash
npx lhci autorun --config=lighthouserc.ebh.js
```

**Penjelasan:**

- `npx lhci` - jalanin Lighthouse CI dari package yang ke-install di repo
- `autorun` - mode otomatis: collect (ukur) → assert (cek threshold) → upload (simpan hasil)
- `--config=lighthouserc.ebh.js` - file konfigurasi buat Eureka Book House

**Config lain:**

```bash
npx lhci autorun --config=lighthouserc.jaja.js      # Jaja.id
npx lhci autorun --config=lighthouserc.masdis.js    # Masterdiskon
```

**Output** (contoh):

```text
⚡ Lighthouse CI
Running Lighthouse 3 time(s) on https://eurekabookhouse.com/
Run #1...done.
Run #2...done.
Run #3...done.
Done running Lighthouse!

Healthcheck passed!

Assertions passed!
```

Kalau ada warning:

```text
Assertions passed! (with 2 warnings)
  WARN: categories:performance: Score 0.44 < 0.6
```

---

## 6. Hasil: Output Terminal

Repo ini punya **wrapper** `cek.mjs` yang jalanin LHCI + cetak tabel ringkas:

```bash
npm run cek:lh:ebh      # satu target
npm run cek:lh:jaja
npm run cek:lh:masdis
npm run cek:lh          # ketiganya, satu-satu
```

Output:

```text
=== LIGHTHOUSE ===
ebh: Eureka Book House - live (https://eurekabookhouse.com)
path          perf  a11y  bp    seo
/             30    77    75    100
/auth/login   44    85    96    100
2 url, 0 error, 1 warning
```

Kolom:

- **perf** = Performance
- **a11y** = Accessibility
- **bp** = Best Practices
- **seo** = SEO

Tapi **wrapper itu bukan LHCI** - cuma buat ngerapihin output. Command asli LHCI tetap `npx lhci autorun`.

---

## 7. Hasil: File HTML & JSON

Setelah run, LHCI nyimpen file di folder `lhci-results-<target>/`:

```text
lhci-results-ebh/
  eurekabookhouse_com-<timestamp>.report.html   ← buka di browser
  eurekabookhouse_com-<timestamp>.report.json   ← data mentah
  assertion-results.json                        ← hasil assert
```

**Yang paling berguna buat pemula: file `.report.html`.**

Dobel-klik, kebuka di browser, tampilannya **persis** kayak Lighthouse di DevTools - lengkap sama penjelasan kenapa skornya segini dan cara benerinnya. Nggak perlu baca JSON.

File `.report.json` isinya data yang sama tapi mentah. Itu yang dibaca `scripts/gabung.mjs` buat bikin `latest.json`.

---

## 8. Config File (lighthouserc.*.js)

Satu file per target: `lighthouserc.ebh.js`, `lighthouserc.jaja.js`, `lighthouserc.masdis.js`.

Contoh `lighthouserc.ebh.js`:

```js
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      url: [
        "https://eurekabookhouse.com/",
        "https://eurekabookhouse.com/auth/login",
      ],
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.6 }],
        "categories:accessibility": ["warn", { minScore: 0.6 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./lhci-results-ebh",
    },
  },
};
```

### Bagian `collect`

**Apa yang diukur.**

```js
collect: {
  numberOfRuns: 1,
  url: [
    "https://eurekabookhouse.com/",
    "https://eurekabookhouse.com/auth/login",
  ],
},
```

- **`numberOfRuns: 1`** - tiap URL diukur **sekali**. Kalau `3`, diukur 3x terus diambil median. Lebih akurat, tapi 3x lebih lama. Sekarang 1 dulu, cukup buat lihat tren.
- **`url`** - daftar halaman yang diukur. Sekarang isinya **homepage + login** doang. Kenapa? Homepage = halaman yang paling banyak dikunjungin. Login = halaman yang semua orang lewatin sebelum bisa transaksi. Halaman lain (produk, kategori, cart) bisa ditambah nanti - tinggal tambah baris. Tapi makin banyak URL, makin lama jalannya: tiap URL butuh sekitar **20-40 detik**.

### Bagian `assert`

**Batas nilai**, buat nentuin run-nya lulus apa nggak.

```js
assert: {
  assertions: {
    "categories:performance": ["warn", { minScore: 0.6 }],
    "categories:accessibility": ["warn", { minScore: 0.6 }],
  },
},
```

- **Format:** `['warn', {minScore: 0.6}]` → kalau skornya **di bawah 0.6** (60 dari 100), kasih **peringatan**. Bukan error.
- **Pilihan level:**
  - `'off'` - diam
  - `'warn'` - peringatan, run tetap hijau
  - `'error'` - run jadi merah/gagal
- **Kenapa `warn` bukan `error`?** Situs live skornya naik-turun tiap run. Kalau `error`, run-nya merah cuma gara-gara skor lewat 1 poin, dan lama-lama peringatannya diabaikan orang. Sekarang dua-duanya tetap dicatat (errors dan warnings di `latest.json`), tapi nggak ngeblok.

### Bagian `upload`

**Hasilnya ditaruh di mana.**

```js
upload: {
  target: "filesystem",
  outputDir: "./lhci-results-ebh",
},
```

- **`target: 'filesystem'`** - simpan ke folder lokal, bukan upload ke server LHCI.
- **`outputDir: './lhci-results-ebh'`** - folder per target. **Wajib beda** tiap target, kalau nggak run target A nimpa target B.

---

## 9. Troubleshoot

### Error: `EPERM: operation not permitted, unlink '.lighthouseci/lhr-*.html'`

Masih ada proses yang megang file itu - Chrome atau lhci yang belum mati. **Tutup Chrome dulu**, terus hapus foldernya:

```bash
rm -rf .lighthouseci                          # git-bash
Remove-Item -Recurse -Force .lighthouseci     # PowerShell
```

### Error: `lhci: command not found`

Package belum ke-install:

```bash
npm install -D @lhci/cli
```

`@lhci/cli` sudah ada di `devDependencies` repo ini, jadi cukup `npm install`.

### Skor Tiap Run Beda-Beda

**Normal.** Situs live itu jaringan beneran: iklan, gambar dari server lain, beban server yang berubah. Makanya yang penting **tren-nya**, bukan angka satu run.

---

## 10. Command LHCI Lain

| Command | Fungsi |
|---------|--------|
| `npx lhci collect --url=<URL>` | Ukur satu URL (tanpa config) |
| `npx lhci upload --target=filesystem --outputDir=./hasil` | Upload hasil manual |
| `npx lhci assert --config=<file>` | Cek threshold aja (tanpa collect) |
| `npx lhci open` | Buka hasil terakhir di browser |

Tapi **99% use case cukup `autorun`** - dia jalanin collect + assert + upload sekaligus.

---

## 11. Repo Ini: 3 Situs Eureka Group

| Situs | Config | Command |
|-------|--------|---------|
| Eureka Book House | `lighthouserc.ebh.js` | `npx lhci autorun --config=lighthouserc.ebh.js` |
| Jaja.id | `lighthouserc.jaja.js` | `npx lhci autorun --config=lighthouserc.jaja.js` |
| Masterdiskon | `lighthouserc.masdis.js` | `npx lhci autorun --config=lighthouserc.masdis.js` |

Atau lewat wrapper:

```bash
npm run cek:lh          # ketiganya
npm run cek:lh:ebh      # satu aja
```

---

## 12. Next Steps

1. **Baca `.report.html`** - dobel-klik file hasil, liat penjelasan kenapa skornya segini
2. **Tambahin URL** - edit `lighthouserc.*.js`, tambahin halaman produk/kategori
3. **Naikin threshold** - kalau skornya udah stabil di atas 70, ganti `minScore: 0.7`
4. **Pelajarin metrik** - baca [Web Vitals](https://web.dev/vitals/) buat LCP, TBT, CLS

Kalau udah nyaman, gabungin sama **Playwright** buat tes end-to-end + audit performa sekaligus.