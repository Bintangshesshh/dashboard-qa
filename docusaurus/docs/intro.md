---
sidebar_position: 1
slug: /intro
title: Pengantar
---

Dua alat, dua pertanyaan beda, satu tempat. Semuanya jalan dari terminal.

| alat | jawab pertanyaan | caranya |
|---|---|---|
| Playwright | "fiturnya jalan nggak?" | buka browser beneran, klik, isi form, cek hasilnya |
| Lighthouse CI | "halamannya bagus nggak?" | audit halaman, kasih skor 0-100 |

Playwright itu tester yang nyoba fitur satu-satu. Lighthouse itu inspektur yang nilai
kualitas halaman. Dua-duanya nggak saling gantiin.

## Yang dicek sekarang

Tiga situs, dan cuma **homepage + halaman login** tiap situs:

| situs | homepage | login |
|---|---|---|
| Eureka Book House | `https://eurekabookhouse.com/` | `https://eurekabookhouse.com/auth/login` |
| Jaja.id | `https://jaja.id/` | `https://jaja.id/main/auth/login` |
| Masterdiskon | `https://masterdiskon.com/` | `https://masterdiskon.com/id-id/login` |

Belum ada halaman lain. Cara nambah: lihat [Lighthouse CI](./lighthouse.md).

## Alurnya

```
npm run cek:lh:ebh
        |
        v
  lhci autorun --config=lighthouserc.ebh.js
        |
        v
  lhci-results-ebh/*.report.json     <- hasil mentah
        |
        v
  node scripts/gabung.mjs            <- digabung
        |
        v
  latest.json                        <- satu file hasil, di root repo
```

Playwright jalurnya sama, cuma beda alat: `pw-out/hasil.json` -> `latest.json`.

## Mulai dari mana

1. [Playwright](./playwright.md) — apa itu, cara jalanin, cara baca laporannya.
2. [Lighthouse CI](./lighthouse.md) — ini yang bikin bingung. Mulai dari nol:
   apa yang diukur, arti angkanya, cara jalanin, cara baca.
3. [latest.json](./hasil.md) — bentuk file hasil gabungan.
