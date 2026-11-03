// PRD §7 / A43: quick check = 1 run pw smoke + 1 run lh budget default, tanpa test_files.
// Spec & config ditulis ke `.quick/` (gitignored) sekali saja, dipakai ulang tiap run.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const quickDir = join(root, '.quick');
export const pwConfig = join(quickDir, 'playwright.config.ts');
export const lhConfigName = 'lighthouserc.cjs';

// Console and network are recorded by scripts/pw-capture.cjs (NODE_OPTIONS preload).
const SPEC = `import { test, expect } from '@playwright/test';

test('quick check smoke', async ({ page }) => {
  const base = process.env.BASE_URL;
  if (!base) throw new Error('BASE_URL tidak di-set');

  const res = await page.goto(base, { waitUntil: 'domcontentloaded' });
  expect(res?.status() ?? 0, 'status HTTP < 400').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
});
`;

const PW_CONFIG = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  retries: 0,
  reporter: [
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME }],
    ['html', { outputDir: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR, open: 'never' }],
  ],
  use: { ...devices['Desktop Chrome'], navigationTimeout: 90000, ignoreHTTPSErrors: true },
});
`;

let ensured = null;
export function ensureQuickFiles() {
  ensured ??= (async () => {
    await mkdir(quickDir, { recursive: true });
    await writeFile(join(quickDir, 'quick.spec.ts'), SPEC);
    await writeFile(pwConfig, PW_CONFIG);
    return { pwConfig, quickDir };
  })();
  return ensured;
}

// Target lokal HTTPS biasanya self-signed (vite basicSsl); hanya loopback yang
// dilewati cek sertifikat. LHCI collect mengabaikan settings.ignoreHTTPSErrors,
// jadi yang dipakai chromeFlags (diverifikasi dengan sertifikat self-signed).
const isLocalHttps = url => { try { const u = new URL(url); return u.protocol === 'https:' && (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost')); } catch { return false; } };

// Config Lighthouse per run: URL & outputDir berbeda tiap run.
export async function writeLighthouseConfig(dir, targetUrl) {
  const outDir = join(dir, 'artifacts').replaceAll('\\', '/');
  const config = `module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      url: [${JSON.stringify(targetUrl)}],
${isLocalHttps(targetUrl) ? "      settings: { chromeFlags: ['--ignore-certificate-errors'] },\r\n" : ""}    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.6 }],
        'categories:accessibility': ['warn', { minScore: 0.6 }],
        'categories:best-practices': ['warn', { minScore: 0.6 }],
        'categories:seo': ['warn', { minScore: 0.6 }],
      },
    },
    upload: { target: 'filesystem', outputDir: ${JSON.stringify(outDir)} },
  },
};
`;
  await mkdir(dir, { recursive: true });
  const file = join(dir, lhConfigName);
  await writeFile(file, config);
  return file;
}
