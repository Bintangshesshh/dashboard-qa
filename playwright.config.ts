import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./eureka",
  // Tiga situs hidup dipakai bersamaan. Jalankan berurutan: kalau paralel,
  // jaja.id dan eurekabookhouse.com ikut lambat lalu navigation timeout.
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  // html buat dilihat manusia, json buat dibaca scripts/gabung.mjs
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "pw-out/hasil.json" }],
  ],
  use: {
    trace: "on-first-retry",
    actionTimeout: 30000,
    // waitUntil "load" nunggu aset pihak ketiga (iklan, analitik) yang
  // sering tidak pernah selesai. "domcontentloaded" cukup untuk form.
  navigationTimeout: 90000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
