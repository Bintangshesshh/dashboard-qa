import { chromium } from '../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const base = process.env.QA_WEB_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });

  // Sidebar: 4 QA views + 3 workbench views.
  const nav = await page.locator('.nav-item').allTextContents();
  console.log('nav:', nav);
  for (const label of ['Overview', 'Runs', 'Failures', 'Projects', 'Playwright', 'Lighthouse', 'Reports']) {
    if (!nav.some(n => n.includes(label))) problems.push('missing nav item ' + label);
  }
  await page.screenshot({ path: 'qa-overview.png', fullPage: true });

  // Overview structure: 6 KPIs, 14 bars, donut.
  assert.equal(await page.locator('.kpis .kpi').count(), 6, 'kpi count');
  assert.equal(await page.locator('.chart .bar').count(), 14, 'chart bars');
  assert.equal(await page.locator('.donut-value').count(), 1, 'donut');

  // Runs view + status chip filter.
  await page.locator('.nav-item', { hasText: 'Runs' }).click();
  await page.locator('h1', { hasText: 'Runs' }).waitFor();
  await page.locator('.chip', { hasText: 'Failed' }).click();
  assert.equal(await page.locator('.chip.active').textContent(), 'Failed');
  await page.screenshot({ path: 'qa-runs.png', fullPage: true });

  // Failures + Projects.
  await page.locator('.nav-item', { hasText: 'Failures' }).click();
  await page.locator('h1', { hasText: 'Failures' }).waitFor();
  await page.screenshot({ path: 'qa-failures.png', fullPage: true });
  await page.locator('.nav-item', { hasText: 'Projects' }).click();
  await page.locator('h1', { hasText: 'Projects' }).waitFor();
  await page.screenshot({ path: 'qa-projects.png', fullPage: true });

  // Workbench views still reachable.
  await page.locator('.nav-item', { hasText: 'Playwright' }).click();
  await page.getByRole('banner').locator('h1', { hasText: 'Playwright' }).waitFor();
  assert.equal(await page.locator('[aria-label="Toggle sidebar"]').count(), 1);

  // Dark mode toggle.
  await page.locator('.nav-item', { hasText: 'Overview' }).click();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.screenshot({ path: 'qa-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');

  // Mobile: no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow on mobile');
  await page.screenshot({ path: 'qa-mobile.png', fullPage: true });

  if (errors.length) problems.push('browser errors: ' + errors.join(' | '));
  if (problems.length) throw new Error(problems.join('; '));
  console.log('QA dashboard check passed: nav, 4 views, chips, KPIs, 14 bars, donut, dark mode, mobile.');
} finally {
  await browser.close();
}
