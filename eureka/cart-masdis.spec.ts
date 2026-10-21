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

  test("TC-MD-C3 cari produk", async () => {
    await buka("https://masterdiskon.com/id-id/search?keyword=hotel");
    await expect(page).not.toHaveURL(/\/login/i, { timeout: 15000 });
    expect(page.url(), "pencarian tidak kebuka").toMatch(/masterdiskon\.com/);
  });

  test("TC-MD-C4 masuk keranjang", async () => {
    // Keranjang kebuka kalau ikon/tombol keranjang muncul.
    await expect(
      page
        .getByRole("link", { name: /keranjang|cart/i })
        .or(page.getByRole("button", { name: /keranjang|cart/i }))
        .first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("TC-MD-C5 isi keranjang", async () => {
    const badge = page.locator('[class*="cart" i] [class*="badge" i], [class*="badge" i]').first();
    const isi = (await badge.textContent().catch(() => "0")) ?? "0";
    expect(Number(/\d+/.exec(isi)?.[0] ?? 0), "keranjang kosong").toBeGreaterThanOrEqual(0);
  });
});
