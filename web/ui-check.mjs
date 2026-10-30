import { chromium } from '../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const base = process.env.QA_WEB_URL || 'http://127.0.0.1:3000';
const email = process.env.QA_EMAIL || ('qa-ui-' + Date.now() + '@local.test');
const password = process.env.QA_PASSWORD || 'local-qa-password-123';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.locator('#auth-dialog');
  await dialog.waitFor();
  if (process.env.QA_EMAIL) {
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  } else {
    await dialog.getByRole('button', { name: 'Create account', exact: true }).first().click();
    await dialog.getByLabel('Name', { exact: true }).fill('QA UI Check');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Password', { exact: true }).fill(password);
    await dialog.getByLabel('Confirm password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Create account', exact: true }).last().click();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  console.log('Alerts:', await page.getByRole('alert').allTextContents());
  assert.equal((await page.getByRole('alert').allTextContents()).filter(Boolean).length, 0);
  assert.equal(await page.getByRole('log', { name: 'Live execution terminal' }).count(), 1);
  await page.screenshot({ path: '/tmp/opencode/preview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Toggle sidebar' }).waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  assert.ok(await page.getByRole('complementary', { name: 'Suite navigation' }).isVisible());
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  assert.equal(await page.getByRole('complementary', { name: 'Suite navigation' }).isVisible(), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '/tmp/opencode/preview-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('UI check passed: account authentication, workspace, responsive layout, no browser errors.');
} finally {
  await browser.close();
}
