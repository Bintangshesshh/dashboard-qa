import { test, expect } from "@playwright/test";
import { creds } from "./creds";

// BASE bisa diarahkan ke local/staging lewat env; fallback ke production.
const BASE = (process.env.BASE_URL ?? "https://jaja.id").replace(/\/+$/, "");

// Alur jaja sampai keranjang. Nggak ada checkout, nggak ada pembayaran.
test.describe.serial("jaja - sampai keranjang", () => {
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

  const dismissOk = () =>
    page.getByRole("button", { name: "OK" }).first().click({ timeout: 5000 }).catch(() => {});

  test("TC-JA-C1 homepage terbuka", async () => {
    await buka(BASE + "/");
    await expect(page).toHaveURL(u => u.host === new URL(BASE).host);
  });

  test("TC-JA-C2 login", async () => {
    await buka(BASE + "/main/auth/login");
    const form = page.locator("form").filter({ hasText: "EmailPasswordIngat sayaLupa" });
    await page.waitForTimeout(5000);

    await form.getByPlaceholder("Masukkan email Anda").fill(creds("JAJA_EMAIL"));
    await form.getByPlaceholder("Masukkan password Anda").fill(creds("JAJA_PASSWORD"));
    await page.getByRole("button", { name: "Masuk" }).first().click({ force: true });

    const search = page.getByRole("textbox", { name: "Cari di Jaja.id" });
    await expect(search).toBeVisible({ timeout: 45000 });
  });

  test("TC-JA-C3 cari produk", async () => {
    await dismissOk();
    const search = page.getByRole("textbox", { name: "Cari di Jaja.id" });
    await search.fill("iphone");
    await dismissOk();

    await buka(BASE + "/Product/iphone-15-pro");
    await dismissOk();
    await expect(
      page.getByRole("button", { name: "Beli Langsung" }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("TC-JA-C4 masuk keranjang", async () => {
    await page.getByRole("button", { name: "Beli Langsung" }).click({ force: true });

    await expect(
      page.getByRole("button", { name: /Checkout Sekarang \(\d+ item\)/ }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("TC-JA-C5 isi keranjang", async () => {
    const tombol = page.getByRole("button", { name: /Checkout Sekarang \(\d+ item\)/ });
    const isi = /\((\d+) item\)/.exec((await tombol.textContent()) ?? "")?.[1];
    expect(Number(isi), "keranjang kosong").toBeGreaterThan(0);
  });
});
