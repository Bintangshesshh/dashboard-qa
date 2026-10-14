import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { creds } from "./creds";

// Deteksi double order
const posts: string[] = [];

const AUTH = "eureka/.auth/masdis.json";

// Tanggal inap
const tgl = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

test.describe.serial("masterdiskon", () => {
  let ctx: import("@playwright/test").BrowserContext;
  let page: import("@playwright/test").Page;
  let booking: import("@playwright/test").Locator;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600000);
    ctx = await browser.newContext(
      fs.existsSync(AUTH) ? { storageState: AUTH } : {},
    );
    page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/(booking\/checkout|booking\/cancel)/.test(r.url())
      ) {
        posts.push(r.url().split("/").slice(-2).join("/"));
      }
    });
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
    console.log(
      "[POST booking sepanjang alur]",
      posts.length ? posts.join(" | ") : "(kosong)",
    );
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

  // Cek sesi ke halaman yang wajib login
  const sesiHidup = async () => {
    if (!fs.existsSync(AUTH)) return false;
    await buka("https://masterdiskon.com/id-id/user/purchase");
    await page.waitForTimeout(4000);
    return !/\/login/i.test(page.url());
  };

  // TC 1 Cek API Masterdiskon
  test("TC-M01 test-api", async () => {
    const api = await page.request
      .get("https://api.masterdiskon.com/v1/front/beranda/menuCategory")
      .catch(() => null);
    if (!api || api.status() === 404) {
      throw new Error(
        "api.masterdiskon.com DOWN (status " +
          (api ? api.status() : "no-response") +
          "). Booking tidak bisa jalan. " +
          'Coba lagi nanti, cek: curl.exe -s -o NUL -w "%{http_code}" ' +
          "https://api.masterdiskon.com/v1/front/beranda/menuCategory",
      );
    }
  });

  // TC 2 Login
  test("TC-M02 login", async () => {
    if (process.env.MASDIS_NO_LOGIN) {
      test.skip(true, "MASDIS_NO_LOGIN=1 — percobaan login dimatikan");
    }

    if (await sesiHidup()) {
      console.log(
        "[masdis] sesi tersimpan masih hidup — login dilewati, 0 percobaan ke /v1/auth/token",
      );
      return;
    }

    await buka("https://masterdiskon.com/id-id/login");
    // Tunggu 15 detik sampe siap
    await page.waitForTimeout(15000);

    const email = creds("MASTERDISKON_EMAIL");
    const password = creds("MASTERDISKON_PASSWORD");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);

    const btn = page.getByRole("button", { name: "Masuk" });
    await expect(btn).toBeEnabled({ timeout: 30000 });

    let pesan = "";
    for (let i = 0; i < 2; i++) {
      const ditolak = page
        .waitForResponse(
          (r) => /\/v1\/auth\/token/.test(r.url()) && r.status() >= 400,
          { timeout: 30000 },
        )
        .then(async (r) => {
          const body = await r.text().catch(() => "");
          return `${r.status()} ${/"message":"([^"]+)"/.exec(body)?.[1] ?? body.slice(0, 150)}`;
        })
        .catch(() => "TIDAK ADA jawaban error dari API");

      await btn.click();

      const hasil = await Promise.race([
        page
          .waitForURL(/\/id-id\/?(home)?$/i, { timeout: 30000 })
          .then(() => "OK" as const)
          .catch(() => "URL nyangkut di /login" as const),
        ditolak,
      ]);

      if (hasil === "OK") {
        pesan = "";
        break;
      }

      pesan = hasil;
      if (!/Terlalu banyak percobaan/i.test(pesan)) break;

      await page
        .locator(".swal2-popup button")
        .last()
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.waitForTimeout(6000);
    }

    if (pesan)
      throw new Error(
        `Login DITOLAK masterdiskon ${pesan}\n` +
          (/terblokir/i.test(pesan)
            ? "AKUN TERBLOKIR"
            : /captcha/i.test(pesan)
              ? "TERBLOKIR"
              : "AKUN TERBLOKIR"),
      );

    expect(page.url()).toMatch(/\/id-id\/?(home)?$/i);

    // Popup sukses login, opsional
    await page
      .getByRole("dialog", { name: "Berhasil" })
      .click({ timeout: 10000 })
      .catch(() => {});

    fs.mkdirSync("eureka/.auth", { recursive: true });
    await ctx.storageState({ path: AUTH });
  });

  // TC 3 Buka detail hotel
  test("TC-M03 detail-hotel", async () => {
    // langsung ke detail via URL query
    await buka(
      "https://masterdiskon.com/id-id/product/hotel/detail?adult=1&child=0" +
        `&dateFrom=${tgl(1)}&dateTo=${tgl(2)}` +
        "&keyword=Pullman%20Bandung%20Grand%20Central" +
        "&productId=9000000890204&room=1#kamar",
    );

    // Tombol di halaman detail hotel bernama "Pilih"
    const pesan = page
      .locator("button:visible")
      .filter({ hasText: "Pesan Sekarang" })
      .first();
    const pilih = page
      .locator("button:visible")
      .filter({ hasText: /^Pilih$/ })
      .first();

    await pesan.or(pilih).first().waitFor({ state: "visible", timeout: 60000 });
    booking = (await pesan.isVisible().catch(() => false)) ? pesan : pilih;

    // Bukti tombol booking kelihatan di layar
    expect(await booking.isVisible()).toBe(true);
  });

  // TC 4 Pilih kamar
  test("TC-M04 pilih-kamar", async () => {
    await page.waitForTimeout(15000);
    const avail = page.waitForResponse(
      (r) => /apitrav\/booking\/avail/.test(r.url()),
      {
        timeout: 60000,
      },
    );

    await booking.click();

    // Waited
    await page
      .locator(".swal2-container")
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    // Request ketersediaan kamar benar-benar terkirim ke server
    await avail;

    // Ini bukti pemesanan berhasil masuk sampai ke keranjang Masterdiskon
    await expect(page).toHaveURL(/\/product\/hotel\/checkout/i, {
      timeout: 90000,
    });

    // Klik tombol "Pesan Sekarang" di halaman checkout
    const submit = page
      .locator("div.bg-primary:visible")
      .filter({ hasText: /^Pesan Sekarang$/ })
      .last();
    await submit.waitFor({ state: "visible", timeout: 90000 });

    for (const [sel, nilai] of [
      ["input[name=first]:visible", "Test"],
      ["input[name=last]:visible", "Otomatis"],
      ["input[name=phone]:visible", "81234567890"],
    ]) {
      const f = page.locator(sel).first();
      if (
        (await f.isVisible().catch(() => false)) &&
        !(await f.inputValue().catch(() => ""))
      ) {
        await f.fill(nilai);
      }
    }
    await page.waitForTimeout(2000);

    const tungguCheckout = () =>
      page.waitForResponse((r) => /apitrav\/booking\/checkout/.test(r.url()), {
        timeout: 60000,
      });

    let janji = tungguCheckout().catch(() => null);
    await submit.click({ clickCount: 1 });
    let respon = await janji;
    if (!respon) {
      janji = tungguCheckout().catch(() => null);
      await submit.click({ clickCount: 1 });
      respon = await janji;
    }
    expect(
      respon,
      "POST booking/checkout tidak terkirim form pemesan ditolak",
    ).not.toBeNull();
    expect(respon!.status()).toBe(200);
  });

  // TC 5 Batalin pesanan
  test("TC-M05 cancel-order", async () => {
    await buka("https://masterdiskon.com/id-id/user/purchase");

    const detail = page.locator('a[href*="/user/purchase/detail/"]').first();
    const adaPesanan = await detail
      .waitFor({ state: "visible", timeout: 45000 })
      .then(() => true)
      .catch(() => false);

    test.skip(!adaPesanan, "Tidak ada pesanan aktif untuk dibatalkan");

    await detail.click();
    await page.waitForURL(/\/user\/purchase\/detail\//i, { timeout: 60000 });
    await page.waitForTimeout(5000);

    const batal = page.getByText(/^Batal(kan)?\s+Pesanan$/).first();
    await batal.waitFor({ state: "visible", timeout: 60000 });

    // Tutup swal dari flow checkout yang menutupi tombol
    await page.evaluate(() => {
      document
        .querySelectorAll(".swal2-container, .modal-backdrop")
        .forEach((e) => e.remove());
    });

    await batal.click();

    // Popup konfirmasi
    const yakin = page.getByText(/yakin untuk membatalkan pemesanan/i).first();
    await yakin.waitFor({ state: "visible", timeout: 30000 });

    const ya = page.getByText("Ya", { exact: true }).last();
    await ya.click({ timeout: 15000 });

    await page.waitForTimeout(5000);

    // Tombol batal hilang dari halaman
    await expect(batal).toBeHidden({ timeout: 45000 });
  });

  // TC 6 Logout
  test("TC-M06 logout", async () => {
    // MASDIS_KEEP_SESSION=1: lewati logout biar file sesi tetap hidup.
    // Tanpa ini tiap run wajib 1 login baru — percobaan yang numpuk ke akun.
    if (process.env.MASDIS_KEEP_SESSION) {
      test.skip(true, "MASDIS_KEEP_SESSION=1 — sesi dipertahankan");
    }

    await buka("https://masterdiskon.com/id-id/user/purchase");

    const userMenu = page.locator("li.userlogged").first();
    await userMenu.waitFor({ state: "visible", timeout: 45000 });
    await userMenu.locator('[aria-haspopup="true"]').first().click();

    const keluar = page.getByRole("button", { name: "Keluar" }).first();
    await keluar.waitFor({ state: "visible", timeout: 15000 });
    await keluar.click();

    // Bukti udah nyampe di login page lagi
    await expect(page).toHaveURL(/\/id-id\/login/i, { timeout: 30000 });

    // Sesi udah mati di server
    fs.rmSync(AUTH, { force: true });
  });
});
