import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import Reporter from './pw-reporter.mjs';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runDir = await mkdtemp(join(tmpdir(), 'run-docs-test-'));
const hostile = '<script>alert("MDX")</script>{process.exit(42)}';
async function put(path, data) {
  await mkdir(dirname(join(runDir, path)), {recursive: true});
  await writeFile(join(runDir, path), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
try {
  await put('run.json', {id: 'synthetic', status: 'failed', steps: [{name: 'playwright', exitCode: 1}], error: hostile, cases: [{code: 'SECRET_SOURCE_SENTINEL'}]});
  await put('logs.txt', 'Runner error: ' + hostile);
  const reporter = new Reporter({outputFile: join(runDir, 'artifacts/pw/langkah.json')});
  const isolated = new Reporter({outputFile: join(runDir, 'isolated.json')});
  assert.equal(new Reporter().outputFile, join('pw-out', 'langkah.json'));
  reporter.onTestEnd({id: 'nested', titlePath: () => ['chromium', 'Nested API test'], location: {file: 'nested.spec.ts', line: 12}, parent: {project: () => ({name: 'chromium'})}}, {status: 'failed', retry: 1, duration: 42, steps: [{title: 'outer', steps: [{title: 'locator.click nested', category: 'pw:api', location: {file: 'nested.spec.ts', line: 17, column: 3}, error: {message: 'Nested API error'}}]}]});
  reporter.onEnd();
  isolated.onEnd();
  assert.deepEqual(JSON.parse(await readFile(join(runDir, 'isolated.json'), 'utf8')), {tests: []});
  assert.equal(JSON.parse(await readFile(join(runDir, 'artifacts/pw/langkah.json'), 'utf8')).tests[0].steps[0].steps[0].location.line, 17);
  await put('artifacts/pw/results.json', {suites: [{title: 'checkout', specs: [{title: hostile, file: 'checkout.spec.ts', line: 8, tests: [{projectName: 'chromium', expectedStatus: 'passed', status: 'unexpected', results: [{status: 'failed', duration: 10, errors: [{message: 'Locator not visible'}], steps: [{title: 'outer', steps: [{title: 'Click checkout', error: {message: hostile}}]}]}]}]}]}], errors: [{message: 'Browser launch warning'}]});
  await put('artifacts/lh/report.json', {finalUrl: 'https://example.test/', fetchTime: '2026-10-20T00:00:00Z', categories: {performance: {title: 'Performance', score: 0.6}}, audits: {contrast: {id: 'contrast', title: 'Contrast failure', score: 0, description: hostile, details: {items: [{node: {snippet: '<button>Pay</button>'}}]}}, success: {id: 'success', title: 'Passing audit', score: 1}}});
  await put('artifacts/pw/report/index.html', '<!doctype html><title>Native report</title>');
  await put('artifacts/pw/report/data/trace.zip', Buffer.from([80, 75, 3, 4]));
  await put('artifacts/pw/screen shot.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await put('artifacts/broken.json', '{');
  await put('docs/stale.txt', 'must not survive rebuild');
  await put('source/private.txt', 'SECRET_SOURCE_SENTINEL');
  await symlink(join(runDir, 'source'), join(runDir, 'artifacts/source-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/build-run-docs.mjs'), runDir], {cwd: root, stdio: 'inherit', env: {...process.env, REPORT_BASE_URL: '/runs/synthetic/docs/'}});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error('Build exited ' + code)));
  });
  const html = await readFile(join(runDir, 'docs/index.html'), 'utf8');
  assert(html.includes('Failure-first summary'));
  assert(html.includes('locator.click nested'));
  assert(html.includes('nested.spec.ts:17:3'));
  assert(html.includes('Nested API error'));
  assert(html.includes('60/100'));
  assert(html.includes('Prioritized audit failures'));
  assert(html.includes('<details><summary>Show native runner logs</summary>'));
  const tar = spawnSync('tar', ['-tzf', join(runDir, 'docs/downloads/artifacts.tar.gz')], {shell: false, encoding: 'utf8'});
  if (tar.error?.code === 'ENOENT') {
    assert(html.includes('Bundle unavailable'));
    assert(!html.includes('href="downloads/artifacts.tar.gz"'));
  } else {
    assert.equal(tar.status, 0, tar.stderr);
    assert(tar.stdout.includes('artifacts/pw/langkah.json'));
    assert(tar.stdout.includes('logs.txt'));
    assert(!tar.stdout.includes('run.json'));
    assert(!tar.stdout.includes('isolated.json'));
    assert(!tar.stdout.includes('source-link'));
    assert(html.includes('href="downloads/artifacts.tar.gz"'));
  }
  assert(html.includes('Failed step: '));
  assert(html.includes('Click checkout'));
  assert(html.includes('Locator not visible'));
  assert(html.includes('Contrast failure'));
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes('<script>alert('));
  assert(!html.includes('SECRET_SOURCE_SENTINEL'));
  assert(!(await readdir(join(runDir, 'docs/artifacts'))).includes('run.json'));
  assert(html.includes('artifacts/artifacts/pw/screen%20shot.png'));
  assert(html.includes('artifacts/artifacts/pw/report/index.html'));
  assert(html.includes('playwright show-trace'));
  assert(html.includes('Native HTML report downloads'));
  assert(html.includes('interactive native viewers may not work here'));
  assert(html.includes('<style>'));
  assert(!/<img\b/i.test(html));
  assert(!/<script\b/i.test(html));
  assert(!/<link\b[^>]*rel="stylesheet"/i.test(html));
  assert(!html.includes('Your Docusaurus site did not load properly'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-downloads; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
    res.writeHead(req.url === '/' ? 200 : 401);
    res.end(req.url === '/' ? html : '{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    const assetRequests = [];
    page.on('request', request => {if (['stylesheet', 'script'].includes(request.resourceType())) assetRequests.push(request.url());});
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(assetRequests, []);
    assert(await page.locator('h1').isVisible());
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth), '1100px');
    await page.locator('summary').first().click();
    assert(await page.locator('details').first().evaluate(element => element.open));
    assert(!(await page.locator('body').innerText()).includes('Your Docusaurus site did not load properly'));
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
  assert(html.includes('broken.json'));
  assert.deepEqual(await readFile(join(runDir, 'docs/artifacts/artifacts/pw/report/data/trace.zip')), Buffer.from([80, 75, 3, 4]));
  assert(!(await readdir(join(runDir, 'docs'))).includes('stale.txt'));
  assert.equal(await readFile(join(runDir, 'logs.txt'), 'utf8'), 'Runner error: ' + hostile);
  await new Promise((done, reject) => {
    const env = {...process.env, REPORT_BASE_URL: '/runs/synthetic/docs/'};
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = join(runDir, 'no-tools');
    const child = spawn(process.execPath, [join(root, 'scripts/build-run-docs.mjs'), runDir], {cwd: root, stdio: 'inherit', env});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error('Missing-tar build exited ' + code)));
  });
  const fallback = await readFile(join(runDir, 'docs/index.html'), 'utf8');
  assert(fallback.includes('Bundle unavailable'));
  assert(fallback.includes('Artifact bundle unavailable'));
  assert(!fallback.includes('href="downloads/artifacts.tar.gz"'));
  await assert.rejects(readFile(join(runDir, 'docs/downloads/artifacts.tar.gz')), {code: 'ENOENT'});
  console.log('PASS: real production builds, recursive isolated reporter, failure summaries, locations, compact scores, escaping, native artifacts, archive contents, missing-tar fallback, stale output removal');
} finally {
  await rm(runDir, {recursive: true, force: true});
}
