import { test, expect } from "@playwright/test";

// Target dari sesi Playbook (BASE_URL), fallback ke stack lokal ticketing.
const BASE = (process.env.BASE_URL ?? "https://localhost:5173").replace(/\/+$/, "");
// Kredensial admin ticketing: dari env ticketing_pos_be, bisa ditimpa lewat .env repo.
const USER = process.env.TICKETING_ADMIN_USERNAME ?? "admin";
const PASS = process.env.TICKETING_ADMIN_PASSWORD ?? "admin-password";

test("TC-TK-A1 login admin berhasil", async ({ page }) => {
  await page.goto(BASE + "/admin/login", { waitUntil: "domcontentloaded" });

  await page.getByLabel("Username").fill(USER);
  // Pakai id: getByLabel("Password") ikut cocok ke tombol "Tampilkan password".
  await page.locator("#admin-password").fill(PASS);
  await page.getByRole("button", { name: "Masuk Admin" }).click();

  await expect(page).toHaveURL(/\/admin\/hash-code$/, { timeout: 45000 });
  await expect(page.getByRole("heading", { name: "Generate Hash Device" })).toBeVisible();
});
