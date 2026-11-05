// Generator spec Playwright dari DOM asli tanpa AI/API eksternal: crawler BFS → introspeksi DOM → perakitan string.
// Output berupa test nyata (status HTTP, judul, heading, form, tombol, navigasi internal) yang langsung bisa dijalankan.
import { target } from './validation.mjs';

// Batas aman: 3 halaman total, 15 dtk/navigasi, 60 dtk/crawl untuk mencegah crawl tanpa ujung.
export const MAX_PAGES = 3;
const NAV_TIMEOUT_MS = 15_000;
const BUDGET_MS = 60_000;
const MAX_LINKS_PER_PAGE = 200;
// Batas isi spec: halaman dengan ratusan elemen tidak boleh menghasilkan file tak terbaca; ringkasan tetap menghitung semua.
const MAX_FIELDS_PER_PAGE = 8;
const MAX_BUTTONS_PER_PAGE = 12;
const MAX_LINK_TESTS_PER_PAGE = 3;

// Escape nilai untuk dipakai di dalam string CSS/Playwright selector.
const cssString = value => `"${String(value)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\a ')
  .replace(/\r/g, '\\d ')
  .replace(/\f/g, '\\c ')}"`;

// #id hanya aman kalau id berupa identifier CSS. Selain itu pakai [id="..."].
const safeId = value => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);

export const idSelector = value =>
  safeId(value) ? `#${value}` : `[id=${cssString(value)}]`;

// Teks DOM dirapikan: whitespace panjang/newline memecah string dan membuat locator sulit dibaca.
const clean = (value, max = 120) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// URL hanya diterima kalau http(s), tanpa kredensial, dan masih origin target; hash dibuang agar halaman sama tidak dikunjungi dua kali.
export function normalizeUrl(href, baseUrl, origin) {
  let url;
  try { url = new URL(href, baseUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (url.origin !== origin) return null;
  url.hash = '';
  return url.href;
}

// Locator input: id → name → fallback type + :nth-match (urutan input bertipe sama di seluruh halaman).
export function inputLocator(input, nth) {
  if (input.id) return idSelector(input.id);
  if (input.name) return `input[name=${cssString(input.name)}]`;
  const type = input.type || 'text';
  const selector = `input[type=${cssString(type)}]`;
  return nth > 1 ? `:nth-match(${selector}, ${nth})` : selector;
}

// Locator tombol: id -> teks -> fallback elemen ke-n.
export function buttonLocator(button, nth) {
  if (button.id) return idSelector(button.id);
  const base = button.tag === 'a' ? 'a.btn' : 'button';
  const text = String(button.text ?? '').trim();
  if (text) {
    const selector = `${base}:has-text(${cssString(text)})`;
    return nth > 1 ? `:nth-match(${selector}, ${nth})` : selector;
  }
  return nth > 1 ? `:nth-match(${base}, ${nth})` : base;
}

// Locator role/label/placeholder lebih tahan perubahan markup; CSS hanya jika elemen tanpa identitas jelas.
function fieldBase(field) {
  // getByLabel/getByPlaceholder tidak menjangkau elemen tersembunyi; hidden/file memakai CSS biasa.
  if (field.visible) {
    if (field.label) return `page.getByLabel(${JSON.stringify(field.label)}, { exact: true })`;
    if (field.placeholder) return `page.getByPlaceholder(${JSON.stringify(field.placeholder)}, { exact: true })`;
    if (field.ariaLabel) return `page.getByLabel(${JSON.stringify(field.ariaLabel)}, { exact: true })`;
  }
  if (field.id) return `page.locator(${JSON.stringify(idSelector(field.id))})`;
  const tag = field.tag === 'textarea' ? 'textarea' : field.tag === 'select' ? 'select' : 'input';
  if (field.name) return `page.locator(${JSON.stringify(`${tag}[name=${cssString(field.name)}]`)})`;
  const selector = tag === 'input' ? `input[type=${cssString(field.type || 'text')}]` : tag;
  return `page.locator(${JSON.stringify(selector)})`;
}

// index hanya ditambahkan bila ada >1 elemen dengan locator dasar sama; menghindari strict-mode violation.
const indexed = (base, index, total) => total > 1 ? `${base}.nth(${index})` : base;

// Nilai uji mengikuti tipe input supaya browser tidak menolak isian.
function sampleValue(field) {
  switch (field.type) {
    case 'email': return 'test-data@example.test';
    case 'number':
    case 'range': return '1';
    case 'date': return '2026-01-01';
    case 'datetime-local': return '2026-01-01T10:00';
    case 'month': return '2026-01';
    case 'week': return '2026-W01';
    case 'time': return '10:00';
    case 'tel': return '081234567890';
    case 'url': return 'https://example.test/';
    case 'color': return '#000000';
    default: return 'test-data';
  }
}

// Satu input → satu aksi sesuai tipe; hidden/file tetap dicek keberadaannya, bukan di-fill.
function fieldAction(field, locator) {
  if (field.type === 'hidden' || field.type === 'file') return { kind: 'attached', locator };
  if (field.type === 'checkbox' || field.type === 'radio') {
    if (!field.visible || field.disabled) return { kind: 'attached', locator };
    return { kind: 'check', locator };
  }
  if (field.tag === 'select') {
    if (!field.visible || field.disabled || field.options <= 1) return { kind: 'attached', locator };
    return { kind: 'select', locator };
  }
  if (['submit', 'button', 'reset', 'image'].includes(field.type)) {
    return field.visible ? { kind: 'visibleEnabled', locator } : { kind: 'attached', locator };
  }
  if (field.disabled) return { kind: 'disabled', locator };
  if (field.readonly) return { kind: 'visible', locator };
  if (!field.visible) return { kind: 'attached', locator };
  return { kind: 'fill', locator, value: sampleValue(field) };
}

// Ubah DOM mentah menjadi aksi unik per halaman; duplikat dibuang.
export function buildFields(inputs = []) {
  const items = inputs.map(input => {
    const tag = input.tag === 'textarea' || input.tag === 'select' ? input.tag : 'input';
    const field = {
      tag,
      type: tag === 'input' ? clean(input.type || 'text', 30).toLowerCase() : tag,
      id: clean(input.id, 100),
      name: clean(input.name, 100),
      label: clean(input.label, 100),
      placeholder: clean(input.placeholder, 100),
      ariaLabel: clean(input.ariaLabel, 100),
      visible: input.visible !== false,
      disabled: !!input.disabled,
      readonly: !!input.readonly,
      required: !!input.required,
      options: Number(input.options) || 0,
    };
    return { field, base: fieldBase(field) };
  });

  const totals = new Map();
  for (const item of items) totals.set(item.base, (totals.get(item.base) ?? 0) + 1);

  const seen = new Map();
  const used = new Set();
  const out = [];
  for (const item of items) {
    const index = seen.get(item.base) ?? 0;
    seen.set(item.base, index + 1);
    const locator = indexed(item.base, index, totals.get(item.base));
    if (used.has(locator)) continue;
    used.add(locator);
    out.push({ ...item.field, locator, action: fieldAction(item.field, locator) });
  }
  return out;
}

export function buildButtons(buttons = []) {
  const items = buttons.map(button => {
    const tag = button.tag === 'a' ? 'a' : 'button';
    const text = clean(button.text, 100);
    const visible = button.visible !== false;
    const role = tag === 'a' ? 'link' : 'button';
    // Role locator mengabaikan elemen hidden; tombol dropdown tertutup dicari lewat CSS agar assertion "attached" tetap menemukannya.
    // Untuk tombol tanpa teks, :visible membuat nth hanya menghitung tombol yang tampil.
    const suffix = visible ? ':visible' : '';
    const base = text && visible
      ? `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(text)}, exact: true })`
      : text
        ? `page.locator(${JSON.stringify(`${tag === 'a' ? 'a.btn' : 'button'}:has-text(${cssString(text)})${suffix}`)})`
        : `page.locator(${JSON.stringify(`${tag === 'a' ? 'a.btn' : 'button'}${suffix}`)})`;
    return { button: { ...button, tag, text, visible }, base };
  });

  const totals = new Map();
  for (const item of items) totals.set(item.base, (totals.get(item.base) ?? 0) + 1);

  const seen = new Map();
  const used = new Set();
  const out = [];
  for (const item of items) {
    const index = seen.get(item.base) ?? 0;
    seen.set(item.base, index + 1);
    const locator = indexed(item.base, index, totals.get(item.base));
    if (used.has(locator)) continue;
    used.add(locator);
    const visible = item.button.visible !== false;
    const disabled = !!item.button.disabled;
    const kind = !visible ? 'attached' : disabled ? 'visibleDisabled' : 'visibleEnabled';
    out.push({ ...item.button, locator, action: { kind, locator } });
  }
  return out;
}

// Hanya tautan internal aman; logout/checkout/pembayaran dilewati karena mengubah state atau keluar alur QA.
const UNSAFE_LINK = /(logout|signout|sign-out|delete|hapus|keluar|checkout|pembayaran|payment)/i;

export function buildLinks(links = [], origin = null) {
  const out = [];
  const seenHref = new Set();
  const seenText = new Map();
  for (const link of links) {
    const text = clean(link.text, 80);
    const raw = clean(link.href, 500);
    if (!text || !raw) continue;
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (origin && url.origin !== origin) continue;
    if (UNSAFE_LINK.test(`${url.pathname} ${text}`)) continue;
    if (seenHref.has(url.href)) continue;
    seenHref.add(url.href);

    const count = (seenText.get(text) ?? 0) + 1;
    seenText.set(text, count);
    const base = `page.getByRole("link", { name: ${JSON.stringify(text)}, exact: true })`;
    const locator = count > 1 ? `${base}.nth(${count - 1})` : `${base}.first()`;
    out.push({ text, href: url.href, locator });
    if (out.length >= MAX_LINK_TESTS_PER_PAGE) break;
  }
  return out;
}

// Nama variabel per test harus unik agar tidak bentrok di satu blok.
const varName = (prefix, index) => `${prefix}${index + 1}`;

function emitAction(lines, name, action) {
  lines.push(`    const ${name} = ${action.locator};`);
  switch (action.kind) {
    case 'fill':
      lines.push(`    await expect(${name}).toBeVisible();`);
      lines.push(`    await ${name}.fill(${JSON.stringify(action.value)});`);
      lines.push(`    await expect(${name}).toHaveValue(${JSON.stringify(action.value)});`);
      break;
    case 'check':
      lines.push(`    await expect(${name}).toBeVisible();`);
      lines.push(`    await ${name}.check();`);
      lines.push(`    await expect(${name}).toBeChecked();`);
      break;
    case 'select':
      lines.push(`    await expect(${name}).toBeVisible();`);
      lines.push(`    await ${name}.selectOption({ index: 1 });`);
      lines.push(`    await expect(${name}).not.toHaveValue("");`);
      break;
    case 'visibleEnabled':
      lines.push(`    await expect(${name}).toBeVisible();`);
      lines.push(`    await expect(${name}).toBeEnabled();`);
      break;
    case 'visibleDisabled':
      lines.push(`    await expect(${name}).toBeVisible();`);
      lines.push(`    await expect(${name}).toBeDisabled();`);
      break;
    case 'disabled':
      lines.push(`    await expect(${name}).toBeDisabled();`);
      break;
    case 'visible':
      lines.push(`    await expect(${name}).toBeVisible();`);
      break;
    default:
      lines.push(`    await expect(${name}).toBeAttached();`);
      break;
  }
}

// Path relatif ke origin; BASE_URL tetap bisa diarahkan ke local/staging seperti spec eureka.
function pathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname || '/') + (u.search || '');
  } catch { return '/'; }
}

// Rakit .spec.ts murni dari string; JSON.stringify untuk URL/locator/judul/nilai agar kutip/backtick tidak merusak kode.
export function buildSpec(pages = []) {
  if (!pages.length) return "import { test, expect } from '@playwright/test';\n";

  const first = pages[0];
  const origin = (() => { try { return new URL(first.url).origin; } catch { return 'http://localhost'; } })();
  const host = (() => { try { return new URL(first.url).host; } catch { return 'target'; } })();
  const lines = [
    'import { test, expect, type Page } from "@playwright/test";',
    '',
    '// File ini dibuat otomatis dari DOM halaman oleh dashboard QA.',
    '// BASE_URL bisa diarahkan ke local/staging; fallback ke origin hasil crawl.',
    `const BASE = (process.env.BASE_URL || ${JSON.stringify(origin)}).replace(/\\/+$/, "");`,
    'const ORIGIN = new URL(BASE).origin;',
    'const url = (path: string) => ORIGIN + path;',
    '',
    `test.describe(${JSON.stringify(`Auto-generated QA - ${host}`)}, () => {`,
    '  let page: Page;',
    '',
    '  test.beforeAll(async ({ browser }) => {',
    '    page = await browser.newPage();',
    '    page.setDefaultTimeout(60_000);',
    '  });',
    '',
    '  // Screenshot tiap langkah memudahkan melihat kondisi saat test gagal.',
    '  test.afterEach(async ({}, testInfo) => {',
    '    if (!page) return;',
    '    const shot = await page.screenshot({ fullPage: true }).catch(() => null);',
    '    if (shot) {',
    '      await testInfo.attach(`ss-${testInfo.title}`, { body: shot, contentType: "image/png" });',
    '    }',
    '  });',
    '',
    '  test.afterAll(async () => {',
    '    await page?.close();',
    '  });',
    '',
    '  // Navigasi diulang 3x: target lokal/staging kadang lambat saat cold start.',
    '  const buka = async (path: string) => {',
    '    let err: unknown;',
    '    for (let i = 0; i < 3; i++) {',
    '      try {',
    '        return await page.goto(url(path), { waitUntil: "domcontentloaded", timeout: 45_000 });',
    '      } catch (e) {',
    '        err = e;',
    '        await page.waitForTimeout(3_000 * (i + 1));',
    '      }',
    '    }',
    '    throw err;',
    '  };',
    '',
  ];

  let counter = 0;
  const nextId = () => `TC-${String(++counter).padStart(2, '0')}`;

  pages.forEach((entry, pageIndex) => {
    const path = pathOf(entry.url);
    lines.push(`  // ── Halaman ${pageIndex + 1}: ${path}`);

    // 1. Halaman benar-benar terbuka dan merespons sukses.
    lines.push(`  test(${JSON.stringify(`${nextId()} ${path} halaman terbuka`)}, async () => {`);
    lines.push(`    const res = await buka(${JSON.stringify(path)});`);
    lines.push('    expect(res, "halaman merespons").not.toBeNull();');
    lines.push('    expect(res!.status(), "HTTP status halaman").toBeLessThan(400);');
    lines.push('    await expect(page).toHaveURL((u) => u.origin === ORIGIN);');
    if (entry.title) lines.push(`    await expect(page).toHaveTitle(${JSON.stringify(entry.title)});`);
    lines.push('    await expect(page.locator("body")).toBeVisible();');
    if (entry.h1) {
      lines.push(`    await expect(page.getByRole("heading", { name: ${JSON.stringify(entry.h1)}, exact: true }).first()).toBeVisible();`);
    }
    if (entry.hasMain) lines.push('    await expect(page.getByRole("main").first()).toBeVisible();');
    if (entry.hasNav) lines.push('    await expect(page.getByRole("navigation").first()).toBeVisible();');
    lines.push('  });', '');

    // 2. Form: isi/centang/pilih nilai lalu pastikan nilainya benar-benar masuk.
    if (entry.fields?.length) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} form dan input`)}, async () => {`);
      lines.push(`    await buka(${JSON.stringify(path)});`);
      entry.fields.forEach((field, i) => emitAction(lines, varName('input', i), field.action));
      lines.push('  });', '');
    }

    // 3. Tombol: cek elemen utama ada, terlihat, dan aktif/tidak aktif sesuai DOM.
    if (entry.buttons?.length) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} tombol utama`)}, async () => {`);
      lines.push(`    await buka(${JSON.stringify(path)});`);
      entry.buttons.forEach((button, i) => emitAction(lines, varName('tombol', i), button.action));
      lines.push('  });', '');
    }

    // 4. Navigasi: klik tautan internal, lalu pastikan halaman tujuan terbuka.
    for (const link of entry.links ?? []) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} tautan ${link.text}`)}, async () => {`);
      lines.push(`    await buka(${JSON.stringify(path)});`);
      lines.push(`    const tautan = ${link.locator};`);
      lines.push('    await expect(tautan).toBeVisible();');
      lines.push('    const href = await tautan.getAttribute("href");');
      lines.push('    expect(href, "href tautan").toBeTruthy();');
      lines.push('    const res = await page.goto(new URL(href!, page.url()).href, { waitUntil: "domcontentloaded", timeout: 45_000 });');
      lines.push('    expect(res, "halaman tujuan merespons").not.toBeNull();');
      lines.push('    expect(res!.status(), "HTTP status tujuan").toBeLessThan(400);');
      lines.push('    await expect(page.locator("body")).toBeVisible();');
      lines.push('    await expect(page).toHaveURL((u) => u.origin === ORIGIN);');
      lines.push('  });', '');
    }
  });

  lines.push('});');
  return lines.join('\n').trimEnd() + '\n';
}

// Rakit aksi satu halaman. links ikut diproses supaya spec punya uji navigasi.
export function buildActions(inputs = [], buttons = [], links = [], origin = null) {
  return {
    fields: buildFields(inputs),
    buttons: buildButtons(buttons),
    links: buildLinks(links, origin),
  };
}

const isHtml = response => {
  if (!response) return true;
  const type = response.headers()['content-type'] ?? '';
  return !type || /text\/html|application\/xhtml\+xml/i.test(type);
};

// Crawl + introspeksi + rakit spec; browser selalu ditutup di finally termasuk saat target gagal/timeout.
export async function generateSpec({
  startUrl,
  origins,
  maxPages = MAX_PAGES,
  navTimeoutMs = NAV_TIMEOUT_MS,
  budgetMs = BUDGET_MS,
}) {
  const validated = target(startUrl, origins);
  const startUrlObj = new URL(validated);
  startUrlObj.hash = '';
  const start = startUrlObj.href;
  const origin = startUrlObj.origin;
  const limit = Math.max(1, Math.min(Number(maxPages) || MAX_PAGES, MAX_PAGES));
  const deadline = Date.now() + budgetMs;

  // Import lazy: unit test builder tidak memuat browser; error dependency baru muncul saat endpoint dipakai.
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright tidak tersedia di server ini.'); }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(navTimeoutMs);

    const queue = [start];
    const seen = new Set([start]);
    const pages = [];

    while (queue.length && pages.length < limit) {
      if (Date.now() >= deadline) break;
      const url = queue.shift();

      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
      } catch (err) {
        // Halaman awal wajib terbuka; tautan rusak di halaman berikutnya dilewati agar satu link mati tidak menggagalkan semua.
        if (!pages.length) throw new Error(`Gagal membuka ${url}: ${err.message}`);
        continue;
      }

      const status = response?.status() ?? 0;
      if (status >= 400) {
        if (!pages.length) throw new Error(`Target mengembalikan HTTP ${status}: ${url}`);
        continue;
      }
      if (!isHtml(response)) continue;

      let meta, inputs, buttons, links;
      try {
        [meta, inputs, buttons, links] = await Promise.all([
          page.evaluate(() => ({
            title: document.title,
            h1: document.querySelector('h1')?.innerText ?? '',
            hasMain: !!document.querySelector('main, [role="main"]'),
            hasNav: !!document.querySelector('nav, [role="navigation"]'),
          })),
          page.$$eval('input, textarea, select', els => els.map(el => {
            const tag = el.tagName.toLowerCase();
            const type = tag === 'input'
              ? (el.getAttribute('type') || el.type || 'text').toLowerCase()
              : tag;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              tag,
              type,
              id: el.id || '',
              name: el.getAttribute('name') || '',
              placeholder: el.getAttribute('placeholder') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              label: el.labels && el.labels.length
                ? (el.labels[0].innerText || el.labels[0].textContent || '')
                : '',
              required: !!el.required,
              disabled: !!el.disabled,
              readonly: !!el.readOnly,
              options: tag === 'select' ? el.options.length : 0,
              visible: rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden',
            };
          })),
          page.$$eval('button, a.btn', els => els.map(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
              type: (el.getAttribute('type') || '').toLowerCase(),
              disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
              visible: rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden',
            };
          })),
          page.$$eval('a[href]', (els, max) => els.slice(0, max).map(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
              href: el.href,
              visible: rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden',
            };
          }), MAX_LINKS_PER_PAGE),
        ]);
      } catch (err) {
        // Halaman bisa berpindah sendiri (meta refresh) saat dibaca.
        if (!pages.length) throw new Error(`Gagal membaca DOM ${url}: ${err.message}`);
        continue;
      }

      // Tombol tersembunyi di dropdown/menu tidak diuji (role locator mengabaikannya; "attached" tak bernilai QA).
      const actions = buildActions(
        inputs,
        buttons.filter(button => button.visible),
        links.filter(link => link.visible),
        origin,
      );
      pages.push({
        url,
        title: clean(meta.title, 200),
        h1: clean(meta.h1, 120),
        hasMain: meta.hasMain,
        hasNav: meta.hasNav,
        fields: actions.fields.slice(0, MAX_FIELDS_PER_PAGE),
        buttons: actions.buttons.slice(0, MAX_BUTTONS_PER_PAGE),
        links: actions.links,
        counts: { inputs: inputs.length, buttons: buttons.length, links: links.length },
      });

      if (pages.length >= limit) break;

      // BFS: tautan halaman ini masuk antrean belakang; el.href absolut, normalizeUrl tetap menyaring origin.
      // Gagal baca tautan tidak membatalkan halaman yang sudah dipindai.
      const hrefs = await page.$$eval('a[href]', (els, max) =>
        els.slice(0, max).map(el => el.href).filter(Boolean), MAX_LINKS_PER_PAGE)
        .catch(() => []);
      for (const href of hrefs) {
        const next = normalizeUrl(href, page.url(), origin);
        if (!next || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    if (!pages.length) throw new Error('Tidak ada halaman HTML yang bisa dipindai.');

    return {
      code: buildSpec(pages),
      pages: pages.map(p => ({
        url: p.url,
        inputs: p.counts.inputs,
        buttons: p.counts.buttons,
        links: p.counts.links,
      })),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
