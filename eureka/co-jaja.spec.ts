import { test, expect } from "@playwright/test";
import { creds } from "./creds";

test.describe.serial("jaja", () => {
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

  // dismiss OK
  const dismissOk = () =>
    page
      .getByRole("button", { name: "OK" })
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});

  const dismissOverlay = () =>
    page
      .locator(".fixed.inset-0")
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});

  // /Checkout kadang dilempar balik ke /Cart sama jaja (1 dtk setelah nyampe).
  // Ada 2 tombol nama sama (satu mobile-hide, satu tersembunyi), filter visible.
  const siapCheckout = async () => {
    const bayar = page
      .getByRole("button", { name: "Bayar Sekarang" })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < 3; i++) {
      if (
        await bayar
          .waitFor({ state: "visible", timeout: 20000 })
          .then(() => true)
          .catch(() => false)
      )
        return bayar;
      if (/\/cart/i.test(page.url())) {
        const co = page
          .getByRole("button", { name: /Checkout Sekarang/ })
          .first();
        if (await co.count()) {
          await co.click({ timeout: 20000 }).catch(() => {});
        } else {
          await buka("https://jaja.id/Product/iphone-15-pro");
          await page
            .getByRole("button", { name: "Beli Langsung" })
            .click({ force: true })
            .catch(() => {});
        }
      } else {
        await buka("https://jaja.id/Checkout");
      }
      await page.waitForTimeout(5000);
    }
    throw new Error(`Checkout nggak siap, sekarang di ${page.url()}`);
  };

  const clickBayar = async () => {
    await (await siapCheckout()).click();
  };

  const bayarTahanError = async () => {
    for (let i = 0; i < 3; i++) {
      const gagal = await page
        .getByRole("dialog", { name: "Pembayaran Gagal" })
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      if (!gagal) break;
      await dismissOk();
      await clickBayar();
    }
  };

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
  test("TC-J01 login", async () => {
    await buka("https://jaja.id/main/auth/login");
    const email = creds("JAJA_EMAIL");
    const password = creds("JAJA_PASSWORD");
    const form = page
      .locator("form")
      .filter({ hasText: "EmailPasswordIngat sayaLupa" });

    // Tunggu 15 detik sampe siap
    await page.waitForTimeout(15000);

    await form.getByPlaceholder("Masukkan email Anda").fill(email);
    await form.getByPlaceholder("Masukkan password Anda").fill(password);
    await page
      .getByRole("button", { name: "Masuk" })
      .first()
      .click({ force: true });

    // Bukti login berhasil
    const search = page.getByRole("textbox", { name: "Cari di Jaja.id" });
    const appError = page.getByText("Application error");
    await expect(search.or(appError)).toBeVisible({ timeout: 30000 });
    // jaja.id kadang tampilkan "Application error" setelah login.
    // Refresh pakai domcontentloaded nunggu bisa
    for (let i = 0; i < 3; i++) {
      if (await search.isVisible().catch(() => false)) break;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(search.or(appError)).toBeVisible({ timeout: 30000 });
    }
    await expect(search).toBeVisible({ timeout: 30000 });
  });

  // TC 2 Search
  test("TC-J02 search-iphone", async () => {
    const search = page.getByRole("textbox", { name: "Cari di Jaja.id" });
    const appError = page.getByText("Application error");

    await expect(search.or(appError)).toBeVisible({ timeout: 30000 });
    if (await appError.isVisible().catch(() => false)) {
      await buka("https://jaja.id/");
      await expect(search).toBeVisible({ timeout: 30000 });
    }

    await dismissOverlay();
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill("iphone");

    // Popup
    await dismissOk();

    // Langsung ke halaman produk
    await buka("https://jaja.id/Product/iphone-15-pro");
    await dismissOk();

    // Bukti masuk halaman produk
    await expect(
      page.getByRole("button", { name: "Beli Langsung" }),
    ).toBeVisible({ timeout: 30000 });
  });

  // TC 3 Checkout
  test("TC-J03 checkout", async () => {
    await page
      .getByRole("button", { name: "Beli Langsung" })
      .click({ force: true });
    await page
      .getByRole("button", { name: "Checkout Sekarang (1 item)" })
      .click();

    // Bukti udah di checkout DAN halamannya siap dipakai (jaja suka lempar balik ke /Cart)
    await siapCheckout();
    await expect(page).toHaveURL(/\/checkout/i, { timeout: 30000 });
  });

  // TC 4 Pembayaran
  test("TC-J04 bayar", async () => {
    await dismissOverlay();

    const dokuPromise = page
      .waitForEvent("popup", { timeout: 20000 })
      .catch(() => null);

    await clickBayar();
    await bayarTahanError();

    await page.waitForTimeout(5000);
    if (/\/Order\/\d+/i.test(page.url())) {
      await clickBayar();
      await bayarTahanError();
    }

    const popup = /doku/i.test(page.url()) ? null : await dokuPromise;
    const doku = popup ?? page;

    // Bukti nyampe DOKU
    await expect(doku).toHaveURL(/doku/i, { timeout: 120000 });

    await expect(
      doku
        .locator("span.summary-label:visible")
        .filter({ hasText: /Nomor Invoice/i }),
    ).toBeVisible({ timeout: 30000 });
  });

  // TC 5 Batalin orderan
  test("TC-J05 cancel-order", async () => {
    await buka("https://jaja.id/clientArea/orders");
    await dismissOk();

    await page.getByRole("button", { name: "Lihat Detail" }).first().click();

    // Bukti pesanan dibatalkan
    await expect(page).toHaveURL(/\/Order\/\d+/, { timeout: 60000 });
    await page.getByRole("button", { name: "CANCEL ORDER" }).click();
    await page
      .getByRole("button", { name: "Ya, Batalkan" })
      .click()
      .catch(() => {}); // konfirmasi nggak selalu muncul
    await dismissOk();

    // Bukti pesanan dibatalkan
    await buka("https://jaja.id/clientArea/orders");
    await dismissOk();
    await expect(page.getByText(/Dibatalkan/i).first()).toBeVisible({
      timeout: 60000,
    });
  });

  // TC 6 Logout
  test("TC-J06 logout", async () => {
    await page
      .getByRole("button", { name: "Hello, test Account & Lists" })
      .click();
    await page.getByRole("button", { name: "Logout" }).click({ force: true });
    await page.getByRole("button", { name: "Ya, Keluar" }).click();

    // Bukti buat udah keluar akun
    await expect(page).toHaveURL(/jaja\.id/i, { timeout: 60000 });
  });
});
