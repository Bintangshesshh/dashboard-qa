import { test, expect } from "@playwright/test";

test.describe.serial("masterdiskon ga login", () => {
  let ctx: import("@playwright/test").BrowserContext;
  let page: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);
    ctx = await browser.newContext();
    page = await ctx.newPage();
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
    await ctx.close();
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

  const tgl = (offset: number) => {
    const d = new Date(Date.now() + offset * 86400000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  };

  // TC-G01 cek API
  test("TC-G01 cek API", async () => {
    const api = await page.request.get(
      "https://api.masterdiskon.com/v1/front/beranda/menuCategory",
    );
    expect(api.status(), "API masterdiskon 200").toBe(200);
    expect(
      await api.json().catch(() => null),
      "respons API kosong",
    ).toBeTruthy();
  });

  // TC-G02 nampilin halaman login
  test("TC-G02 halaman login tampil", async () => {
    await buka("https://masterdiskon.com/id-id/login");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
    // Tombol Masuk disabled
    await expect(page.getByRole("button", { name: "Masuk" })).toBeDisabled();
  });

  // TC-G03 detail hotel dan tombol booking kelihatan
  test("TC-G03 detail hotel", async () => {
    await buka(
      "https://masterdiskon.com/id-id/product/hotel/detail?adult=1&child=0" +
        `&dateFrom=${tgl(1)}&dateTo=${tgl(2)}` +
        "&keyword=Pullman%20Bandung%20Grand%20Central" +
        "&productId=9000000890204&room=1#kamar",
    );

    const pesan = page
      .locator("button:visible")
      .filter({ hasText: "Pesan Sekarang" })
      .first();
    const pilih = page
      .locator("button:visible")
      .filter({ hasText: /^Pilih$/ })
      .first();

    await pesan.or(pilih).first().waitFor({ state: "visible", timeout: 60000 });
    const booking = (await pesan.isVisible().catch(() => false))
      ? pesan
      : pilih;

    expect(await booking.isVisible(), "tombol Pesan Sekarang kelihatan").toBe(
      true,
    );
    expect(page.url(), "berada di halaman detail hotel").toContain(
      "/product/hotel/detail",
    );
  });
});
