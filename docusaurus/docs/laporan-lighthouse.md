> Dihasilkan otomatis dari latest.json. Jangan edit manual — jalankan `npm run lapor`.

# Log Lighthouse

Digenerate 2026-10-19 03:35 UTC. Skor 0–100; angka kecil = buruk.

## ebh — Eureka Book House

live (https://eurekabookhouse.com)

0 error, 1 warning, 2 URL diukur.

### `/`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 36 | 77 | 75 | 100 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 3.4 s | 38 | 10% |
| LCP | 11.0 s | 0 | 25% |
| TBT | 750 ms | 39 | 30% |
| CLS | 0.123 | 83 | 25% |
| SI | 13.6 s | 2 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `largest-contentful-paint` | performance | 11.0 s | 25.00 |
| 2 | `total-blocking-time` | performance | 750 ms | 18.30 |
| 3 | `button-name` | accessibility | Buttons do not have an accessible name | 10.00 |
| 4 | `speed-index` | performance | 13.6 s | 9.80 |
| 5 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 6 | `link-name` | accessibility | Links do not have a discernible name | 7.00 |
| 7 | `list` | accessibility | Lists do not contain only `<li>` elements and script supporting elements (`<script>` and `<template>`). | 7.00 |
| 8 | `target-size` | accessibility | Touch targets do not have sufficient size or spacing. | 7.00 |
| 9 | `first-contentful-paint` | performance | 3.4 s | 6.20 |
| 10 | `third-party-cookies` | best-practices | 1 cookie found | 5.00 |
| 11 | `cumulative-layout-shift` | performance | 0.123 | 4.25 |
| 12 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |

#### `button-name` — Buttons do not have an accessible name

When a button doesn't have an accessible name, screen readers announce it as "button", making it unusable for users who rely on screen readers. [Learn how to make buttons more accessible](https://dequeuniversity.com/rules/axe/4.10/button-name).

| Failing Elements |
|---|
| `nav.fixed > div.flex > div.flex > button.p-1.5` |
| `nav.fixed > div.flex > div.flex > button.relative` |
| `nav.fixed > div.flex > div.flex > button.p-1.5` |

#### `color-contrast` — Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).

| Failing Elements |
|---|
| `a.group > div.p-3 > div.mt-1 > p.text-gray-400` |
| `a.group > div.p-3 > div.mt-1 > p.text-gray-400` |

[Laporan mentah](/laporan/eurekabookhouse_com--2026_10_19_03_10_38.report.json)

### `/auth/login`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 63 | 85 | 96 | 100 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 2.1 s | 83 | 10% |
| LCP | 4.1 s | 46 | 25% |
| TBT | 920 ms | 31 | 30% |
| CLS | 0.059 | 98 | 25% |
| SI | 3.2 s | 92 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `total-blocking-time` | performance | 920 ms | 20.70 |
| 2 | `largest-contentful-paint` | performance | 4.1 s | 13.50 |
| 3 | `button-name` | accessibility | Buttons do not have an accessible name | 10.00 |
| 4 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 5 | `target-size` | accessibility | Touch targets do not have sufficient size or spacing. | 7.00 |
| 6 | `first-contentful-paint` | performance | 2.1 s | 1.70 |
| 7 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |
| 8 | `max-potential-fid` | performance | 320 ms | 0.00 |
| 9 | `interactive` | performance | 10.2 s | 0.00 |
| 10 | `mainthread-work-breakdown` | performance | 4.1 s | 0.00 |
| 11 | `bootup-time` | performance | 2.5 s | 0.00 |
| 12 | `third-party-summary` | performance | Third-party code blocked the main thread for 480 ms | 0.00 |

#### `button-name` — Buttons do not have an accessible name

When a button doesn't have an accessible name, screen readers announce it as "button", making it unusable for users who rely on screen readers. [Learn how to make buttons more accessible](https://dequeuniversity.com/rules/axe/4.10/button-name).

| Failing Elements |
|---|
| `form.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > button.jsx-8a28abbff1cdd693` |

#### `color-contrast` — Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).

| Failing Elements |
|---|
| `form.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > button.jsx-8a28abbff1cdd693` |
| `div.bg-white > form.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > span.jsx-8a28abbff1cdd693` |
| `form.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > p.jsx-8a28abbff1cdd693 > button.jsx-8a28abbff1cdd693` |

#### `target-size` — Touch targets do not have sufficient size or spacing.

Touch targets with sufficient size and spacing help users who may have difficulty targeting small controls to activate the targets. [Learn more about touch targets](https://dequeuniversity.com/rules/axe/4.10/target-size).

| Failing Elements |
|---|
| `form.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > div.jsx-8a28abbff1cdd693 > button.jsx-8a28abbff1cdd693` |

[Laporan mentah](/laporan/eurekabookhouse_com-auth_login-2026_10_19_03_11_42.report.json)

### Assertion

| Level | Audit | URL | Harapan | Kenyataan | Operator |
|---|---|---|---|---|---|
| warn | `categories` | `/` | 0.6 | 0.49 | >= |


## jaja — Jaja.id

live (https://jaja.id)

0 error, 1 warning, 2 URL diukur.

### `/`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 9 | 86 | 93 | 92 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 2.0 s | 85 | 10% |
| LCP | 53.6 s | 0 | 25% |
| TBT | 19,300 ms | 0 | 30% |
| CLS | 1.019 | 2 | 25% |
| SI | 16.9 s | 0 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `total-blocking-time` | performance | 19,300 ms | 30.00 |
| 2 | `largest-contentful-paint` | performance | 53.6 s | 25.00 |
| 3 | `cumulative-layout-shift` | performance | 1.019 | 24.50 |
| 4 | `speed-index` | performance | 16.9 s | 10.00 |
| 5 | `button-name` | accessibility | Buttons do not have an accessible name | 10.00 |
| 6 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 7 | `link-name` | accessibility | Links do not have a discernible name | 7.00 |
| 8 | `first-contentful-paint` | performance | 2.0 s | 1.50 |
| 9 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |
| 10 | `image-redundant-alt` | accessibility | Image elements have `[alt]` attributes that are redundant text. | 1.00 |
| 11 | `font-size` | best-practices | 8% legible text | 1.00 |
| 12 | `robots-txt` | seo | robots.txt is not valid | 1.00 |

#### `button-name` — Buttons do not have an accessible name

When a button doesn't have an accessible name, screen readers announce it as "button", making it unusable for users who rely on screen readers. [Learn how to make buttons more accessible](https://dequeuniversity.com/rules/axe/4.10/button-name).

| Failing Elements |
|---|
| `div.w-full > div.flex > div.flex > button.lg:hidden` |
| `div.w-full > div.lg:hidden > form.relative > button.absolute` |

[Laporan mentah](/laporan/jaja_id--2026_10_19_01_26_42.report.json)

### `/main/auth/login`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 61 | 86 | 96 | 100 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 1.7 s | 91 | 10% |
| LCP | 3.9 s | 52 | 25% |
| TBT | 1,480 ms | 14 | 30% |
| CLS | 0.004 | 100 | 25% |
| SI | 1.9 s | 100 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `total-blocking-time` | performance | 1,480 ms | 25.80 |
| 2 | `largest-contentful-paint` | performance | 3.9 s | 12.00 |
| 3 | `button-name` | accessibility | Buttons do not have an accessible name | 10.00 |
| 4 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 5 | `target-size` | accessibility | Touch targets do not have sufficient size or spacing. | 7.00 |
| 6 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |
| 7 | `max-potential-fid` | performance | 450 ms | 0.00 |
| 8 | `interactive` | performance | 12.5 s | 0.00 |
| 9 | `mainthread-work-breakdown` | performance | 4.0 s | 0.00 |
| 10 | `bootup-time` | performance | 2.9 s | 0.00 |
| 11 | `uses-rel-preconnect` | performance | Est savings of 310 ms | 0.00 |
| 12 | `third-party-summary` | performance | Third-party code blocked the main thread for 890 ms | 0.00 |

#### `button-name` — Buttons do not have an accessible name

When a button doesn't have an accessible name, screen readers announce it as "button", making it unusable for users who rely on screen readers. [Learn how to make buttons more accessible](https://dequeuniversity.com/rules/axe/4.10/button-name).

| Failing Elements |
|---|
| `form.space-y-4 > div > div.relative > button.absolute` |
| `form.space-y-2.5 > div > div.relative > button.absolute` |

#### `color-contrast` — Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).

| Failing Elements |
|---|
| `div.w-full > form.space-y-4 > div.flex > a.text-xs` |
| `div.relative > div.w-full > form.space-y-4 > button.w-full` |
| `div.relative > div.w-full > p.text-center > button.text-[#FBB338]` |

#### `target-size` — Touch targets do not have sufficient size or spacing.

Touch targets with sufficient size and spacing help users who may have difficulty targeting small controls to activate the targets. [Learn more about touch targets](https://dequeuniversity.com/rules/axe/4.10/target-size).

| Failing Elements |
|---|
| `form.space-y-4 > div > div.relative > button.absolute` |

[Laporan mentah](/laporan/jaja_id-main_auth_login-2026_10_19_01_29_35.report.json)

### Assertion

| Level | Audit | URL | Harapan | Kenyataan | Operator |
|---|---|---|---|---|---|
| warn | `categories` | `/` | 0.6 | 0.11 | >= |


## masdis — Masterdiskon

live (https://masterdiskon.com)

0 error, 2 warning, 2 URL diukur.

### `/id-id`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 55 | 78 | 93 | 92 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 1.6 s | 93 | 10% |
| LCP | 14.7 s | 0 | 25% |
| TBT | 400 ms | 68 | 30% |
| CLS | 0.008 | 100 | 25% |
| SI | 11.1 s | 6 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `largest-contentful-paint` | performance | 14.7 s | 25.00 |
| 2 | `total-blocking-time` | performance | 400 ms | 9.60 |
| 3 | `speed-index` | performance | 11.1 s | 9.40 |
| 4 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 5 | `link-name` | accessibility | Links do not have a discernible name | 7.00 |
| 6 | `target-size` | accessibility | Touch targets do not have sufficient size or spacing. | 7.00 |
| 7 | `heading-order` | accessibility | Heading elements are not in a sequentially-descending order | 3.00 |
| 8 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |
| 9 | `image-alt` | seo | Image elements do not have `[alt]` attributes | 1.00 |
| 10 | `image-redundant-alt` | accessibility | Image elements have `[alt]` attributes that are redundant text. | 1.00 |
| 11 | `geolocation-on-start` | best-practices | Requests the geolocation permission on page load | 1.00 |
| 12 | `max-potential-fid` | performance | 210 ms | 0.00 |

#### `color-contrast` — Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).

| Failing Elements |
|---|
| `div.HomePageDummy__HeroTopBar-sc-a875b2ab-6 > a > div.HomePageDummy__NavbarActionPill-sc-a875b2ab-8 > span` |
| `div.HomePageDummy__MobileHomepageShell-sc-a875b2ab-1 > section.HomePageDummy__HeroSection-sc-a875b2ab-2 > div.HomePageDummy__HeroCopy-sc-a875b2ab-7 > h1` |
| `div.HomePageDummy__MobileHomepageShell-sc-a875b2ab-1 > section.HomePageDummy__HeroSection-sc-a875b2ab-2 > div.HomePageDummy__HeroCopy-sc-a875b2ab-7 > p` |

#### `link-name` — Links do not have a discernible name

Link text (and alternate text for images, when used as links) that is discernible, unique, and focusable improves the navigation experience for screen reader users. [Learn how to make links accessible](https://dequeuniversity.com/rules/axe/4.10/link-name).

| Failing Elements |
|---|
| `div.HomePageDummy__MobileHomepageShell-sc-a875b2ab-1 > section.HomePageDummy__HeroSection-sc-a875b2ab-2 > div.HomePageDummy__HeroTopBar-sc-a875b2ab-6 > a.navbar-brand` |

[Laporan mentah](/laporan/masterdiskon_com--2026_10_16_08_48_01.report.json)

### `/id-id/login`

| Perf | A11y | BP | SEO |
|---|---|---|---|
| 58 | 92 | 75 | 92 |

**Metrik performa**

| Metrik | Nilai | Skor | Bobot |
|---|---|---|---|
| FCP | 2.0 s | 85 | 10% |
| LCP | 7.7 s | 3 | 25% |
| TBT | 480 ms | 60 | 30% |
| CLS | 0 | 100 | 25% |
| SI | 5.1 s | 61 | 10% |

**Masalah, urut dampak**

| # | Audit | Kategori | Temuan | Dampak |
|---|---|---|---|---|
| 1 | `largest-contentful-paint` | performance | 7.7 s | 24.25 |
| 2 | `total-blocking-time` | performance | 480 ms | 12.00 |
| 3 | `color-contrast` | accessibility | Background and foreground colors do not have a sufficient contrast ratio. | 7.00 |
| 4 | `link-in-text-block` | accessibility | Links rely on color to be distinguishable. | 7.00 |
| 5 | `third-party-cookies` | best-practices | 2 cookies found | 5.00 |
| 6 | `speed-index` | performance | 5.1 s | 3.90 |
| 7 | `first-contentful-paint` | performance | 2.0 s | 1.50 |
| 8 | `errors-in-console` | best-practices | Browser errors were logged to the console | 1.00 |
| 9 | `inspector-issues` | best-practices | Issues were logged in the `Issues` panel in Chrome Devtools | 1.00 |
| 10 | `meta-description` | seo | Document does not have a meta description | 1.00 |
| 11 | `max-potential-fid` | performance | 160 ms | 0.00 |
| 12 | `interactive` | performance | 9.7 s | 0.00 |

#### `color-contrast` — Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast).

| Failing Elements |
|---|
| `div.auth-shell__card > form.auth-form > div.auth-form__tabs > button.auth-form__tab` |
| `section.auth-shell__panel > div.auth-shell__card > form.auth-form > div.auth-form__divider` |
| `section.auth-shell__panel > div.auth-shell__card > form.auth-form > p.auth-form__recaptcha` |

#### `link-in-text-block` — Links rely on color to be distinguishable.

Low-contrast text is difficult or impossible for many users to read. Link text that is discernible improves the experience for users with low vision. [Learn how to make links distinguishable](https://dequeuniversity.com/rules/axe/4.10/link-in-text-block).

| Failing Elements |
|---|
| `div.auth-shell__card > form.auth-form > p.auth-form__recaptcha > a` |
| `div.auth-shell__card > form.auth-form > p.auth-form__recaptcha > a` |

#### `third-party-cookies` — Uses third-party cookies

Third-party cookies may be blocked in some contexts. [Learn more about preparing for third-party cookie restrictions](https://privacysandbox.google.com/cookies/prepare/overview).

| Name | URL |
|---|---|
| __cf_bm | <https://images.pexels.com/photos/1266831/pexels-photo-1266831.jpeg?auto=compress&cs=tinysrgb&w=800> |
| _cfuvid | <https://images.pexels.com/photos/1266831/pexels-photo-1266831.jpeg?auto=compress&cs=tinysrgb&w=800> |

[Laporan mentah](/laporan/masterdiskon_com-id_id_login-2026_10_16_08_48_36.report.json)

### Assertion

| Level | Audit | URL | Harapan | Kenyataan | Operator |
|---|---|---|---|---|---|
| warn | `categories` | `/id-id` | 0.6 | 0.55 | >= |
| warn | `categories` | `/id-id/login` | 0.6 | 0.58 | >= |
