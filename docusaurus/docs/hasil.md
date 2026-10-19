---
sidebar_position: 4
title: latest.json
---

scripts/gabung.mjs merge hasil mentah jadi satu file: **latest.json** di root repo.
Itu satu-satunya kontrak buat pembaca (dashboard, bot, script).

## Sumber yang dibaca

| bagian | dari |
|---|---|
| Playwright | pw-out/hasil.json (reporter json) |
| Lighthouse | LHR mentah `lhci-results-<target>/*.report.json` |
| assertion LH | `lhci-results-<target>/assertion-results.json`, fallback `.lighthouseci/assertion-results.json` |

LHR dibaca langsung, **bukan** manifest.json uploader LHCI: manifest-nya nggak bisa
dipercaya (pernah cuma kebaca 1 URL walau report-nya lengkap) dan file run lama suka
ikut keupload. gabung.mjs ambil LHR terbaru per finalUrl, dan buang yang hostnya
nggak cocok sama target.

## Bentuk file

```jsonc
{
  "generatedAt": "2026-10-15T04:00:00.000Z",
  "playwright": {
    "ranAt": "...", "stale": false,
    "targets": [{"site": "Jaja.id", "host": "jaja.id", "akun": true, "total": 4, "passed": 4, "failed": 0}],
    "total": 12, "passed": 12, "failed": 0, "skipped": 0, "ms": 41230,
    "tests": [{"file": "co-jaja.spec.ts", "site": "Jaja.id", "host": "jaja.id",
               "title": "...", "status": "passed", "ms": 8120}]
  },
  "lighthouse": {
    "ranAt": "...",
    "targets": {
      "ebh": {
        "stale": false,
        "target": {"site": "Eureka Book House", "host": "eurekabookhouse.com", "dist": "live (...)"},
        "runs": 2, "errors": 0, "warnings": 1,
        "urls": [{"path": "/", "scores": {"performance": 0.30, "accessibility": 0.77,
                  "best-practices": 0.75, "seo": 1}}]
      }
    }
  }
}
```

Skor Lighthouse disimpan sebagai desimal 0-1, bukan 0-100. Jadi 0.30 = 30.

Status tes Playwright: passed, failed, timedOut, interrupted, skipped.
Yang dihitung failed = tiga yang pertama + timedOut/interrupted.

## Arti stale

- stale: false — sumber ini dijalankan di run terakhir.
- stale: true — datanya dari run lama, sumbernya nggak ikut dijalankan. Contoh:
  node scripts/gabung.mjs --only=pw bikin blok Lighthouse jadi stale, karena cuma
  Playwright yang di-refresh.
- Key target **nggak ada** = target itu belum pernah dijalankan. Bukan error.

## Flag gabung.mjs

```bash
node scripts/gabung.mjs                        # refresh semua yang ada datanya
node scripts/gabung.mjs --only=pw              # Playwright aja, LH dibawa run lama
node scripts/gabung.mjs --only=lh              # Lighthouse aja
node scripts/gabung.mjs --target=ebh           # batasi satu target
node scripts/gabung.mjs --ringkas              # tanpa tabel terminal (dipakai cek.mjs)
```

Tabel terminal di-print sesuai isi --only: blok Playwright disembunyikan kalau cuma
Lighthouse yang jalan, dan sebaliknya. --ringkas dipakai cek.mjs di dalam loop per
target supaya tabelnya nggak dicetak berulang.

latest.json masuk .gitignore — file hasil, bukan sumber.
