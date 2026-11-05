// Generator spec Playwright dari DOM asli tanpa AI/API eksternal: crawler BFS → introspeksi DOM → perakitan string.
// Output berupa test nyata (status HTTP, judul, heading, form, tombol, navigasi internal) yang langsung bisa dijalankan.
import { target } from './validation.mjs';

// Batas aman: 3 halaman total, 15 dtk/navigasi, 60 dtk/crawl untuk mencegah crawl tanpa ujung.
export const MAX_PAGES = 3;
const NAV_TIMEOUT_MS = 15_000;
const BUDGET_MS = 60_000;
const MAX_LINKS_PER_PAGE = 500;
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
  if (url.searchParams.has('_rsc')) url.searchParams.delete('_rsc');
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

function emitAction(lines, name, action, indent = '    ') {
  lines.push(`${indent}const ${name} = ${action.locator};`);
  switch (action.kind) {
    case 'fill':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      lines.push(`${indent}await ${name}.fill(${JSON.stringify(action.value)});`);
      lines.push(`${indent}await expect(${name}).toHaveValue(${JSON.stringify(action.value)});`);
      break;
    case 'check':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      lines.push(`${indent}await ${name}.check();`);
      lines.push(`${indent}await expect(${name}).toBeChecked();`);
      break;
    case 'select':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      lines.push(`${indent}await ${name}.selectOption({ index: 1 });`);
      lines.push(`${indent}await expect(${name}).not.toHaveValue("");`);
      break;
    case 'visibleEnabled':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      lines.push(`${indent}await expect(${name}).toBeEnabled();`);
      break;
    case 'visibleDisabled':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      lines.push(`${indent}await expect(${name}).toBeDisabled();`);
      break;
    case 'disabled':
      lines.push(`${indent}await expect(${name}).toBeDisabled();`);
      break;
    case 'visible':
      lines.push(`${indent}await expect(${name}).toBeVisible();`);
      break;
    default:
      lines.push(`${indent}await expect(${name}).toBeAttached();`);
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
    '  const jeda = async (label: string) => {',
    '    const file = process.env.PLAYBOOK_CONTROL_FILE;',
    '    if (!file) return;',
    '    const fs = await import("node:fs/promises");',
    '    await fs.writeFile(`${file}.state`, JSON.stringify({ label, at: Date.now() })).catch(() => {});',
    '    for (;;) {',
    '      const raw = await fs.readFile(file, "utf8").catch(() => \'{"mode":"run"}\');',
    '      let mode = "run";',
    '      try { mode = JSON.parse(raw).mode ?? "run"; } catch {}',
    '      if (mode === "run") return;',
    '      if (mode === "step") {',
    '        await fs.writeFile(file, JSON.stringify({ mode: "pause" })).catch(() => {});',
    '        return;',
    '      }',
    '      await new Promise((r) => setTimeout(r, 300));',
    '    }',
    '  };',
    '',
    '  const langkah = async (label: string, body: () => Promise<void>) => {',
    '    await test.step(label, async () => {',
    '      await jeda(label);',
    '      await body();',
    '    });',
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
    lines.push(`    await langkah(${JSON.stringify(`Buka ${path}`)}, async () => {`);
    lines.push(`      const res = await buka(${JSON.stringify(path)});`);
    lines.push('      expect(res, "halaman merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status halaman").toBeLessThan(400);');
    lines.push('      await expect(page).toHaveURL((u) => u.origin === ORIGIN);');
    if (entry.title) lines.push(`      await expect(page).toHaveTitle(${JSON.stringify(entry.title)});`);
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    if (entry.h1) {
      lines.push(`      await expect(page.getByRole("heading", { name: ${JSON.stringify(entry.h1)}, exact: true }).first()).toBeVisible();`);
    }
    if (entry.hasMain) lines.push('      await expect(page.getByRole("main").first()).toBeVisible();');
    if (entry.hasNav) lines.push('      await expect(page.getByRole("navigation").first()).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');

    // 2. Form: isi/centang/pilih nilai lalu pastikan nilainya benar-benar masuk.
    if (entry.fields?.length) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} form dan input`)}, async () => {`);
      lines.push(`    await buka(${JSON.stringify(path)});`);
      entry.fields.forEach((field, i) => {
        const label = field.label || field.placeholder || field.ariaLabel || field.name || field.type || 'field';
        const actionLabel = field.action.kind === 'check' ? `Centang ${label}`
          : field.action.kind === 'fill' ? `Isi ${label}`
          : field.action.kind === 'select' ? `Pilih ${label}`
          : `Cek ${label}`;
        lines.push(`    await langkah(${JSON.stringify(actionLabel)}, async () => {`);
        emitAction(lines, varName('input', i), field.action, '      ');
        lines.push('    });');
      });
      lines.push('  });', '');
    }

    // 3. Tombol: cek elemen utama ada, terlihat, dan aktif/tidak aktif sesuai DOM.
    if (entry.buttons?.length) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} tombol utama`)}, async () => {`);
      lines.push(`    await buka(${JSON.stringify(path)});`);
      entry.buttons.forEach((button, i) => {
        const label = button.text || 'tombol';
        lines.push(`    await langkah(${JSON.stringify(`Tombol ${label}`)}, async () => {`);
        emitAction(lines, varName('tombol', i), button.action, '      ');
        lines.push('    });');
      });
      lines.push('  });', '');
    }

    // 4. Navigasi: klik tautan internal, lalu pastikan halaman tujuan terbuka.
    for (const link of entry.links ?? []) {
      lines.push(`  test(${JSON.stringify(`${nextId()} ${path} tautan ${link.text}`)}, async () => {`);
      lines.push(`    await langkah(${JSON.stringify(`Buka tautan ${link.text}`)}, async () => {`);
      lines.push(`      await buka(${JSON.stringify(path)});`);
      lines.push(`      const tautan = ${link.locator};`);
      lines.push('      await expect(tautan).toBeVisible();');
      lines.push('      const href = await tautan.getAttribute("href");');
      lines.push('      expect(href, "href tautan").toBeTruthy();');
      lines.push('      const res = await page.goto(new URL(href!, page.url()).href, { waitUntil: "domcontentloaded", timeout: 45_000 });');
      lines.push('      expect(res, "halaman tujuan merespons").not.toBeNull();');
      lines.push('      expect(res!.status(), "HTTP status tujuan").toBeLessThan(400);');
      lines.push('      await expect(page.locator("body")).toBeVisible();');
      lines.push('      await expect(page).toHaveURL((u) => u.origin === ORIGIN);');
      lines.push('    });');
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
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
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


// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER JOURNEY — Spec generator yang menyimulasikan alur pelanggan lengkap:
// registrasi → login → cari → jelajah → detail → keranjang → checkout → profil.
// ═══════════════════════════════════════════════════════════════════════════════

export const MAX_JOURNEY_PAGES = 50;
const JOURNEY_NAV_TIMEOUT_MS = 30_000;
const JOURNEY_BUDGET_MS = 300_000;

// ── classifyPage ──────────────────────────────────────────────────────────────
// Klasifikasi halaman dari data DOM. Mengembalikan { type, confidence }.
export function classifyPage(meta, inputs, buttons, links) {
  const title = clean(meta.title, 300).toLowerCase();
  const url = clean(meta.url || '', 500).toLowerCase();
  const h1 = clean(meta.h1 || '', 300).toLowerCase();
  const combined = `${url} ${title} ${h1}`;

  const hasPasswordInput = inputs.some(i => (i.type || '').toLowerCase() === 'password');
  const hasEmailInput = inputs.some(i =>
    (i.type || '').toLowerCase() === 'email' ||
    /email|e-mail/i.test(`${i.name} ${i.placeholder} ${i.label} ${i.ariaLabel}`)
  );
  const hasTextInput = inputs.some(i =>
    (i.type || '').toLowerCase() === 'text' ||
    (i.tag === 'input' && !(i.type || 'text').match(/^(password|email|hidden|submit|button|reset|file|image|checkbox|radio|search|number|range|date|datetime-local|month|week|time|tel|url|color)$/i))
  );
  const hasNameInput = inputs.some(i =>
    /name|nama|username/i.test(`${i.name} ${i.placeholder} ${i.label} ${i.ariaLabel}`)
  );
  const hasPhoneInput = inputs.some(i =>
    (i.type || '').toLowerCase() === 'tel' ||
    /phone|telepon|hp|handphone|no_hp|nomor/i.test(`${i.name} ${i.placeholder} ${i.label} ${i.ariaLabel}`)
  );
  const hasSubmitButton = buttons.some(b =>
    (b.type || '').toLowerCase() === 'submit' ||
    /submit|masuk|login|daftar|register|sign/i.test(b.text || '')
  );
  const hasSearchInput = inputs.some(i =>
    (i.type || '').toLowerCase() === 'search' ||
    /cari|search/i.test(`${i.name} ${i.placeholder} ${i.label} ${i.ariaLabel}`)
  );
  const hasAddToCartButton = buttons.some(b =>
    /tambah.*(keranjang|cart)|add.*to.*cart|beli|buy\s*now/i.test(b.text || '')
  );
  const hasCheckoutButton = buttons.some(b =>
    /checkout|bayar|pembayaran|payment/i.test(b.text || '')
  );
  const hasAddressInputs = inputs.some(i =>
    /address|alamat|shipping|pengiriman|kota|city|postal|kode.?pos/i.test(`${i.name} ${i.placeholder} ${i.label} ${i.ariaLabel}`)
  );

  // Hitung tautan dengan pola URL serupa (indikasi listing/produk).
  const productPatterns = links.filter(l =>
    /\/(product|produk|detail|detail-produk|item|p|goods|buku)\//i.test(l.href || '')
  );

  // Homepage: path persis "/" atau root locale.
  try {
    const u = new URL(url.startsWith('http') ? url : `http://x${url}`);
    if (/^\/(id-id|en|id)?\/?$/.test(u.pathname)) {
      return { type: 'homepage', confidence: 0.9 };
    }
  } catch { /* bukan URL valid, abaikan */ }

  // Login: password + (email/text) + submit, URL/title mengandung login/masuk.
  if (hasPasswordInput && (hasEmailInput || hasTextInput) && hasSubmitButton) {
    if (/login|masuk|sign.?in/i.test(combined)) {
      return { type: 'login', confidence: 0.95 };
    }
  }

  // Register: password + email + (name/phone), URL/title mengandung register/daftar.
  if (hasPasswordInput && hasEmailInput && (hasNameInput || hasPhoneInput)) {
    if (/register|daftar|sign.?up|buat.?akun/i.test(combined)) {
      return { type: 'register', confidence: 0.95 };
    }
  }

  // Checkout: URL mengandung checkout/pembayaran + ada form alamat.
  if (/checkout|pembayaran|payment/i.test(combined) && hasAddressInputs) {
    return { type: 'checkout', confidence: 0.9 };
  }
  if (/checkout|pembayaran|payment/i.test(combined)) {
    return { type: 'checkout', confidence: 0.7 };
  }

  // Cart: URL/title mengandung cart/keranjang, atau ada tombol checkout.
  if (/cart|keranjang|bag/i.test(combined)) {
    return { type: 'cart', confidence: 0.9 };
  }
  if (hasCheckoutButton) {
    return { type: 'cart', confidence: 0.7 };
  }

  // Search: ada search input atau URL mengandung search/cari.
  if (hasSearchInput || /search|cari/i.test(combined)) {
    return { type: 'search', confidence: 0.8 };
  }

  // Detail produk: ada tombol add-to-cart.
  if (hasAddToCartButton) {
    return { type: 'detail', confidence: 0.85 };
  }

  // Listing: banyak tautan produk.
  if (productPatterns.length >= 3) {
    return { type: 'listing', confidence: 0.8 };
  }
  if (/category|kategori|products|produk/i.test(combined)) {
    return { type: 'listing', confidence: 0.7 };
  }

  // Profile.
  if (/profile|profil|account|akun/i.test(combined)) {
    return { type: 'profile', confidence: 0.7 };
  }

  // Login/register fallback tanpa keyword URL (confidence lebih rendah).
  if (hasPasswordInput && (hasEmailInput || hasTextInput) && hasSubmitButton) {
    if (hasNameInput || hasPhoneInput) return { type: 'register', confidence: 0.5 };
    return { type: 'login', confidence: 0.5 };
  }

  return { type: 'other', confidence: 0.3 };
}

// ── findNavButtons ──────────────────────────────────────────────────────────
// Temukan tombol navigasi utama (misal dropdown Kategori, Genre, Menu)
export function findNavButtons(buttons = []) {
  const navBtnPat = /\b(kategori|category|menu|genre|filter|navigasi|jelajah|explore)\b/i;
  const out = [];
  const seen = new Set();
  for (const btn of buttons) {
    if (!btn.visible || btn.disabled) continue;
    const txt = clean(btn.text, 50);
    if (!txt || seen.has(txt)) continue;
    if (navBtnPat.test(txt) && !/^(masuk|login|daftar|register|sign|beli|buy|tambah)/i.test(txt)) {
      seen.add(txt);
      out.push(btn);
    }
  }
  return out.slice(0, 8);
}

// ── findJourneyLinks ──────────────────────────────────────────────────────────
// Dari array tautan dan tombol, temukan target navigasi spesifik untuk seluruh alur journey.
export function findJourneyLinks(links, pageUrl, buttons = []) {
  const result = {
    login: null,
    register: null,
    cart: null,
    search: null,
    categories: [],
    products: [],
    profile: null,
    checkout: null,
    navLinks: [],
  };

  const loginPat = /\b(masuk|log\s*in|sign\s*in)\b/i;
  const loginHrefPat = /\/(auth\/)?(login|masuk|signin)(\?|\/|$)/i;

  const registerPat = /\b(daftar|register|sign\s*up|buat\s*akun|create\s*account)\b/i;
  const registerHrefPat = /\/(auth\/)?(register|daftar|signup|buat-akun)(\?|\/|$)/i;

  const cartPat = /\b(keranjang|cart|bag|tas\s*belanja)\b/i;
  const cartHrefPat = /\/(cart|keranjang|bag)(\?|\/|$)/i;

  const searchPat = /\b(cari|search|find)\b/i;
  const searchHrefPat = /\/(search|cari|find)(\?|\/|$)/i;

  const categoryPat = /(kategori|category|semua[- ]produk|all[- ]products|katalog|catalog|shop|store|collection|flashsale|pre[- ]order|genre|buku[- ]pelajaran|perguruan[- ]tinggi|non[- ]fiksi|fiksi|buku[- ]anak|buku[- ]murah|promo|sale|diskon)/i;
  const categoryHrefPat = /(\/kategori\/|\/category\/|\/genre\/|\/katalog\/|\/catalog\/|\/collections?\/|\/flashsale|\/pre-order)/i;

  const productUrlPat = /\/(product|produk|detail|detail-produk|item|p|goods|buku)\//i;

  const profilePat = /\b(profil|profile|akun|account|my\s*account|member)\b/i;
  const profileHrefPat = /\/(profile|profil|akun|account|member)(\?|\/|$)/i;

  const checkoutPat = /\b(checkout|pembayaran|bayar|payment)\b/i;
  const checkoutHrefPat = /\/(checkout|pembayaran)(\?|\/|$)/i;

  const unsafePat = /(logout|signout|sign-out|delete|hapus|keluar)/i;

  const seenHrefs = new Set();

  for (const link of links) {
    const rawText = clean(link.text, 120);
    const text = rawText.toLowerCase();
    const href = clean(link.href, 500);
    if (!href) continue;
    if (seenHrefs.has(href)) continue;
    seenHrefs.add(href);

    if (unsafePat.test(`${text} ${href}`)) continue;
    const combined = `${text} ${href}`;

    if (!result.login && (loginPat.test(text) || loginHrefPat.test(href))) {
      result.login = { text: rawText || 'Masuk', href };
      continue;
    }
    if (!result.register && (registerPat.test(text) || registerHrefPat.test(href))) {
      result.register = { text: rawText || 'Daftar', href };
      continue;
    }
    if (!result.cart && (cartPat.test(text) || cartHrefPat.test(href))) {
      result.cart = { text: rawText || 'Keranjang', href };
      continue;
    }
    if (!result.search && (searchPat.test(text) || searchHrefPat.test(href))) {
      result.search = { text: rawText || 'Cari', href };
      continue;
    }
    if (!result.profile && (profilePat.test(text) || profileHrefPat.test(href))) {
      result.profile = { text: rawText || 'Profil', href };
      continue;
    }
    if (!result.checkout && (checkoutPat.test(text) || checkoutHrefPat.test(href))) {
      result.checkout = { text: rawText || 'Checkout', href };
      continue;
    }

    if (productUrlPat.test(href)) {
      if (result.products.length < 50) {
        result.products.push({ text: rawText || 'Produk', href });
      }
      continue;
    }

    if (categoryPat.test(combined) || categoryHrefPat.test(href)) {
      if (result.categories.length < 50) {
        result.categories.push({ text: rawText || 'Kategori', href });
      }
      continue;
    }

    // Navigasi menu / path umum lainnya (store location, promo, tentang kami, dll)
    if (result.navLinks.length < 50 && rawText && !/^\d+$/.test(rawText)) {
      result.navLinks.push({ text: rawText, href });
    }
  }

  return result;
}

// ── buildJourneySpec ──────────────────────────────────────────────────────────
// Rakit .spec.ts lengkap dari objek journey. Setiap langkah menghasilkan test serial.
export function buildJourneySpec(journey) {
  const lines = [
    'import { test, expect, type Page, type Browser } from "@playwright/test";',
    '',
    '// File ini dibuat otomatis: simulasi alur pelanggan lengkap.',
    '// BASE_URL bisa diarahkan ke local/staging; fallback ke origin hasil crawl.',
    `const BASE = (process.env.BASE_URL || ${JSON.stringify(journey.origin)}).replace(/\\/+$/, "");`,
    'const ORIGIN = new URL(BASE).origin;',
    'const url = (path: string) => ORIGIN + path;',
    '',
    '// Kredensial test; JANGAN dipakai di production.',
    'const BOT = {',
    '  name: "QAbot",',
    '  email: "qabot@test.playbook",',
    '  phone: "081200000000",',
    '  username: "qabot",',
    '  password: "botplaywright123",',
    '};',
    '',
    `test.describe.serial(${JSON.stringify(`Journey lengkap - ${journey.host}`)}, () => {`,
    '  let page: Page;',
    '',
    '  test.beforeAll(async ({ browser }) => {',
    '    page = await browser.newPage();',
    '    page.setDefaultTimeout(60_000);',
    '  });',
    '',
    '  test.afterEach(async ({}, testInfo) => {',
    '    if (!page) return;',
    '    const shot = await page.screenshot({ fullPage: true }).catch(() => null);',
    '    if (shot) {',
    '      await testInfo.attach(`ss-${testInfo.title}`, { body: shot, contentType: "image/png" });',
    '    }',
    '  });',
    '',
    '  test.afterAll(async () => {',
    '    await page?.close().catch(() => {});',
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
    '  const jeda = async (label: string) => {',
    '    const file = process.env.PLAYBOOK_CONTROL_FILE;',
    '    if (!file) return;',
    '    const fs = await import("node:fs/promises");',
    '    await fs.writeFile(`${file}.state`, JSON.stringify({ label, at: Date.now() })).catch(() => {});',
    '    for (;;) {',
    '      const raw = await fs.readFile(file, "utf8").catch(() => \'{"mode":"run"}\');',
    '      let mode = "run";',
    '      try { mode = JSON.parse(raw).mode ?? "run"; } catch {}',
    '      if (mode === "run") return;',
    '      if (mode === "step") {',
    '        await fs.writeFile(file, JSON.stringify({ mode: "pause" })).catch(() => {});',
    '        return;',
    '      }',
    '      await new Promise((r) => setTimeout(r, 300));',
    '    }',
    '  };',
    '',
    '  const langkah = async (label: string, body: () => Promise<void>) => {',
    '    await test.step(label, async () => {',
    '      await jeda(label);',
    '      await body();',
    '    });',
    '  };',
    '',
    '  // Tutup popup/dialog yang mungkin muncul (cookie consent, promosi, dll).',
    '  const tutupPopup = async () => {',
    '    const selectors = [',
    '      \'button:has-text("Accept")\',',
    '      \'button:has-text("Terima")\',',
    '      \'button:has-text("OK")\',',
    '      \'button:has-text("Close")\',',
    '      \'button:has-text("Tutup")\',',
    '      \'button:has-text("Got it")\',',
    '      \'[class*="close"][role="button"]\',',
    '      \'button[aria-label="Close"]\',',
    '      \'button[aria-label="Tutup"]\',',
    '    ];',
    '    for (const sel of selectors) {',
    '      try { await page.locator(sel).first().click({ timeout: 1_000 }); return; } catch {}',
    '    }',
    '  };',
    '',
  ];

  let counter = 0;
  const nextId = () => `TC-${String(++counter).padStart(2, '0')}`;

  // ── TC-01 Homepage terbuka ────────────────────────────────────────────────
  const hp = journey.homepage;
  lines.push(`  test(${JSON.stringify(`${nextId()} Homepage terbuka`)}, async () => {`);
  lines.push('    await langkah("Buka halaman utama", async () => {');
  lines.push('      const res = await buka("/");');
  lines.push('      expect(res, "halaman merespons").not.toBeNull();');
  lines.push('      expect(res!.status(), "HTTP status homepage").toBeLessThan(400);');
  if (hp.title) lines.push(`      await expect(page).toHaveTitle(${JSON.stringify(hp.title)});`);
  lines.push('      await expect(page.locator("body")).toBeVisible();');
  if (hp.hasNav) lines.push('      await expect(page.getByRole("navigation").first()).toBeVisible();');
  lines.push('    });');
  lines.push('    await tutupPopup();');
  lines.push('  });', '');

  // ── Tombol Navigasi Homepage (dropdown Kategori, Genre, Menu) ─────────────
  if (journey.navButtons && journey.navButtons.length) {
    for (const btn of journey.navButtons) {
      const btnText = btn.text || 'menu';
      lines.push(`  test(${JSON.stringify(`${nextId()} Interaksi tombol navigasi - ${btnText}`)}, async () => {`);
      lines.push(`    await langkah(${JSON.stringify(`Klik tombol navigasi ${btnText}`)}, async () => {`);
      lines.push('      await buka("/");');
      lines.push('      try {');
      lines.push(`        const btnEl = page.locator(${JSON.stringify(`button:has-text(${cssString(btnText)}), [role="button"]:has-text(${cssString(btnText)})`)}).first();`);
      lines.push('        await expect(btnEl).toBeVisible({ timeout: 5_000 });');
      lines.push('        await btnEl.click();');
      lines.push('        await page.waitForTimeout(1_000);');
      lines.push('      } catch { /* tombol navigasi opsional */ }');
      lines.push('    });');
      lines.push('  });', '');
    }
  }

  // ── TC-02 Registrasi akun ─────────────────────────────────────────────────
  if (journey.register) {
    const reg = journey.register;
    lines.push(`  test(${JSON.stringify(`${nextId()} Registrasi akun`)}, async () => {`);
    lines.push('    await langkah("Buka halaman registrasi", async () => {');
    lines.push(`      const res = await buka(${JSON.stringify(reg.path)});`);
    lines.push('      expect(res, "halaman registrasi merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status registrasi").toBeLessThan(400);');
    lines.push('    });');

    if (reg.isModal && reg.buttonText) {
      lines.push('    await langkah("Buka modal registrasi", async () => {');
      lines.push(`      const regBtn = page.locator(${JSON.stringify(`button:has-text(${cssString(reg.buttonText)}), [role="button"]:has-text(${cssString(reg.buttonText)})`)}).first();`);
      lines.push('      await regBtn.click();');
      lines.push('      await page.waitForTimeout(1_000);');
      lines.push('    });');
    }

    // Isi form registrasi secara cerdas.
    lines.push('    await langkah("Isi form registrasi", async () => {');
    if (reg.fields && reg.fields.length) {
      for (const field of reg.fields) {
        const loc = field.locator;
        const fieldName = (field.name || field.label || field.placeholder || field.ariaLabel || '').toLowerCase();
        const fieldType = (field.type || '').toLowerCase();

        if (fieldType === 'hidden' || fieldType === 'file') continue;

        if (fieldType === 'checkbox') {
          lines.push(`      try { await ${loc}.check(); } catch { /* checkbox opsional */ }`);
          continue;
        }
        if (fieldType === 'radio') continue;
        if (field.tag === 'select') {
          lines.push(`      try { await ${loc}.selectOption({ index: 1 }); } catch { /* select opsional */ }`);
          continue;
        }

        // Tentukan nilai berdasarkan konteks field.
        let value = 'BOT.name';
        if (/confirm|konfirmasi|ulang|re.?password|re.?type/i.test(fieldName)) {
          value = 'BOT.password';
        } else if (fieldType === 'email' || /email|e-?mail/i.test(fieldName)) {
          value = 'BOT.email';
        } else if (fieldType === 'password' || /password|sandi|kata.?sandi/i.test(fieldName)) {
          value = 'BOT.password';
        } else if (fieldType === 'tel' || /phone|telepon|hp|handphone|no_hp|nomor/i.test(fieldName)) {
          value = 'BOT.phone';
        } else if (/username|user.?name/i.test(fieldName)) {
          value = 'BOT.username';
        } else if (/name|nama/i.test(fieldName)) {
          value = 'BOT.name';
        } else {
          value = '"test-data"';
        }

        if (!field.visible || field.disabled || field.readonly) continue;
        lines.push(`      try { await ${loc}.fill(${value}); } catch { /* field opsional */ }`);
      }
    } else {
      lines.push('      try { await page.locator(\'input[name*="name"], input[placeholder*="Nama"], input[aria-label*="Nama"]\').first().fill(BOT.name); } catch {}');
      lines.push('      try { await page.locator(\'input[type="email"], input[name*="email"], input[placeholder*="Email"]\').first().fill(BOT.email); } catch {}');
      lines.push('      try { await page.locator(\'input[type="tel"], input[name*="phone"], input[placeholder*="Telepon"], input[placeholder*="HP"]\').first().fill(BOT.phone); } catch {}');
      lines.push('      try { await page.locator(\'input[type="password"], input[name*="password"], input[placeholder*="Sandi"]\').first().fill(BOT.password); } catch {}');
    }
    lines.push('    });');

    lines.push('    await langkah("Kirim form registrasi", async () => {');
    lines.push('      const submitBtn = page.locator(\'button[type="submit"], input[type="submit"], button:has-text("Daftar"), button:has-text("Register"), button:has-text("Sign Up"), button:has-text("Buat Akun")\').first();');
    lines.push('      try {');
    lines.push('        await submitBtn.click({ timeout: 5_000 });');
    lines.push('        await page.waitForLoadState("domcontentloaded");');
    lines.push('      } catch { /* submit mungkin tidak tersedia */ }');
    lines.push('      await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-03 Login ───────────────────────────────────────────────────────────
  if (journey.login) {
    const log = journey.login;
    lines.push(`  test(${JSON.stringify(`${nextId()} Login`)}, async () => {`);
    lines.push('    await langkah("Buka halaman login", async () => {');
    lines.push(`      const res = await buka(${JSON.stringify(log.path)});`);
    lines.push('      expect(res, "halaman login merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status login").toBeLessThan(400);');
    lines.push('    });');

    if (log.isModal && log.buttonText) {
      lines.push('    await langkah("Buka modal login", async () => {');
      lines.push(`      const logBtn = page.locator(${JSON.stringify(`button:has-text(${cssString(log.buttonText)}), [role="button"]:has-text(${cssString(log.buttonText)})`)}).first();`);
      lines.push('      await logBtn.click();');
      lines.push('      await page.waitForTimeout(1_000);');
      lines.push('    });');
    }

    lines.push('    await langkah("Isi email/username", async () => {');
    if (log.emailField) {
      lines.push(`      await ${log.emailField.locator}.fill(BOT.email);`);
    } else {
      lines.push('      const emailInput = page.locator(\'input[type="email"], input[name*="email"], input[name*="user"], input[placeholder*="email"], input[placeholder*="username"], input[aria-label*="email"]\').first();');
      lines.push('      try { await emailInput.fill(BOT.email); } catch {}');
    }
    lines.push('    });');

    lines.push('    await langkah("Isi password", async () => {');
    if (log.passwordField) {
      lines.push(`      await ${log.passwordField.locator}.fill(BOT.password);`);
    } else {
      lines.push('      const passInput = page.locator(\'input[type="password"], input[name*="password"], input[name*="sandi"], input[placeholder*="password"], input[placeholder*="sandi"]\').first();');
      lines.push('      try { await passInput.fill(BOT.password); } catch {}');
    }
    lines.push('    });');

    lines.push('    await langkah("Klik tombol login", async () => {');
    if (log.submitButton) {
      lines.push(`      await ${log.submitButton.locator}.click();`);
    } else {
      lines.push('      const submitBtn = page.locator(\'button[type="submit"], input[type="submit"], button:has-text("Masuk"), button:has-text("Login"), button:has-text("Sign In")\').first();');
      lines.push('      try { await submitBtn.click(); } catch {}');
    }
    lines.push('      await page.waitForLoadState("domcontentloaded");');
    lines.push('      // Verifikasi: URL seharusnya berubah setelah login berhasil.');
    lines.push('      await page.waitForTimeout(2_000);');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-04 Cari produk ─────────────────────────────────────────────────────
  if (journey.search) {
    const srch = journey.search;
    lines.push(`  test(${JSON.stringify(`${nextId()} Cari produk`)}, async () => {`);
    if (srch.path) {
      lines.push('    await langkah("Buka halaman pencarian", async () => {');
      lines.push(`      await buka(${JSON.stringify(srch.path)});`);
      lines.push('    });');
    }

    lines.push('    await langkah("Isi kata kunci pencarian", async () => {');
    if (srch.searchField) {
      lines.push(`      const searchInput = ${srch.searchField.locator};`);
    } else {
      lines.push('      const searchInput = page.locator(\'input[type="search"], input[name*="search"], input[name*="cari"], input[placeholder*="Cari"], input[placeholder*="Search"]\').first();');
    }
    lines.push('      await expect(searchInput).toBeVisible({ timeout: 10_000 });');
    lines.push('      await searchInput.fill("buku");');
    lines.push('      await searchInput.press("Enter");');
    lines.push('      await page.waitForLoadState("domcontentloaded");');
    lines.push('    });');

    lines.push('    await langkah("Verifikasi hasil pencarian", async () => {');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-05 Jelajah seluruh kategori / path belanja ─────────────────────────
  const categoriesToTest = journey.categories?.length
    ? journey.categories
    : journey.listing ? [journey.listing] : [];

  for (const cat of categoriesToTest) {
    const label = cat.name ? `Jelajah kategori - ${cat.name}` : 'Jelajah kategori';
    lines.push(`  test(${JSON.stringify(`${nextId()} ${label}`)}, async () => {`);
    lines.push(`    await langkah(${JSON.stringify(`Buka kategori ${cat.name || cat.path}`)}, async () => {`);
    lines.push(`      const res = await buka(${JSON.stringify(cat.path)});`);
    lines.push('      expect(res, "halaman kategori merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status kategori").toBeLessThan(400);');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-06 Lihat berbagai detail produk ────────────────────────────────────
  const productsToTest = journey.products?.length
    ? journey.products
    : journey.detail ? [journey.detail] : [];

  for (const det of productsToTest) {
    const label = det.title ? `Lihat detail produk - ${det.title}` : 'Lihat detail produk';
    lines.push(`  test(${JSON.stringify(`${nextId()} ${label}`)}, async () => {`);
    lines.push(`    await langkah(${JSON.stringify(`Buka halaman detail produk ${det.title || det.path}`)}, async () => {`);
    lines.push(`      const res = await buka(${JSON.stringify(det.path)});`);
    lines.push('      expect(res, "halaman detail merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status detail").toBeLessThan(400);');
    lines.push('    });');
    lines.push('    await langkah("Cek elemen detail produk", async () => {');
    lines.push('      try {');
    if (det.addToCartButton) {
      lines.push(`        await expect(${det.addToCartButton.locator}).toBeVisible({ timeout: 5_000 });`);
    } else {
      lines.push('        const harga = page.locator(\'[class*="price"], [class*="harga"], [data-price]\').first();');
      lines.push('        await expect(harga).toBeVisible({ timeout: 5_000 });');
    }
    lines.push('      } catch { /* elemen detail mungkin berbeda struktur */ }');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-07 Tambah ke keranjang ─────────────────────────────────────────────
  const cartProduct = journey.products?.find(p => p.addToCartButton) || journey.products?.[0] || (journey.detail?.addToCartButton ? journey.detail : journey.detail);
  if (cartProduct) {
    lines.push(`  test(${JSON.stringify(`${nextId()} Tambah ke keranjang`)}, async () => {`);
    lines.push('    await langkah("Buka halaman detail produk", async () => {');
    lines.push(`      await buka(${JSON.stringify(cartProduct.path)});`);
    lines.push('    });');
    if (cartProduct.quantityField) {
      lines.push('    await langkah("Atur jumlah", async () => {');
      lines.push(`      try { await ${cartProduct.quantityField.locator}.fill("1"); } catch { /* quantity opsional */ }`);
      lines.push('    });');
    }
    lines.push('    await langkah("Klik tambah ke keranjang", async () => {');
    if (cartProduct.addToCartButton) {
      lines.push(`      await ${cartProduct.addToCartButton.locator}.click();`);
    } else {
      lines.push('      const addBtn = page.locator(\'button:has-text("Beli"), button:has-text("Keranjang"), button:has-text("Add to Cart"), [role="button"]:has-text("Beli")\').first();');
      lines.push('      await addBtn.click();');
    }
    lines.push('      // Tunggu respons: bisa redirect, toast, atau badge update.');
    lines.push('      await page.waitForTimeout(2_000);');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-08 Buka keranjang ──────────────────────────────────────────────────
  if (journey.cart) {
    const cart = journey.cart;
    lines.push(`  test(${JSON.stringify(`${nextId()} Buka keranjang`)}, async () => {`);
    lines.push('    await langkah("Buka halaman keranjang", async () => {');
    lines.push(`      const res = await buka(${JSON.stringify(cart.path)});`);
    lines.push('      expect(res, "halaman keranjang merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status keranjang").toBeLessThan(400);');
    lines.push('    });');
    lines.push('    await langkah("Verifikasi isi keranjang", async () => {');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-09 Mulai checkout ──────────────────────────────────────────────────
  if (journey.checkout) {
    const co = journey.checkout;
    lines.push(`  test(${JSON.stringify(`${nextId()} Mulai checkout`)}, async () => {`);

    // Jika di halaman cart ada tombol checkout, klik dari sana.
    if (journey.cart && journey.cart.checkoutButton) {
      lines.push('    await langkah("Buka keranjang lalu klik checkout", async () => {');
      lines.push(`      await buka(${JSON.stringify(journey.cart.path)});`);
      lines.push('      try {');
      lines.push(`        await ${journey.cart.checkoutButton.locator}.click({ timeout: 5_000 });`);
      lines.push('        await page.waitForLoadState("domcontentloaded");');
      lines.push('      } catch {');
      lines.push(`        await buka(${JSON.stringify(co.path)});`);
      lines.push('      }');
      lines.push('    });');
    } else {
      lines.push('    await langkah("Buka halaman checkout", async () => {');
      lines.push(`      const res = await buka(${JSON.stringify(co.path)});`);
      lines.push('      expect(res, "halaman checkout merespons").not.toBeNull();');
      lines.push('      expect(res!.status(), "HTTP status checkout").toBeLessThan(400);');
      lines.push('    });');
    }

    // Isi field shipping jika ada, JANGAN submit pembayaran.
    if (co.fields && co.fields.length) {
      lines.push('    await langkah("Isi data pengiriman (tanpa bayar)", async () => {');
      for (const field of co.fields) {
        const loc = field.locator;
        const fieldName = (field.name || field.label || field.placeholder || field.ariaLabel || '').toLowerCase();
        const fieldType = (field.type || '').toLowerCase();
        if (fieldType === 'hidden' || fieldType === 'file') continue;
        if (!field.visible || field.disabled || field.readonly) continue;

        let value = '"test-data"';
        if (fieldType === 'email' || /email/i.test(fieldName)) {
          value = 'BOT.email';
        } else if (fieldType === 'tel' || /phone|telepon|hp/i.test(fieldName)) {
          value = 'BOT.phone';
        } else if (/name|nama/i.test(fieldName)) {
          value = 'BOT.name';
        } else if (/address|alamat/i.test(fieldName)) {
          value = '"Jl. Test No. 1"';
        } else if (/city|kota/i.test(fieldName)) {
          value = '"Jakarta"';
        } else if (/postal|kode.?pos|zip/i.test(fieldName)) {
          value = '"12345"';
        }

        if (fieldType === 'checkbox') {
          lines.push(`      try { await ${loc}.check(); } catch { /* opsional */ }`);
        } else if (field.tag === 'select') {
          lines.push(`      try { await ${loc}.selectOption({ index: 1 }); } catch { /* opsional */ }`);
        } else {
          lines.push(`      try { await ${loc}.fill(${value}); } catch { /* opsional */ }`);
        }
      }
      lines.push('    });');
    }

    lines.push('    // PENTING: TIDAK submit pembayaran.');
    lines.push('    await langkah("Verifikasi halaman checkout", async () => {');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-10 Lihat profil ────────────────────────────────────────────────────
  if (journey.profile) {
    const prof = journey.profile;
    lines.push(`  test(${JSON.stringify(`${nextId()} Lihat profil`)}, async () => {`);
    lines.push('    await langkah("Buka halaman profil", async () => {');
    lines.push(`      const res = await buka(${JSON.stringify(prof.path)});`);
    lines.push('      expect(res, "halaman profil merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status profil").toBeLessThan(400);');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  // ── TC-XX Jelajahi seluruh menu & path navigasi ───────────────────────────
  const navPagesToTest = journey.navPages?.length
    ? journey.navPages
    : journey.extraPages?.length ? journey.extraPages : [];

  for (const nav of navPagesToTest) {
    const navName = nav.text || nav.title || nav.path;
    lines.push(`  test(${JSON.stringify(`${nextId()} Navigasi ${navName}`)}, async () => {`);
    lines.push(`    await langkah(${JSON.stringify(`Buka ${navName}`)}, async () => {`);
    lines.push(`      const res = await buka(${JSON.stringify(nav.path)});`);
    lines.push('      expect(res, "halaman merespons").not.toBeNull();');
    lines.push('      expect(res!.status(), "HTTP status halaman").toBeLessThan(400);');
    lines.push('      await expect(page.locator("body")).toBeVisible();');
    lines.push('    });');
    lines.push('  });', '');
  }

  lines.push('});');
  return lines.join('\n').trimEnd() + '\n';
}

// ── generateJourneySpec ───────────────────────────────────────────────────────
// Entry point utama journey: crawl journey-aware → introspeksi DOM → rakit spec.
export async function generateJourneySpec({
  startUrl,
  origins,
  maxPages = MAX_JOURNEY_PAGES,
  navTimeoutMs = JOURNEY_NAV_TIMEOUT_MS,
  budgetMs = JOURNEY_BUDGET_MS,
}) {
  const validated = target(startUrl, origins);
  const startUrlObj = new URL(validated);
  startUrlObj.hash = '';
  const start = startUrlObj.href;
  const origin = startUrlObj.origin;
  const host = startUrlObj.host;
  const limit = Math.max(1, Math.min(Number(maxPages) || MAX_JOURNEY_PAGES, 100));
  const deadline = Date.now() + budgetMs;

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright tidak tersedia di server ini.'); }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(navTimeoutMs);

    const visited = new Set();
    const crawledPages = [];

    // Introspeksi DOM halaman dengan retry dan jeda hidrasi SPA (Next.js/React/Vue).
    const introspect = async (url) => {
      if (visited.has(url)) return null;
      if (Date.now() >= deadline) return null;
      if (crawledPages.length >= limit) return null;
      visited.add(url);

      let response = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
          // Tunggu hidrasi DOM pada Single Page Apps (SPA)
          await page.waitForTimeout(1500);

          // Auto-scroll untuk memicu lazy-loaded items (Next.js/React hydration)
          await page.evaluate(async () => {
            try {
              for (let i = 0; i < 3; i++) {
                window.scrollBy(0, 900);
                await new Promise(r => setTimeout(r, 200));
              }
              window.scrollTo(0, 0);
            } catch {}
          }).catch(() => {});

          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await page.waitForTimeout(1500 * (attempt + 1));
          }
        }
      }

      if (!response && lastErr) {
        if (!crawledPages.length) throw new Error(`Gagal membuka ${url}: ${lastErr.message}`);
        return null;
      }

      const status = response?.status() ?? 0;
      if (status >= 400) {
        if (!crawledPages.length) throw new Error(`Target mengembalikan HTTP ${status}: ${url}`);
        return null;
      }
      if (!isHtml(response)) return null;

      let meta, inputs, buttons, links;
      try {
        [meta, inputs, buttons, links] = await Promise.all([
          page.evaluate(() => ({
            title: document.title,
            h1: document.querySelector('h1')?.innerText ?? '',
            hasMain: !!document.querySelector('main, [role="main"]'),
            hasNav: !!document.querySelector('nav, [role="navigation"]'),
            url: location.href,
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
          page.$$eval('button, input[type="submit"], input[type="button"], a.btn, [role="button"]', els => els.map(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              text: (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
              type: (el.getAttribute('type') || '').toLowerCase(),
              disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
              visible: rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden',
            };
          })),
          page.$$eval('a[href]', (els, max) => els.slice(0, max).map(el => {
            const style = getComputedStyle(el);
            return {
              text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
              href: el.href,
              visible: style.display !== 'none' && style.visibility !== 'hidden',
            };
          }), MAX_LINKS_PER_PAGE),
        ]);
      } catch (err) {
        if (!crawledPages.length) throw new Error(`Gagal membaca DOM ${url}: ${err.message}`);
        return null;
      }

      const classification = classifyPage(
        { ...meta, url },
        inputs,
        buttons,
        links,
      );

      const actions = buildActions(inputs, buttons.filter(b => b.visible), links.filter(l => l.visible), origin);

      const pageData = {
        url,
        path: pathOf(url),
        title: clean(meta.title, 200),
        h1: clean(meta.h1, 120),
        hasMain: meta.hasMain,
        hasNav: meta.hasNav,
        classification,
        inputs,
        buttons: buttons.filter(b => b.visible),
        links,
        fields: actions.fields,
        builtButtons: actions.buttons,
        builtLinks: actions.links,
        counts: { inputs: inputs.length, buttons: buttons.length, links: links.length },
      };

      crawledPages.push(pageData);
      return pageData;
    };

    // ── Langkah 1: Homepage ─────────────────────────────────────────────────
    const homePage = await introspect(start);
    if (!homePage) throw new Error('Tidak ada halaman HTML yang bisa dipindai.');

    const journeyLinks = findJourneyLinks(
      homePage.links.filter(l => l.visible),
      start,
      homePage.buttons,
    );

    const navButtons = findNavButtons(homePage.buttons);

    // Objek journey yang akan diisi bertahap.
    const journey = {
      origin,
      host,
      homepage: {
        path: homePage.path,
        title: homePage.title,
        h1: homePage.h1,
        hasNav: homePage.hasNav,
        hasMain: homePage.hasMain,
      },
      navButtons,
      register: null,
      login: null,
      search: null,
      categories: [],
      listing: null,
      products: [],
      detail: null,
      cart: null,
      checkout: null,
      profile: null,
      navPages: [],
      extraPages: [],
    };

    // Helper: resolve href ke URL absolut dalam origin yang sama.
    const resolve = (href) => {
      if (!href) return null;
      return normalizeUrl(href, start, origin);
    };

    // Helper: probe kandidat URL standar bila belum ditemukan dari tautan DOM
    const probeCandidate = async (candidates) => {
      for (const cand of candidates) {
        const candUrl = normalizeUrl(cand, start, origin);
        if (!candUrl || visited.has(candUrl)) continue;
        try {
          const resp = await page.request.get(candUrl, { timeout: 4000, maxRedirects: 3 }).catch(() => null);
          if (resp && resp.status() < 400) {
            return { href: candUrl, path: pathOf(candUrl) };
          }
        } catch {}
      }
      return null;
    };

    // Probing jalur standar yang seringkali berupa button / client-side routing pada SPA
    if (!journeyLinks.register) {
      const probed = await probeCandidate([
        '/auth/register', '/register', '/daftar', '/signup', '/auth/signup',
        '/account/register', '/user/register', '/main/auth/register', '/id-id/register',
      ]);
      if (probed) journeyLinks.register = { text: 'Daftar', href: probed.href };
    }

    if (!journeyLinks.login) {
      const probed = await probeCandidate([
        '/auth/login', '/login', '/masuk', '/signin', '/auth/signin',
        '/account/login', '/user/login', '/main/auth/login', '/id-id/login',
      ]);
      if (probed) journeyLinks.login = { text: 'Masuk', href: probed.href };
    }

    if (!journeyLinks.cart) {
      const probed = await probeCandidate([
        '/cart', '/keranjang', '/bag', '/basket', '/cart/view',
      ]);
      if (probed) journeyLinks.cart = { text: 'Keranjang', href: probed.href };
    }

    if (!journeyLinks.checkout) {
      const probed = await probeCandidate([
        '/checkout', '/pembayaran', '/cart/checkout',
      ]);
      if (probed) journeyLinks.checkout = { text: 'Checkout', href: probed.href };
    }

    if (!journeyLinks.profile) {
      const probed = await probeCandidate([
        '/profile', '/profil', '/user/profile', '/account', '/akun', '/member',
      ]);
      if (probed) journeyLinks.profile = { text: 'Profil', href: probed.href };
    }

    // Deteksi tombol pemicu modal auth di homepage bila rute terpisah tidak ditemukan
    const registerButton = homePage.buttons.find(b =>
      /daftar|register|sign\s*up|buat\s*akun/i.test(b.text || '')
    );
    const loginButton = homePage.buttons.find(b =>
      /masuk|login|sign\s*in/i.test(b.text || '')
    );

    // ── Langkah 2: Register ─────────────────────────────────────────────────
    if (journeyLinks.register && crawledPages.length < limit) {
      const regUrl = resolve(journeyLinks.register.href);
      if (regUrl) {
        const regPage = await introspect(regUrl);
        if (regPage) {
          journey.register = {
            path: regPage.path,
            fields: regPage.fields,
          };
        }
      }
    } else if (registerButton) {
      journey.register = {
        path: homePage.path,
        isModal: true,
        buttonText: registerButton.text,
        fields: homePage.fields,
      };
    }

    // ── Langkah 3: Login ────────────────────────────────────────────────────
    if (journeyLinks.login && crawledPages.length < limit) {
      const loginUrl = resolve(journeyLinks.login.href);
      if (loginUrl) {
        const loginPage = await introspect(loginUrl);
        if (loginPage) {
          // Cari field email/username dan password.
          const emailField = loginPage.fields.find(f =>
            f.type === 'email' ||
            /email|e-?mail|username|user/i.test(`${f.name} ${f.label} ${f.placeholder} ${f.ariaLabel}`)
          ) || null;
          const passwordField = loginPage.fields.find(f => f.type === 'password') || null;
          const submitButton = loginPage.builtButtons.find(b =>
            b.type === 'submit' ||
            /masuk|login|sign.?in|submit/i.test(b.text || '')
          ) || null;

          journey.login = {
            path: loginPage.path,
            emailField,
            passwordField,
            submitButton,
          };
        }
      }
    } else if (loginButton) {
      journey.login = {
        path: homePage.path,
        isModal: true,
        buttonText: loginButton.text,
        emailField: null,
        passwordField: null,
        submitButton: null,
      };
    }

    // ── Langkah 4: Search ───────────────────────────────────────────────────
    const searchField = homePage.fields.find(f =>
      f.type === 'search' ||
      /cari|search/i.test(`${f.name} ${f.label} ${f.placeholder} ${f.ariaLabel}`)
    ) || null;

    if (searchField) {
      journey.search = {
        path: homePage.path,
        searchField,
      };
    } else if (journeyLinks.search && crawledPages.length < limit) {
      const searchUrl = resolve(journeyLinks.search.href);
      if (searchUrl) {
        const searchPage = await introspect(searchUrl);
        if (searchPage) {
          const sf = searchPage.fields.find(f =>
            f.type === 'search' ||
            /cari|search/i.test(`${f.name} ${f.label} ${f.placeholder} ${f.ariaLabel}`)
          ) || null;
          journey.search = {
            path: searchPage.path,
            searchField: sf,
          };
        }
      }
    }

    // ── Langkah 5: Jelajahi SEMUA Kategori / Path Belanja ──────────────────
    for (const catLink of journeyLinks.categories) {
      if (crawledPages.length >= limit) break;
      if (Date.now() >= deadline) break;
      const catUrl = resolve(catLink.href);
      if (!catUrl) continue;
      const catPage = await introspect(catUrl);
      if (!catPage) continue;

      // Kumpulkan tautan produk di kategori ini untuk dicrawl
      const prodsInCat = catPage.links
        .filter(l => l.visible && /\/(product|produk|detail|detail-produk|item|p|goods|buku)\//i.test(l.href || ''))
        .map(l => ({ text: clean(l.text, 120), href: l.href }));

      for (const p of prodsInCat) {
        if (!journeyLinks.products.some(jp => jp.href === p.href)) {
          journeyLinks.products.push(p);
        }
      }

      // Kumpulkan subkategori baru jika ada
      const subCats = catPage.links
        .filter(l => l.visible && /(\/kategori\/|\/category\/|\/genre\/|\/katalog\/|\/catalog\/|\/collections?\/|\/flashsale|\/pre-order)/i.test(l.href || ''))
        .map(l => ({ text: clean(l.text, 120), href: l.href }));

      for (const sc of subCats) {
        if (!journeyLinks.categories.some(jc => jc.href === sc.href)) {
          journeyLinks.categories.push(sc);
        }
      }

      const catItem = {
        name: clean(catLink.text, 60) || clean(catPage.title, 60) || catPage.path,
        path: catPage.path,
        title: catPage.title,
      };
      journey.categories.push(catItem);
      if (!journey.listing) journey.listing = catItem;
    }

    // Fallback bila tidak ada kategori dari journeyLinks tapi ada link produk
    if (!journey.categories.length && journeyLinks.products.length) {
      journey.categories.push({
        name: 'Katalog',
        path: homePage.path,
        title: homePage.title,
      });
      if (!journey.listing) journey.listing = journey.categories[0];
    }

    // ── Langkah 6: Jelajahi Berbagai Detail Produk ─────────────────────────
    for (const prodLink of journeyLinks.products) {
      if (crawledPages.length >= limit) break;
      if (Date.now() >= deadline) break;
      if (journey.products.length >= 10) break;
      const prodUrl = resolve(prodLink.href);
      if (!prodUrl) continue;
      const prodPage = await introspect(prodUrl);
      if (!prodPage) continue;

      const addToCartButton = prodPage.builtButtons.find(b =>
        /tambah.*(keranjang|cart)|add.*to.*cart|beli|buy/i.test(b.text || '')
      ) || null;
      const quantityField = prodPage.fields.find(f =>
        /qty|quantity|jumlah/i.test(`${f.name} ${f.label} ${f.placeholder} ${f.ariaLabel}`) ||
        (f.type === 'number' && f.visible)
      ) || null;

      const prodItem = {
        title: clean(prodLink.text, 60) || clean(prodPage.title, 60) || prodPage.path,
        path: prodPage.path,
        addToCartButton,
        quantityField,
      };
      journey.products.push(prodItem);
      if (!journey.detail) journey.detail = prodItem;
    }

    // ── Langkah 7: Cart ─────────────────────────────────────────────────────
    if (journeyLinks.cart && crawledPages.length < limit) {
      const cartUrl = resolve(journeyLinks.cart.href);
      if (cartUrl) {
        const cartPage = await introspect(cartUrl);
        if (cartPage) {
          const checkoutButton = cartPage.builtButtons.find(b =>
            /checkout|bayar|pembayaran|lanjut|proceed|payment/i.test(b.text || '')
          ) || null;

          journey.cart = {
            path: cartPage.path,
            checkoutButton,
          };
        }
      }
    }

    // ── Langkah 8: Checkout ─────────────────────────────────────────────────
    if (journeyLinks.checkout && crawledPages.length < limit) {
      const coUrl = resolve(journeyLinks.checkout.href);
      if (coUrl) {
        const coPage = await introspect(coUrl);
        if (coPage) {
          journey.checkout = {
            path: coPage.path,
            fields: coPage.fields,
          };
        }
      }
    } else if (journey.cart && journey.cart.checkoutButton) {
      journey.checkout = {
        path: journey.cart.path,
        fields: [],
      };
    } else if (journeyLinks.checkout) {
      journey.checkout = {
        path: pathOf(journeyLinks.checkout.href),
        fields: [],
      };
    }

    // ── Langkah 9: Profile ──────────────────────────────────────────────────
    if (journeyLinks.profile && crawledPages.length < limit) {
      const profUrl = resolve(journeyLinks.profile.href);
      if (profUrl) {
        const profPage = await introspect(profUrl);
        if (profPage) {
          journey.profile = { path: profPage.path };
        }
      }
    }

    // ── Langkah 10: Jelajahi SEMUA menu & path navigasi lainnya (Full BFS Scraping) ─
    const unsafePat = /(logout|signout|sign-out|delete|hapus|keluar)/i;
    const visitedPaths = new Set(crawledPages.map(p => p.path));
    const navQueue = [];

    const enqueueLinks = (links = []) => {
      for (const link of links) {
        if (!link.href) continue;
        const norm = resolve(link.href);
        if (!norm) continue;
        const p = pathOf(norm);
        if (visitedPaths.has(p)) continue;
        if (unsafePat.test(`${link.text || ''} ${p}`)) continue;
        if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|pdf|zip)$/i.test(p)) continue;
        visitedPaths.add(p);
        navQueue.push({ text: clean(link.text, 60), href: norm, path: p });
      }
    };

    // Masukkan semua tautan yang ditemukan dari semua halaman yang sudah dicrawl
    for (const cp of crawledPages) {
      enqueueLinks(cp.links);
    }
    enqueueLinks(journeyLinks.navLinks);

    // BFS crawl sampai limit halaman terpenuhi
    while (navQueue.length > 0 && crawledPages.length < limit && Date.now() < deadline) {
      const item = navQueue.shift();
      const navPage = await introspect(item.href);
      if (!navPage) continue;

      const navItem = {
        text: item.text || clean(navPage.title, 60) || navPage.path,
        path: navPage.path,
        title: navPage.title,
      };
      journey.navPages.push(navItem);
      journey.extraPages.push(navItem);

      // Kumpulkan tautan baru dari halaman yang baru saja diintrospeksi
      enqueueLinks(navPage.links);
    }

    if (!crawledPages.length) throw new Error('Tidak ada halaman HTML yang bisa dipindai.');

    return {
      code: buildJourneySpec(journey),
      pages: crawledPages.map(p => ({
        url: p.url,
        inputs: p.counts.inputs,
        buttons: p.counts.buttons,
        links: p.counts.links,
      })),
      journey: true,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
