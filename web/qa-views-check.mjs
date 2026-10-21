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

  // Sidebar: only the four Playbook views.
  const nav = (await page.locator('.nav-item').allTextContents()).map(t => t.trim());
  console.log('nav:', nav);
  assert.deepEqual(nav, ['Overview', 'Playwright', 'Lighthouse', 'Reports']);
  for (const hidden of ['Runs', 'Failures', 'Projects']) {
    assert.ok(!nav.includes(hidden), 'unexpected nav item ' + hidden);
  }
  await page.screenshot({ path: 'qa-overview.png', fullPage: true });

  // Overview structure: 6 KPIs, 14 chart hits, donut.
  assert.equal(await page.locator('.kpis .kpi').count(), 6, 'kpi count');
  assert.equal(await page.locator('.line-chart .hit').count(), 14, 'chart points');
  assert.equal(await page.locator('.donut-value').count(), 1, 'donut');

  // Reference theme: dark by default, SF/Segoe body, Apple blue accent.
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /SF Pro Text|Segoe UI|system-ui/i);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.btn-primary')).backgroundColor), 'rgb(0, 113, 227)');

  // Hidden views stay reachable from Overview and keep Overview highlighted.
  await page.locator('#view-overview button.link', { hasText: 'Open runs' }).click();
  await page.getByRole('banner').locator('h1', { hasText: 'Runs' }).waitFor();
  assert.equal((await page.locator('.nav-item[aria-current="page"]').textContent()).trim(), 'Overview');

  // Workbench views still reachable.
  for (const label of ['Playwright', 'Lighthouse', 'Reports']) {
    await page.locator('.nav-item', { hasText: label }).click();
    await page.getByRole('banner').locator('h1', { hasText: label }).waitFor();
  }
  assert.equal(await page.locator('[aria-label="Toggle sidebar"]').count(), 1);

  // Theme toggle: dark -> light -> dark.
  await page.locator('.nav-item', { hasText: 'Overview' }).click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 247)');
  await page.screenshot({ path: 'qa-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.screenshot({ path: 'qa-dark.png', fullPage: true });

  // Mobile: no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow on mobile');
  await page.screenshot({ path: 'qa-mobile.png', fullPage: true });

  if (errors.length) problems.push('browser errors: ' + errors.join(' | '));
  if (problems.length) throw new Error(problems.join('; '));
  console.log('Playbook check passed: 4 nav items, hidden views reachable, dark-first reference theme, toggle, mobile.');
} finally {
  await browser.close();
}
