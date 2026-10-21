import { test, expect } from "@playwright/test";
import { creds } from "./creds";

// Alur masdis sampai keranjang. Nggak ada checkout, nggak ada pembayaran.
test.describe.serial("masdis — sampai keranjang", () => {
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.setDefaultTimeout(60000);
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

  // Masdis suka munculin dialog SweetAlert ("Informasi") yang nutupin layar dan
  // makan klik. Tutup kalau ada, abaikan kalau nggak.
  const tutupDialog = () =>
    page.getByRole("button", { name: "OK" }).first().click({ timeout: 5000 }).catch(() => {});

  test("TC-MD-C1 homepage terbuka", async () => {
    await buka("https://masterdiskon.com/id-id");
    await expect(page).toHaveURL(/masterdiskon\.com/);
  });

  test("TC-MD-C2 login", async () => {
    await buka("https://masterdiskon.com/id-id/login");
    await page.waitForTimeout(5000);

    await page.getByRole("textbox", { name: "Email" }).fill(creds("MASTERDISKON_EMAIL"));
    await page.getByRole("textbox", { name: "Password" }).fill(creds("MASTERDISKON_PASSWORD"));
    await page.getByRole("button", { name: "Masuk" }).click();

    await expect(page).not.toHaveURL(/\/login/i, { timeout: 30000 });
  });

  test("TC-MD-C3 cari hotel", async () => {
    const cari = page.getByRole("textbox", { name: "Pencarian kota, hotel, tempat" });
    await cari.click();
    await cari.fill("bandung");
    // Tombol submit dicari di form yang sama dengan textbox-nya — masdis punya
    // beberapa <form> di satu halaman.
    await cari.locator("xpath=ancestor::form").getByRole("button").first().click();
    await tutupDialog();

    // Kartu hasil pencarian ngarah ke detail hotel. Locator-nya jangan pakai nama
    // kartu — namanya memuat harga yang berubah tiap hari.
    const kartu = page.locator('a[href*="/product/hotel/detail"]').first();
    await expect(kartu, "hasil pencarian hotel kosong").toBeVisible({ timeout: 60000 });

    await tutupDialog();
    await kartu.click();
    await expect(page.getByRole("link", { name: "Pilih Kamar" }).first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("TC-MD-C4 masuk keranjang", async () => {
    await tutupDialog();
    await page.getByRole("link", { name: "Pilih Kamar" }).first().click();
    await tutupDialog();
    await page.getByRole("button", { name: "Pesan Sekarang" }).first().click();

    // "Pemesanan Akomodasi" = halaman pesanan. Titik terakhir: sesudah ini bayar.
    await expect(
      page.getByRole("heading", { name: "Pemesanan Akomodasi" }),
      "tidak masuk halaman pemesanan",
    ).toBeVisible({ timeout: 60000 });
  });

  test("TC-MD-C5 isi keranjang", async () => {
    // Pesanan kebawa kalau harganya ikut ke-render. Nggak ada klik lanjut.
    await expect(
      page.getByText(/Rp\s?[\d.]+/).first(),
      "halaman pemesanan kosong",
    ).toBeVisible({ timeout: 30000 });
  });
});
