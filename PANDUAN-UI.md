# Panduan UI QA Dashboard (statis, tanpa backend)

UI ini meniru tata letak produk [QA Dashboard Redsauce](https://www.redsauce.net/en/qa-dashboard):
sidebar, kartu KPI, success rate donut, grafik riwayat eksekusi, tabel run, daftar kegagalan, dan grid proyek.
Semua angka adalah data mock di dalam `ui/app.js` — belum tersambung ke `server/`.

Sengaja **tanpa npm script / shortcut**. Jalankan perintah manual, urut, satu per satu.

---

## Langkah 0 — Cek lokasi kerja

Buka terminal, lalu:

```powershell
cd D:\Desktop\dashboard
```

Pastikan tiga file ini ada:

```powershell
dir ui
```

Harus muncul `index.html`, `styles.css`, `app.js`. Kalau tidak, UI belum dibuat.

---

## Langkah 1 — Cek prasyarat

Cukup salah satu server statis berikut.

```powershell
node -v
```

```powershell
python --version
```

- `node -v` keluar angka (mis. `v22.x`) → pakai **Cara A**.
- `python --version` keluar angka (mis. `Python 3.12.x`) → pakai **Cara B**.
- Keduanya ada → pilih salah satu, jangan dua-duanya di port yang sama.

---

## Langkah 2 — Jalankan server statis (pilih satu cara)

### Cara A — Node one-liner (paling ringan, tanpa instal apa pun)

Dari `D:\Desktop\dashboard`, jalankan:

```powershell
node -e "const http=require('http'),fs=require('fs'),p=require('path');http.createServer((q,s)=>{const f=p.join(process.cwd(),'ui',q.url==='/'?'index.html':q.url.split('?')[0]);fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end('not found')}s.writeHead(200,{'content-type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html'});s.end(d)})}).listen(5173,'127.0.0.1',()=>console.log('UI siap di http://127.0.0.1:5173'))"
```

Terminal harus menahan proses dan menampilkan `UI siap di http://127.0.0.1:5173`.
Biarkan terminal itu tetap terbuka.

### Cara B — Python http.server

Dari `D:\Desktop\dashboard`, jalankan:

```powershell
python -m http.server 5173 --directory ui
```

Biarkan terminal tetap terbuka (`Serving HTTP on :: port 5173 ...`).

### Cara C — paket `serve` (butuh unduh sekali)

```powershell
npx --yes serve ui -l 5173
```

Jangan pakai cara ini kalau internet lambat; Cara A sudah cukup.

---

## Langkah 3 — Buka di browser

Ketik manual di address bar:

```
http://127.0.0.1:5173
```

Jangan buka `ui/index.html` lewat double-click (`file://`). Halaman akan tampil tapi lebih rapuh untuk uji lanjutan.

---

## Langkah 4 — Cek UI benar-benar hidup

Di halaman:

1. Kartu **Success rate** menampilkan persen, bukan `0%`.
2. Kartu **Total runs** menampilkan angka (mis. `64`).
3. Grafik **Execution history** punya 14 batang.
4. Tabel **Recent runs** berisi 6 baris.

Lalu tekan `F12` → tab **Console**. Harus kosong dari error merah.

Uji interaksi, urut:

1. Klik sidebar **Runs** → judul atas berubah jadi `Runs`, tabel 64 baris.
2. Klik chip **Failed** → hanya baris gagal tersisa.
3. Klik salah satu baris → panel detail muncul di kanan.
4. Tekan `Esc` → panel tertutup.
5. Ganti dropdown **Project** ke `jaja` → semua angka ikut menyusut.
6. Klik **Projects** → 3 kartu proyek (`jaja`, `masdis`, `ebh`).

Kalau semua cocok, UI sudah jalan.

---

## Langkah 5 — Matikan server

Kembali ke terminal server, tekan:

```
Ctrl + C
```

---

## Langkah 6 — Mengubah isi UI

Semua di folder `ui/`, tanpa build.

| Mau ubah | Buka file | Cari |
|---|---|---|
| Nama proyek | `ui/app.js` | `const PROJECTS = [...]` |
| Nama suite per proyek | `ui/app.js` | `const SUITES = {...}` |
| Teks contoh kegagalan | `ui/app.js` | `const FAILURES = [...]` |
| Jumlah data run | `ui/app.js` | `Array.from({ length: 64 }` |
| Palet brand eureka! Group | `ui/styles.css` | `--brand:#003399` · `--brand-dark:#002a80` · `--brand-soft:#e8efff` · `--accent:#e30613` · `--ink:#1a1a1a` |
| Palet mode gelap | `ui/styles.css` | `html[data-theme="dark"]{` — `--brand:#2f6ae0` · `--link:#8ab4ff` · `--bg:#0e1116` · `--surface:#151a21` · `--text-2:#ccd4de` |
| Warna status sukses (hijau) | `ui/styles.css` | `--ok:#15803d` · `--ok-bg:#e8f6ee` · `--ok-ink:#0f6b36` (gelap: `#3ddc84` / `#132a1c` / `#7ee2a8`) |
| Warna status gagal | `ui/styles.css` | `--bad:#e30613` |
| Balik ke oranye | `ui/styles.css` | `--brand:#f26a1b` / `--brand-dark:#b9550c` / `--brand-soft:#fff1e5` |
| Balik ke biru terang | `ui/styles.css` | `--brand:#2563eb` / `--brand-dark:#1a4fbf` / `--brand-soft:#e8f0fe` |
| Warna status gagal (tetap merah) | `ui/styles.css` | `--bad:#d51f2b` |
| Label navigasi | `ui/index.html` | `<nav aria-label="Main navigation"` |

Setelah edit: simpan file, lalu refresh browser dengan `Ctrl + F5` (paksa ambil CSS/JS terbaru).

Catatan: `app.js` memakai generator acak ber-seed (`seed = 20261020`), jadi angka mock tetap sama tiap refresh. Ganti angka seed kalau ingin variasi lain.

---

## Langkah 7 — Mode gelap

Tombol bulan/matahari ada di topbar, persis di kiri tombol **New run**.

1. Klik `☾` → tema gelap, ikon jadi `☀`.
2. Refresh `Ctrl + F5` → tema gelap tetap terpakai.
3. Klik `☀` → balik terang.

Cara kerjanya:

- Tema disimpan di `localStorage` dengan kunci `qa-theme` (nilai `dark` / `light`).
- Kalau belum pernah memilih, UI mengikuti tema OS (`prefers-color-scheme`).
- Semua warna ada di `ui/styles.css`: blok `html[data-theme="dark"]` menimpa variabel `:root`.

Paksa gelap tanpa klik (contoh untuk cek manual di DevTools → Console):

```js
document.documentElement.dataset.theme = 'dark'
```

Kembalikan:

```js
document.documentElement.dataset.theme = 'light'
localStorage.removeItem('qa-theme')
```

Kalau tampilan gelap terasa ada bagian yang masih putih, cari warna hardcoded di `ui/styles.css` (mis. `#fff`, `#f3f4f6`) lalu ganti ke variabel seperti `var(--surface)`, `var(--hover)`, `var(--line)`.

### Cek kontras teks otomatis

Dengan server masih jalan, buka terminal kedua:

```powershell
cd D:\Desktop\dashboard
node ui/cek-kontras.cjs http://127.0.0.1:5173
```

Skrip membuka halaman, cek semua teks di mode terang lalu mode gelap (semua view + panel detail), dan hanya melaporkan teks di bawah ambang WCAG (4.5:1, atau 3:1 untuk teks besar).

- `"offenders": 0` dan exit code `0` → aman.
- Ada daftar `sel`/`ratio` → naikkan warna di `ui/styles.css` sampai daftar kosong.

Butuh `playwright` yang sudah ada di root repo. Ganti URL kalau port server berbeda.

---

## Langkah 8 — Troubleshooting

**Port 5173 sudah dipakai**
Ganti angka `5173` di perintah server menjadi `5174`, lalu buka `http://127.0.0.1:5174`.
Cek pemakai port:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
```

**Halaman putih / tampilan tanpa gaya**
Berarti `styles.css` atau `app.js` gagal dimuat. Buka `F12` → tab **Network**, refresh, lihat file mana yang statusnya 404. Pastikan perintah server dijalankan dari `D:\Desktop\dashboard` dan menunjuk folder `ui`.

**Angka tetap lama setelah edit**
`Ctrl + F5`. Kalau masih, tutup tab lalu buka lagi.

**Ingin ubah jadi aplikasi Next.js yang sudah ada**
Itu pekerjaan terpisah dari UI statis ini: port bertahap ke `web/app/page.tsx`. Belum dikerjakan di sini.

---

## Struktur akhir

```
D:\Desktop\dashboard\
└─ ui\
   ├─ index.html   struktur halaman + semua section
   ├─ styles.css   tema terang/gelap, grid, kartu, tabel, drawer, responsif
   └─ app.js       data mock, hitung KPI, render grafik/tabel, navigasi, drawer, toggle tema

ui\cek-kontras.cjs   skrip cek kontras teks (dijalankan manual, opsional)
```

Tidak ada `package.json`, tidak ada `npm install`, tidak ada script di root yang ditambahkan.
