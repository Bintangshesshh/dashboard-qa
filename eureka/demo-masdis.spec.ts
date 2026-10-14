import { test, expect } from "@playwright/test";

// Demo apa adanya: cuma alur masterdiskon yang TIDAK butuh login.
// File ini sengaja nggak impor creds dan nggak pakai storageState, jadi
// nggak pernah nyentuh POST /v1/auth/token — aman walau akun kena blokir.

test.describe.serial("masterdiskon — demo tanpa login", () => {
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

  // TC-D01: API masterdiskon hidup? Kalau ini merah, semua alur booking pasti ikut gagal.
  test("TC-D01 cek API", async () => {
    const api = await page.request.get(
      "https://api.masterdiskon.com/v1/front/beranda/menuCategory",
    );
    expect(api.status(), "API masterdiskon tidak balas 200").toBe(200);
    expect(await api.json().catch(() => null), "respons API kosong/bukan JSON").toBeTruthy();
  });

  // TC-D02: halaman login tampil. SENGAJA nggak submit — akun kena blokir
  // (403 "Akun terblokir"), jadi submit cuma nambah log gagal di sisi mereka.
  test("TC-D02 halaman login tampil (tanpa submit)", async () => {
    await buka("https://masterdiskon.com/id-id/login");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
    // Tombol "Masuk" disabled selama form kosong — validasi sisi klien jalan.
    await expect(page.getByRole("button", { name: "Masuk" })).toBeDisabled();
  });

  // TC-D03: detail hotel + tombol booking kelihatan. Ini titik terakhir yang bisa
  // dicapai tanpa login; klik "Pesan Sekarang" sudah butuh sesi.
  test("TC-D03 detail hotel", async () => {
    await buka(
      "https://masterdiskon.com/id-id/product/hotel/detail?adult=1&child=0" +
        `&dateFrom=${tgl(1)}&dateTo=${tgl(2)}` +
        "&keyword=Pullman%20Bandung%20Grand%20Central" +
        "&productId=9000000890204&room=1#kamar",
    );

    const pesan = page.locator("button:visible").filter({ hasText: "Pesan Sekarang" }).first();
    const pilih = page.locator("button:visible").filter({ hasText: /^Pilih$/ }).first();

    // Tunggu salah satu muncul — "Pesan Sekarang" render belakangan, cek instan selalu false.
    await pesan.or(pilih).first().waitFor({ state: "visible", timeout: 60000 });
    const booking = (await pesan.isVisible().catch(() => false)) ? pesan : pilih;

    expect(await booking.isVisible(), "tombol booking tidak kelihatan").toBe(true);
    expect(page.url(), "tidak berada di halaman detail hotel").toContain("/product/hotel/detail");
  });
});
