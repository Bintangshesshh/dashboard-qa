// Test murni generator spec: normalisasi URL, locator, aksi DOM, dan perakitan
// string. Tidak membuka browser; bagian crawl diuji manual lewat fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActions, buildButtons, buildFields, buildLinks, buildSpec, buttonLocator,
  generateSpec, idSelector, inputLocator, normalizeUrl,
  classifyPage, findJourneyLinks, buildJourneySpec, generateJourneySpec,
} from '../spec-generator.mjs';

const ORIGIN = 'http://127.0.0.1:4173';

test('normalizeUrl: origin sama, hash dibuang, skema lain ditolak', () => {
  assert.equal(normalizeUrl('/login#form', ORIGIN + '/', ORIGIN), ORIGIN + '/login');
  assert.equal(normalizeUrl(ORIGIN + '/a?x=1#y', ORIGIN, ORIGIN), ORIGIN + '/a?x=1');
  assert.equal(normalizeUrl(ORIGIN + '/page?_rsc=abc123xyz', ORIGIN, ORIGIN), ORIGIN + '/page');
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
  // Checkpoint debug: pause/step dari dashboard tanpa mengubah spec manual.
  assert.ok(code.includes('const jeda = async (label: string) => {'));
  assert.ok(code.includes('await langkah("Isi Email", async () => {'));
  assert.ok(code.includes('await langkah("Centang ingat", async () => {'));
  assert.ok(code.includes('await langkah("Tombol Masuk", async () => {'));
  assert.match(code, /await langkah\("Buka \/\?q=/, 'langkah buka memakai label halaman');
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

test('classifyPage: klasifikasi akurat berdasarkan URL, metadata, input, dan tombol', () => {
  // Login
  const loginMeta = { url: 'https://toko.test/masuk', title: 'Masuk ke Akun', h1: 'Login' };
  const loginInputs = [
    { type: 'email', name: 'email', placeholder: 'Email' },
    { type: 'password', name: 'password', placeholder: 'Kata sandi' },
  ];
  const loginButtons = [{ type: 'submit', text: 'Masuk' }];
  assert.equal(classifyPage(loginMeta, loginInputs, loginButtons, []).type, 'login');

  // Register
  const regMeta = { url: 'https://toko.test/daftar', title: 'Daftar Akun Baru', h1: 'Registrasi' };
  const regInputs = [
    { type: 'text', name: 'nama', placeholder: 'Nama Lengkap' },
    { type: 'email', name: 'email', placeholder: 'Email' },
    { type: 'password', name: 'password', placeholder: 'Password' },
  ];
  const regButtons = [{ type: 'submit', text: 'Daftar' }];
  assert.equal(classifyPage(regMeta, regInputs, regButtons, []).type, 'register');

  // Detail produk
  const detMeta = { url: 'https://toko.test/product/buku-tulis', title: 'Buku Tulis', h1: 'Buku Tulis' };
  const detButtons = [{ text: 'Tambah ke Keranjang', visible: true }];
  assert.equal(classifyPage(detMeta, [], detButtons, []).type, 'detail');

  // Cart
  const cartMeta = { url: 'https://toko.test/cart', title: 'Keranjang Belanja', h1: 'Keranjang' };
  const cartButtons = [{ text: 'Checkout', visible: true }];
  assert.equal(classifyPage(cartMeta, [], cartButtons, []).type, 'cart');

  // Checkout
  const coMeta = { url: 'https://toko.test/checkout', title: 'Pembayaran', h1: 'Checkout' };
  const coInputs = [{ type: 'text', name: 'address', label: 'Alamat Pengiriman' }];
  assert.equal(classifyPage(coMeta, coInputs, [], []).type, 'checkout');

  // Search
  const searchMeta = { url: 'https://toko.test/search', title: 'Pencarian' };
  const searchInputs = [{ type: 'search', name: 'q' }];
  assert.equal(classifyPage(searchMeta, searchInputs, [], []).type, 'search');

  // Listing
  const listMeta = { url: 'https://toko.test/kategori/buku', title: 'Kategori Buku' };
  const listLinks = [
    { href: '/product/1' },
    { href: '/product/2' },
    { href: '/product/3' },
  ];
  assert.equal(classifyPage(listMeta, [], [], listLinks).type, 'listing');
});

test('findJourneyLinks: mendeteksi tautan penting alur belanja', () => {
  const links = [
    { text: 'Masuk / Login', href: 'https://toko.test/login' },
    { text: 'Daftar Sekarang', href: 'https://toko.test/register' },
    { text: 'Keranjang (0)', href: 'https://toko.test/cart' },
    { text: 'Pencarian', href: 'https://toko.test/search' },
    { text: 'Kategori Buku', href: 'https://toko.test/kategori/buku' },
    { text: 'Buku A', href: 'https://toko.test/product/buku-a' },
    { text: 'Profil Saya', href: 'https://toko.test/account' },
    { text: 'Checkout Langsung', href: 'https://toko.test/checkout' },
  ];

  const found = findJourneyLinks(links, 'https://toko.test/');
  assert.equal(found.login?.href, 'https://toko.test/login');
  assert.equal(found.register?.href, 'https://toko.test/register');
  assert.equal(found.cart?.href, 'https://toko.test/cart');
  assert.equal(found.search?.href, 'https://toko.test/search');
  assert.equal(found.categories.length, 1);
  assert.equal(found.products.length, 1);
  assert.equal(found.profile?.href, 'https://toko.test/account');
  assert.equal(found.checkout?.href, 'https://toko.test/checkout');
});

test('buildJourneySpec: menyusun spec serial lengkap dengan kredensial BOT dan langkah', () => {
  const journey = {
    origin: 'https://toko.test',
    host: 'toko.test',
    homepage: { path: '/', title: 'Toko Online', hasNav: true },
    register: {
      path: '/register',
      fields: [
        { type: 'text', name: 'name', locator: 'page.getByLabel("Nama")', visible: true },
        { type: 'email', name: 'email', locator: 'page.getByLabel("Email")', visible: true },
        { type: 'password', name: 'password', locator: 'page.getByLabel("Password")', visible: true },
      ],
    },
    login: {
      path: '/login',
      emailField: { locator: 'page.getByLabel("Email")' },
      passwordField: { locator: 'page.getByLabel("Password")' },
      submitButton: { locator: 'page.getByRole("button", { name: "Masuk" })' },
    },
    search: {
      path: '/search',
      searchField: { locator: 'page.getByPlaceholder("Cari")' },
    },
    listing: { path: '/kategori/semua' },
    detail: {
      path: '/product/123',
      addToCartButton: { locator: 'page.getByRole("button", { name: "Tambah ke Keranjang" })' },
    },
    cart: {
      path: '/cart',
      checkoutButton: { locator: 'page.getByRole("button", { name: "Checkout" })' },
    },
    checkout: {
      path: '/checkout',
      fields: [
        { type: 'text', name: 'address', locator: 'page.getByLabel("Alamat")', visible: true },
      ],
    },
    profile: { path: '/profile' },
  };

  const code = buildJourneySpec(journey);

  assert.ok(code.includes('test.describe.serial("Journey lengkap - toko.test"'));
  assert.ok(code.includes('name: "QAbot"'));
  assert.ok(code.includes('password: "botplaywright123"'));
  assert.ok(code.includes('TC-01 Homepage terbuka'));
  assert.ok(code.includes('TC-02 Registrasi akun'));
  assert.ok(code.includes('TC-03 Login'));
  assert.ok(code.includes('TC-04 Cari produk'));
  assert.ok(code.includes('TC-05 Jelajah kategori'));
  assert.ok(code.includes('TC-06 Lihat detail produk'));
  assert.ok(code.includes('TC-07 Tambah ke keranjang'));
  assert.ok(code.includes('TC-08 Buka keranjang'));
  assert.ok(code.includes('TC-09 Mulai checkout'));
  assert.ok(code.includes('TC-10 Lihat profil'));
  // Memastikan tidak submit pembayaran
  assert.ok(code.includes('PENTING: TIDAK submit pembayaran'));
});

test('buildJourneySpec: menghasilkan alur komprehensif untuk banyak kategori, produk, dan navigasi BFS', () => {
  const journey = {
    origin: 'https://eurekabookhouse.com',
    host: 'eurekabookhouse.com',
    homepage: { path: '/', title: 'Eureka Bookhouse' },
    navButtons: [{ text: 'Kategori' }, { text: 'Genre' }],
    register: { path: '/auth/register', fields: [] },
    login: { path: '/auth/login', emailField: null, passwordField: null, submitButton: null },
    search: { path: '/', searchField: null },
    categories: [
      { name: 'Flash Sale', path: '/flashsale' },
      { name: 'Pre-Orders', path: '/pre-order' },
      { name: 'Buku Anak', path: '/Halaman/Kategori/buku-anak' },
      { name: 'Buku Pelajaran', path: '/Halaman/Kategori/buku-pelajaran' },
    ],
    products: [
      { title: 'Buku Parenting', path: '/detail-produk/parenting' },
      { title: 'Majalah Bobo', path: '/detail-produk/bobo' },
    ],
    cart: { path: '/cart', checkoutButton: null },
    checkout: { path: '/checkout', fields: [] },
    profile: { path: '/profile' },
    navPages: [
      { text: 'Store Location', path: '/Halaman/StoreLocation' },
      { text: 'Tentang Kami', path: '/tentang-kami' },
      { text: 'FAQ', path: '/faq' },
    ],
  };

  const code = buildJourneySpec(journey);

  assert.ok(code.includes('TC-01 Homepage terbuka'));
  assert.ok(code.includes('TC-02 Interaksi tombol navigasi - Kategori'));
  assert.ok(code.includes('TC-03 Interaksi tombol navigasi - Genre'));
  assert.ok(code.includes('TC-04 Registrasi akun'));
  assert.ok(code.includes('TC-05 Login'));
  assert.ok(code.includes('TC-06 Cari produk'));
  assert.ok(code.includes('TC-07 Jelajah kategori - Flash Sale'));
  assert.ok(code.includes('TC-08 Jelajah kategori - Pre-Orders'));
  assert.ok(code.includes('TC-09 Jelajah kategori - Buku Anak'));
  assert.ok(code.includes('TC-10 Jelajah kategori - Buku Pelajaran'));
  assert.ok(code.includes('TC-11 Lihat detail produk - Buku Parenting'));
  assert.ok(code.includes('TC-12 Lihat detail produk - Majalah Bobo'));
  assert.ok(code.includes('TC-13 Tambah ke keranjang'));
  assert.ok(code.includes('TC-14 Buka keranjang'));
  assert.ok(code.includes('TC-15 Mulai checkout'));
  assert.ok(code.includes('TC-16 Lihat profil'));
  assert.ok(code.includes('TC-17 Navigasi Store Location'));
  assert.ok(code.includes('TC-18 Navigasi Tentang Kami'));
  assert.ok(code.includes('TC-19 Navigasi FAQ'));
});

test('generateJourneySpec menolak origin di luar allowlist sebelum membuka browser', async () => {
  await assert.rejects(
    () => generateJourneySpec({ startUrl: 'https://evil.test/', origins: [ORIGIN] }),
    /belum diizinkan/,
  );
});
