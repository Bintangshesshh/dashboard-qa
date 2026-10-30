import { chromium } from '../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = new URL(process.env.QA_WEB_URL || 'http://127.0.0.1:3000');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Local web server required');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const prefix = 'draft-regression-' + Date.now();
  const suites = [
    { id: prefix + '-a', name: prefix + ' A', targetUrl: 'http://127.0.0.1:4173', description: '' },
    { id: prefix + '-b', name: prefix + ' B', targetUrl: 'http://127.0.0.1:4173', description: '' },
  ];
  let authenticated = true, logout = 0, mutations = 0;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth' && request.method() === 'GET') {
      return authenticated
        ? respond({ authenticated: true, user: { id: 'user-a', name: 'QA Draft', email: 'draft@local.test', role: 'admin' }, csrfToken: 'csrf-draft' })
        : respond({ authenticated: false });
    }
    if (url.pathname === '/api/auth/logout' && request.method() === 'POST') {
      authenticated = false; logout++;
      return route.fulfill({ status: 204, body: '' });
    }
    if (!authenticated) return respond({ error: 'Unauthorized' }, 401);
    if (request.method() !== 'GET') { mutations++; return respond({ error: 'Unexpected mutation' }, 400); }
    if (url.pathname === '/api/suites') return respond(suites);
    if (url.pathname === '/api/runs') return respond([]);
    if (url.pathname === '/api/categories') return respond([]);
    if (url.pathname.endsWith('/cases')) {
      return respond([{ id: url.pathname.includes(suites[0].id) ? 'case-a' : 'case-b', name: 'Draft case', code: 'original', enabled: true }]);
    }
    return respond({ error: 'Unexpected API request' }, 404);
  });
  await page.goto(base.href);
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  const editor = page.getByRole('textbox', { name: 'Test case code editor' });
  await editor.fill('unsaved draft');
  const dismiss = async action => {
    const shown = page.waitForEvent('dialog');
    const pending = action();
    const dialog = await shown;
    assert.equal(dialog.type(), 'confirm');
    await dialog.dismiss();
    await pending;
  };
  for (const name of ['New suite', 'New test case']) {
    await dismiss(() => page.getByRole('button', { name, exact: true }).click());
    assert.equal(await editor.inputValue(), 'unsaved draft');
    assert.equal(await page.getByRole('dialog').count(), 0);
  }
  await page.getByRole('button', { name: 'Lighthouse', exact: true }).click();
  await dismiss(() => page.getByLabel('Lighthouse target suite').selectOption(suites[1].id));
  assert.equal(await page.getByLabel('Lighthouse target suite').inputValue(), suites[0].id);
  await page.getByRole('button', { name: 'Playwright', exact: true }).click();
  assert.equal(await editor.inputValue(), 'unsaved draft');
  assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
  await editor.fill('original');
  assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByText('Signed out', { exact: true }).waitFor();
  assert.equal(logout, 1);
  assert.equal(mutations, 0);
  console.log('PASS: dirty creation, target switch, sign-out, unload guards; no stored suites touched');
} finally {
  await browser.close();
}
