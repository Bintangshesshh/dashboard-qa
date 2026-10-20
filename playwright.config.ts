import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./eureka",
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "pw-out/hasil.json" }],
    ["./scripts/pw-reporter.mjs"],
  ],
  use: {
    trace: "on-first-retry",
    actionTimeout: 30000,
    navigationTimeout: 90000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
