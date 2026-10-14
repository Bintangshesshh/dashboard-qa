import { test, expect } from "@playwright/test";
import { creds } from "./creds";

test.describe.serial("eurekabookhouse", () => {
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterEach(async ({}, testInfo) => {
    const shot = await page.screenshot({ fullPage: true }).catch(() => null);
    if (shot) {
      await testInfo.attach(`ss-${testInfo.title}`, {
        body: shot,
        contentType: "image/png",
      });
    }
  });

  test.afterAll(async () => {
    await page.close();
  });

  const buka = async (url: string) => {
    let err: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        return;
      } catch (e) {
        err = e;
        await page.waitForTimeout(5000 * (i + 1));
      }
    }
    throw err;
  };

  // TC 1 Login
  test("TC-E01 login", async () => {
    await buka("https://eurekabookhouse.com/auth/login");
    const email = creds("EUREKABOOKHOUSE_EMAIL");
    const password = creds("EUREKABOOKHOUSE_PASSWORD");

    // Tunggu 15 detik sampe siap
    await page.waitForTimeout(15000);

    await page.getByRole("textbox", { name: "namaanda@email.com" }).fill(email);
    await page.getByRole("textbox", { name: "........." }).fill(password);

    const resP = page.waitForResponse((r) => /customer\/login/.test(r.url()), {
      timeout: 45000,
    });
    await page.getByRole("button", { name: "Masuk Sekarang" }).click();

    // Bukti login berhasil
    const res = await resP;
    expect(res.ok()).toBe(true);

    // Login sukses memunculkan swal, konfirmasi dulu supaya halaman navigate.
    await page
      .locator(".swal2-confirm")
      .first()
      .click({ timeout: 20000 })
      .catch(() => {});

    // Bukti udah ga di page login lagi
    await expect(page).not.toHaveURL(/auth\/login/i, { timeout: 30000 });
  });

  // TC 2 Search
  test("TC-E02 search-buku-TKA", async () => {
    await page
      .getByRole("textbox", { name: "Cari judul buku, atau penulis" })
      .fill("TKA");

    const produk = page
      .getByRole("link", { name: "ERLANGGA - SIAGA PLUS TKA SD/MI 2027" })
      .first();
    await expect(produk).toBeVisible({ timeout: 30000 });
    const href = (await produk.getAttribute("href"))!;
    await page.goto(new URL(href, page.url()).href, {
      waitUntil: "domcontentloaded",
    });
  });

  // TC 3 Checkout
  test("TC-E03 checkout-beli-sekarang", async () => {
    // Nyari buku
    await expect(
      page.getByRole("heading", {
        name: "ERLANGGA - SIAGA PLUS TKA SD/MI 2027",
      }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "BELI SEKARANG" }).click();

    // Bukti buku udah ke cekout
    await expect(
      page.getByRole("button", { name: "Checkout (1)" }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Checkout (1)" }).click();
  });

  // TC 4 Masukin alamat
  test("TC-E04 masuk-alamat", async () => {
    await page.getByRole("button", { name: "Tambah Alamat" }).click();
    await page
      .getByRole("button", { name: "Tambah Alamat Pengiriman Lain" })
      .click();
    await page.getByRole("textbox", { name: "Nama Depan" }).fill("testing");
    await page.getByRole("textbox", { name: "Nama Belakang" }).fill("testing");
    await page.getByRole("textbox", { name: "Telepon" }).fill("081234567890");
    await page
      .getByRole("textbox", { name: "Nama Jalan, No Rumah, RT/RW" })
      .fill("testing");
    await page.getByRole("combobox").first().selectOption("Bali");
    await page.getByRole("combobox").nth(1).selectOption("Tabanan");
    await page.getByRole("combobox").nth(2).selectOption("6179");
    await page.getByRole("button", { name: "+ Tambah Alamat" }).click();
    // Bukti alamat kesimpen
    await expect(page.getByRole("dialog", { name: "Berhasil!" })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "OK" }).click();
  });

  // TC 5 Pembayaran
  // jeda bentar biar alamatnya masuk dulu baru klik buttonnya kalo ga gitu akan muncul popup yang tidak terdeteksi alamatnya akibat belom masuk ke payment
  test("TC-E05 lanjut-ke-pembayaran", async () => {
    await page.waitForTimeout(2000);
    await page
      .getByRole("button", { name: "Lanjut ke Pembayaran" })
      .click({ timeout: 15000 });

    // Bukti nyampe menu pembayaran
    await expect(
      page.getByRole("button", { name: "Batalkan Pesanan" }),
    ).toBeVisible({ timeout: 30000 });
  });

  // TC 6 Batalin orderan
  test("TC-E06 cancel-order", async () => {
    await page.getByRole("button", { name: "Batalkan Pesanan" }).click();
    await page.getByRole("button", { name: "Ya, Batalkan" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    // Bukti pesanan gagal
  });

  // TC 7 Hapus alamat
  test("TC-E07 hapus-alamat", async () => {
    await page
      .getByRole("listitem")
      .filter({ hasText: "Alamat Kirim" })
      .click();
    await page.getByRole("button", { name: "Hapus Alamat" }).first().click();
    await page.getByRole("button", { name: "Ya, Hapus" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    // Bukti alamat kehapus
    await expect(
      page.getByRole("button", { name: "Hapus Alamat" }),
    ).toHaveCount(0);
  });

  // TC 8 Logout
  test("TC-E08 logout", async () => {
    // Menu akun ada di kanan atas (dropdown "Akun Saya").
    await page.getByRole("button", { name: "Akun Saya" }).click();

    // Bukti buat keluar akun
    const keluar = page.getByRole("button", { name: "Keluar" });
    await expect(keluar).toBeVisible({ timeout: 10000 });
    await keluar.click();

    await expect(
      page.getByRole("heading", { name: "Keluar Akun?" }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Keluar akun
    await page.getByRole("button", { name: "Ya, Keluar" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    // Bukti buat udah nyampe di login page lagi
    await expect(page).toHaveURL(/auth\/login/i, { timeout: 30000 });
  });
});
