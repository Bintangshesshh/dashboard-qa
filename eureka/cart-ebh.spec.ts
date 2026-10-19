import { test, expect } from "@playwright/test";
import { creds } from "./creds";

// Alur ebh sampai keranjang. Nggak ada checkout, nggak ada pembayaran.
// Dipecah per langkah biar dashboard bisa nunjukin gagal di mana.
test.describe.serial("ebh — sampai keranjang", () => {
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
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        return;
      } catch (e) {
        err = e;
        await page.waitForTimeout(3000 * (i + 1));
      }
    }
    throw err;
  };

  test("TC-EB-C1 homepage terbuka", async () => {
    await buka("https://eurekabookhouse.com/");
    await expect(page).toHaveURL(/eurekabookhouse\.com/);
  });

  test("TC-EB-C2 login", async () => {
    await buka("https://eurekabookhouse.com/auth/login");
    await page.waitForTimeout(5000);

    await page
      .getByRole("textbox", { name: "namaanda@email.com" })
      .fill(creds("EUREKABOOKHOUSE_EMAIL"));
    await page
      .getByRole("textbox", { name: "........." })
      .fill(creds("EUREKABOOKHOUSE_PASSWORD"));

    const resP = page.waitForResponse((r) => /customer\/login/.test(r.url()), {
      timeout: 45000,
    });
    await page.getByRole("button", { name: "Masuk Sekarang" }).click();
    expect((await resP).ok()).toBe(true);

    await page.locator(".swal2-confirm").first().click({ timeout: 20000 }).catch(() => {});
    await expect(page).not.toHaveURL(/auth\/login/i, { timeout: 30000 });
  });

  test("TC-EB-C3 cari produk", async () => {
    await page
      .getByRole("textbox", { name: "Cari judul buku, atau penulis" })
      .fill("TKA");

    const produk = page
      .getByRole("link", { name: "ERLANGGA - SIAGA PLUS TKA SD/MI 2027" })
      .first();
    await expect(produk).toBeVisible({ timeout: 30000 });

    const href = (await produk.getAttribute("href"))!;
    await buka(new URL(href, page.url()).href);
    await expect(
      page.getByRole("heading", { name: "ERLANGGA - SIAGA PLUS TKA SD/MI 2027" }),
    ).toBeVisible({ timeout: 20000 });
  });

  test("TC-EB-C4 masuk keranjang", async () => {
    await page.getByRole("button", { name: "BELI SEKARANG" }).click();

    // Keranjang kebuka kalau tombol Checkout (N) muncul.
    await expect(
      page.getByRole("button", { name: /Checkout \(\d+\)/ }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("TC-EB-C5 isi keranjang", async () => {
    const tombol = page.getByRole("button", { name: /Checkout \((\d+)\)/ });
    const isi = /\((\d+)\)/.exec((await tombol.textContent()) ?? "")?.[1];
    expect(Number(isi), "keranjang kosong").toBeGreaterThan(0);
  });
});
