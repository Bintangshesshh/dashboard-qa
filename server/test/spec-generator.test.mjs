// Test murni generator spec: normalisasi URL, locator, aksi DOM, dan perakitan
// string. Tidak membuka browser; bagian crawl diuji manual lewat fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActions, buildButtons, buildFields, buildLinks, buildSpec, buttonLocator,
  generateSpec, idSelector, inputLocator, normalizeUrl,
} from '../spec-generator.mjs';

const ORIGIN = 'http://127.0.0.1:4173';

test('normalizeUrl: origin sama, hash dibuang, skema lain ditolak', () => {
  assert.equal(normalizeUrl('/login#form', ORIGIN + '/', ORIGIN), ORIGIN + '/login');
  assert.equal(normalizeUrl(ORIGIN + '/a?x=1#y', ORIGIN, ORIGIN), ORIGIN + '/a?x=1');
  assert.equal(normalizeUrl('https://evil.test/', ORIGIN, ORIGIN), null);
  assert.equal(normalizeUrl('mailto:qa@example.test', ORIGIN, ORIGIN), null);
  assert.equal(normalizeUrl('javascript:alert(1)', ORIGIN, ORIGIN), null);
  assert.equal(normalizeUrl('http://user:pass@127.0.0.1:4173/', ORIGIN, ORIGIN), null);
  assert.equal(normalizeUrl('http://', ORIGIN, ORIGIN), null);
});

test('idSelector: identifier aman pakai #, selain itu attribute selector', () => {
  assert.equal(idSelector('email'), '#email');
  assert.equal(idSelector('user-email_2'), '#user-email_2');
  assert.equal(idSelector('user:email'), '[id="user:email"]');
  assert.equal(idSelector('2fa'), '[id="2fa"]');
  assert.equal(idSelector('a"b'), '[id="a\\"b"]');
});

test('inputLocator: id -> name -> type fallback, nilai di-escape', () => {
  assert.equal(inputLocator({ id: 'email', name: 'email' }, 1), '#email');
  assert.equal(inputLocator({ name: 'user"name' }, 1), 'input[name="user\\"name"]');
  assert.equal(inputLocator({ type: 'text' }, 1), 'input[type="text"]');
  assert.equal(inputLocator({ type: 'text' }, 2), ':nth-match(input[type="text"], 2)');
  // type kosong dianggap text, sama seperti default DOM.
  assert.equal(inputLocator({}, 1), 'input[type="text"]');
});

test('buttonLocator: id -> teks -> fallback tag', () => {
  assert.equal(buttonLocator({ id: 'go', tag: 'button', text: 'Go' }, 1), '#go');
  assert.equal(buttonLocator({ tag: 'button', text: 'Save' }, 1), 'button:has-text("Save")');
  assert.equal(buttonLocator({ tag: 'a', text: 'Next' }, 1), 'a.btn:has-text("Next")');
  assert.equal(buttonLocator({ tag: 'button', text: '' }, 2), ':nth-match(button, 2)');
});

test('buildFields: locator role/label/placeholder dan aksi sesuai tipe input', () => {
  const fields = buildFields([
    { tag: 'input', type: 'search', placeholder: 'Cari buku', visible: true },
    { tag: 'input', type: 'email', label: 'Email', visible: true },
    { tag: 'input', type: 'checkbox', name: 'ingat', visible: true },
    { tag: 'input', type: 'hidden', name: 'csrf' },
    { tag: 'input', type: 'file', name: 'gambar', visible: true },
    { tag: 'input', type: 'submit', name: 'kirim', visible: true },
    { tag: 'textarea', name: 'catatan', visible: true },
    { tag: 'select', name: 'kota', visible: true, options: 3 },
  ]);

  assert.equal(fields[0].locator, 'page.getByPlaceholder("Cari buku", { exact: true })');
  assert.deepEqual(fields[0].action, {
    kind: 'fill', locator: fields[0].locator, value: 'test-data',
  });
  assert.equal(fields[1].locator, 'page.getByLabel("Email", { exact: true })');
  assert.equal(fields[2].action.kind, 'check');
  assert.equal(fields[3].action.kind, 'attached');
  assert.equal(fields[4].action.kind, 'attached');
  assert.equal(fields[5].action.kind, 'visibleEnabled');
  assert.equal(fields[6].action.kind, 'fill');
  assert.equal(fields[7].action.kind, 'select');
});

test('buildFields: nilai uji mengikuti tipe input', () => {
  const [email, number, date] = buildFields([
    { tag: 'input', type: 'email', name: 'email', visible: true },
    { tag: 'input', type: 'number', name: 'umur', visible: true },
    { tag: 'input', type: 'date', name: 'tanggal', visible: true },
  ]);
  assert.equal(email.action.value, 'test-data@example.test');
  assert.equal(number.action.value, '1');
  assert.equal(date.action.value, '2026-01-01');
});

test('buildFields: locator dasar yang sama diberi nth agar tidak bentrok', () => {
  const fields = buildFields([
    { tag: 'input', type: 'text', name: 'kata', visible: true },
    { tag: 'input', type: 'text', name: 'kata', visible: true },
  ]);
  assert.equal(fields[0].locator, 'page.locator("input[name=\\"kata\\"]").nth(0)');
  assert.equal(fields[1].locator, 'page.locator("input[name=\\"kata\\"]").nth(1)');
});

test('buildButtons: role button/link, teks duplikat diberi nth, disabled dicek', () => {
  const buttons = buildButtons([
    { tag: 'button', text: 'Masuk', visible: true },
    { tag: 'button', text: 'Masuk', visible: true },
    { tag: 'button', text: 'Hapus', visible: true, disabled: true },
    { tag: 'a', text: 'Lanjut', visible: true },
    { tag: 'button', text: '', visible: false },
  ]);

  assert.equal(buttons[0].locator, 'page.getByRole("button", { name: "Masuk", exact: true }).nth(0)');
  assert.equal(buttons[1].locator, 'page.getByRole("button", { name: "Masuk", exact: true }).nth(1)');
  assert.equal(buttons[2].action.kind, 'visibleDisabled');
  assert.equal(buttons[3].locator, 'page.getByRole("link", { name: "Lanjut", exact: true })');
  assert.equal(buttons[4].action.kind, 'attached');
});

test('buildLinks: hanya origin sama, tautan berbahaya dilewati, maksimal 3', () => {
  const links = buildLinks([
    { text: 'Tentang', href: ORIGIN + '/tentang', visible: true },
    { text: 'Tentang', href: ORIGIN + '/tentang', visible: true }, // href duplikat
    { text: 'Logout', href: ORIGIN + '/logout', visible: true },
    { text: 'Checkout', href: ORIGIN + '/checkout', visible: true },
    { text: 'Eksternal', href: 'https://evil.test/', visible: true },
    { text: 'Kontak', href: ORIGIN + '/kontak', visible: true },
    { text: 'Bantuan', href: ORIGIN + '/bantuan', visible: true },
    { text: 'Katalog', href: ORIGIN + '/katalog', visible: true },
  ], ORIGIN);

  assert.deepEqual(links.map(l => l.text), ['Tentang', 'Kontak', 'Bantuan']);
  assert.equal(links[0].locator, 'page.getByRole("link", { name: "Tentang", exact: true }).first()');
});

test('buildActions: merangkum field, tombol, dan tautan satu halaman', () => {
  const actions = buildActions(
    [{ tag: 'input', type: 'text', name: 'q', visible: true }],
    [{ tag: 'button', text: 'Cari', visible: true }],
    [{ text: 'Tentang', href: ORIGIN + '/tentang', visible: true }],
    ORIGIN,
  );
  assert.equal(actions.fields.length, 1);
  assert.equal(actions.buttons.length, 1);
  assert.equal(actions.links.length, 1);
});

test('buildSpec: file valid, assertion nyata, BASE_URL, dan escaping aman', () => {
  const page = {
    url: 'https://contoh.test/?q="x"',
    title: 'Judul "Contoh"',
    h1: 'Beranda',
    hasMain: true,
    hasNav: false,
    fields: buildFields([
      { tag: 'input', type: 'email', label: 'Email', visible: true },
      { tag: 'input', type: 'checkbox', name: 'ingat', visible: true },
    ]),
    buttons: buildButtons([{ tag: 'button', text: 'Masuk', visible: true }]),
    links: buildLinks([{ text: 'Tentang', href: 'https://contoh.test/tentang', visible: true }], 'https://contoh.test'),
  };
  const code = buildSpec([page]);

  assert.match(code, /^import \{ test, expect, type Page \} from "@playwright\/test";\n/);
  assert.ok(code.includes('const BASE = (process.env.BASE_URL || "https://contoh.test").replace(/\\/+$/, "");'));
  assert.ok(code.includes('test.describe("Auto-generated QA - contoh.test"'));
  assert.ok(code.includes('await expect(page).toHaveTitle("Judul \\"Contoh\\"");'));
  assert.ok(code.includes('await expect(page.getByRole("heading", { name: "Beranda", exact: true }).first()).toBeVisible();'));
  assert.ok(code.includes('await expect(page.getByRole("main").first()).toBeVisible();'));
  assert.ok(code.includes('const input1 = page.getByLabel("Email", { exact: true });'));
  assert.ok(code.includes('await input1.fill("test-data@example.test");'));
  assert.ok(code.includes('await expect(input1).toHaveValue("test-data@example.test");'));
  assert.ok(code.includes('await input2.check();'));
  assert.ok(code.includes('await expect(input2).toBeChecked();'));
  assert.ok(code.includes('await expect(tombol1).toBeEnabled();'));
  assert.ok(code.includes('const tautan = page.getByRole("link", { name: "Tentang", exact: true }).first();'));
  assert.ok(code.includes('const res = await page.goto(new URL(href!, page.url()).href'));
  // Satu test pembuka, satu form, satu tombol, satu tautan.
  assert.equal(code.match(/^  test\(/gm)?.length, 4);
});

test('buildSpec: tanpa halaman tetap menghasilkan file yang valid', () => {
  const code = buildSpec([]);
  assert.equal(code, "import { test, expect } from '@playwright/test';\n");
});

test('generateSpec menolak origin di luar allowlist sebelum membuka browser', async () => {
  await assert.rejects(
    () => generateSpec({ startUrl: 'https://evil.test/', origins: [ORIGIN] }),
    /belum diizinkan/,
  );
});
