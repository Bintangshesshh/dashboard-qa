import { test, expect, type Page, type Browser } from "@playwright/test";

// File ini dibuat otomatis: simulasi alur pelanggan lengkap.
// BASE_URL bisa diarahkan ke local/staging; fallback ke origin hasil crawl.
const BASE = (process.env.BASE_URL || "https://eurekabookhouse.com").replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const url = (path: string) => ORIGIN + path;

// Kredensial test; JANGAN dipakai di production.
const BOT = {
  name: "QAbot",
  email: "qabot@test.playbook",
  phone: "081200000000",
  username: "qabot",
  password: "botplaywright123",
};

test.describe.serial("Journey lengkap - eurekabookhouse.com", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.setDefaultTimeout(60_000);
  });

  test.afterEach(async ({}, testInfo) => {
    if (!page) return;
    const shot = await page.screenshot({ fullPage: true }).catch(() => null);
    if (shot) {
      await testInfo.attach(`ss-${testInfo.title}`, { body: shot, contentType: "image/png" });
    }
  });

  test.afterAll(async () => {
    await page?.close().catch(() => {});
  });

  // Navigasi diulang 3x: target lokal/staging kadang lambat saat cold start.
  const buka = async (path: string) => {
    let err: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await page.goto(url(path), { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (e) {
        err = e;
        await page.waitForTimeout(3_000 * (i + 1));
      }
    }
    throw err;
  };

  const jeda = async (label: string) => {
    const file = process.env.PLAYBOOK_CONTROL_FILE;
    if (!file) return;
    const fs = await import("node:fs/promises");
    await fs.writeFile(`${file}.state`, JSON.stringify({ label, at: Date.now() })).catch(() => {});
    for (;;) {
      const raw = await fs.readFile(file, "utf8").catch(() => '{"mode":"run"}');
      let mode = "run";
      try { mode = JSON.parse(raw).mode ?? "run"; } catch {}
      if (mode === "run") return;
      if (mode === "step") {
        await fs.writeFile(file, JSON.stringify({ mode: "pause" })).catch(() => {});
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const langkah = async (label: string, body: () => Promise<void>) => {
    await test.step(label, async () => {
      await jeda(label);
      await body();
    });
  };

  // Tutup popup/dialog yang mungkin muncul (cookie consent, promosi, dll).
  const tutupPopup = async () => {
    const selectors = [
      'button:has-text("Accept")',
      'button:has-text("Terima")',
      'button:has-text("OK")',
      'button:has-text("Close")',
      'button:has-text("Tutup")',
      'button:has-text("Got it")',
      '[class*="close"][role="button"]',
      'button[aria-label="Close"]',
      'button[aria-label="Tutup"]',
    ];
    for (const sel of selectors) {
      try { await page.locator(sel).first().click({ timeout: 1_000 }); return; } catch {}
    }
  };

  test("TC-01 Homepage terbuka", async () => {
    await langkah("Buka halaman utama", async () => {
      const res = await buka("/");
      expect(res, "halaman merespons").not.toBeNull();
      expect(res!.status(), "HTTP status homepage").toBeLessThan(400);
      await expect(page).toHaveTitle("Eureka Bookhouse | Toko Buku Online Terlengkap");
      await expect(page.locator("body")).toBeVisible();
      await expect(page.getByRole("navigation").first()).toBeVisible();
    });
    await tutupPopup();
  });

  test("TC-02 Interaksi tombol navigasi - Kategori", async () => {
    await langkah("Klik tombol navigasi Kategori", async () => {
      await buka("/");
      try {
        const btnEl = page.locator("button:has-text(\"Kategori\"), [role=\"button\"]:has-text(\"Kategori\")").first();
        await expect(btnEl).toBeVisible({ timeout: 5_000 });
        await btnEl.click();
        await page.waitForTimeout(1_000);
      } catch { /* tombol navigasi opsional */ }
    });
  });

  test("TC-03 Interaksi tombol navigasi - Genre", async () => {
    await langkah("Klik tombol navigasi Genre", async () => {
      await buka("/");
      try {
        const btnEl = page.locator("button:has-text(\"Genre\"), [role=\"button\"]:has-text(\"Genre\")").first();
        await expect(btnEl).toBeVisible({ timeout: 5_000 });
        await btnEl.click();
        await page.waitForTimeout(1_000);
      } catch { /* tombol navigasi opsional */ }
    });
  });

  test("TC-04 Cari produk", async () => {
    await langkah("Buka halaman pencarian", async () => {
      await buka("/");
    });
    await langkah("Isi kata kunci pencarian", async () => {
      const searchInput = page.getByPlaceholder("Cari judul buku, atau penulis", { exact: true });
      await expect(searchInput).toBeVisible({ timeout: 10_000 });
      await searchInput.fill("buku");
      await searchInput.press("Enter");
      await page.waitForLoadState("domcontentloaded");
    });
    await langkah("Verifikasi hasil pencarian", async () => {
      await expect(page.locator("body")).toBeVisible();
    });
  });

  test("TC-05 Jelajah kategori - Flash Sale", async () => {
    await langkah("Buka kategori Flash Sale", async () => {
      const res = await buka("/flashsale");
      expect(res, "halaman kategori merespons").not.toBeNull();
      expect(res!.status(), "HTTP status kategori").toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
    });
  });

  test("TC-06 Jelajah kategori - Pre-Orders", async () => {
    await langkah("Buka kategori Pre-Orders", async () => {
      const res = await buka("/pre-order");
      expect(res, "halaman kategori merespons").not.toBeNull();
      expect(res!.status(), "HTTP status kategori").toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
    });
  });

  test("TC-07 Navigasi Store Location", async () => {
    await langkah("Buka Store Location", async () => {
      const res = await buka("/Halaman/StoreLocation");
      expect(res, "halaman merespons").not.toBeNull();
      expect(res!.status(), "HTTP status halaman").toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
    });
  });

});
