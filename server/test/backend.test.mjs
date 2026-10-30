import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { allowlist, target, id, cursor, pagination } from '../validation.mjs';
import { hashSessionToken, randomToken } from '../auth.mjs';
import { createApp, attachWebSocket } from '../index.mjs';
import { Runner, checkTarget } from '../runner.mjs';
import { Store, databasePath } from '../store.mjs';

async function memoryStore(t) {
  const store = new Store(':memory:');
  await store.init();
  t.after(() => store.close());
  return store;
}

async function makeSession(store, { role = 'admin', email } = {}) {
  const user = await store.createUser({
    id: randomUUID(),
    name: 'Test ' + role,
    email: email ?? randomUUID() + '@example.test',
    passwordHash: 'not-used-for-session-tests',
    role,
  });
  const token = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  await store.createSession({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    csrfToken: csrf,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  });
  return { user, cookie: 'qa_session=' + token, csrf };
}

async function serve(t, app) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

function appFor(t, store, { origins = ['http://localhost'], allowRegistration = true } = {}) {
  const runner = new EventEmitter();
  runner.directory = () => tmpdir();
  return serve(t, createApp({ store, runner, origins, allowRegistration, cookieSecure: false })).then(({ url, server }) => ({ url, server, runner }));
}

function apiFetch(url, { cookie, csrf } = {}) {
  return (path, method = 'GET', body, withCsrf = true) => fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(withCsrf && csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('trust boundary rejects malformed IDs, origins and cursors', () => {
  assert.deepEqual(allowlist('http://localhost:1234,https://example.test'), ['http://localhost:1234', 'https://example.test']);
  assert.equal(databasePath(':memory:'), ':memory:');
  assert.equal(databasePath('sqlite:./data/qa.db'), resolve('data/qa.db'));
  assert.equal(databasePath('file:/tmp/qa.db'), '/tmp/qa.db');
  assert.throws(() => databasePath(''), /DATABASE_URL is required/);
  assert.throws(() => allowlist('https://example.test/path'));
  for (const value of ['file:///etc/passwd', 'http://bad.test', 'http://user:pass@localhost']) assert.throws(() => target(value, ['http://localhost']));
  assert.equal(target('http://localhost/path', ['http://localhost']), 'http://localhost/path');
  assert.throws(() => id('../foo')); assert.throws(() => cursor(-1)); assert.throws(() => cursor('nan'));
  assert.deepEqual(pagination({}), { limit: 50, offset: 0 });
  assert.deepEqual(pagination({ limit: '10', offset: '5' }), { limit: 10, offset: 5 });
  assert.throws(() => pagination({ limit: '-1' }), /limit/);
  assert.throws(() => pagination({ limit: '999' }), /limit/);
  assert.throws(() => pagination({ offset: '-1' }), /offset/);
  assert.throws(() => pagination({ offset: 'abc' }), /offset/);
});

test('account registration, login, cookies, CSRF and admin roles', async t => {
  const store = await memoryStore(t);
  const { url } = await appFor(t, store);
  const post = (path, body, headers = {}) => fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, ...headers },
    body: JSON.stringify(body),
  });

  assert.deepEqual(await (await fetch(url + '/api/auth')).json(), { authenticated: false });
  assert.equal((await fetch(url + '/api/suites')).status, 401);
  assert.equal((await post('/api/auth/register', { name: 'A', email: 'bad', password: 'long enough' })).status, 400);
  assert.equal((await post('/api/auth/register', { name: 'A', email: 'a@example.test', password: 'short' })).status, 400);

  const registered = await post('/api/auth/register', { name: 'Admin', email: 'Admin@Example.test', password: 'correct horse battery staple' });
  assert.equal(registered.status, 201);
  const adminBody = await registered.json();
  assert.equal(adminBody.authenticated, true);
  assert.equal(adminBody.user.role, 'admin');
  assert.equal(adminBody.user.email, 'admin@example.test');
  assert.ok(adminBody.csrfToken);
  assert.match(registered.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(registered.headers.get('set-cookie'), /SameSite=Lax/i);
  const adminCookie = registered.headers.get('set-cookie').split(';')[0];
  const adminCsrf = adminBody.csrfToken;

  assert.equal((await post('/api/auth/register', { name: 'Again', email: 'admin@example.test', password: 'correct horse battery staple' })).status, 409);
  assert.equal((await post('/api/auth/register', { name: 'Cross', email: 'cross@example.test', password: 'correct horse battery staple' }, { origin: 'https://outside.invalid' })).status, 403);

  const wrong = await post('/api/auth/login', { email: 'admin@example.test', password: 'wrong password' });
  assert.equal(wrong.status, 401);
  const login = await post('/api/auth/login', { email: 'ADMIN@example.test', password: 'correct horse battery staple' });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.user.id, adminBody.user.id);
  const loginCookie = login.headers.get('set-cookie').split(';')[0];
  const loginCsrf = loginBody.csrfToken;

  const status = await fetch(url + '/api/auth', { headers: { cookie: loginCookie } });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.authenticated, true);
  assert.equal(statusBody.user.role, 'admin');
  assert.equal(statusBody.csrfToken, loginCsrf);

  const admin = apiFetch(url, { cookie: loginCookie, csrf: loginCsrf });
  assert.equal((await admin('/api/suites', 'POST', { name: 'No csrf', targetUrl: 'http://localhost' }, false)).status, 403);
  const suite = await (await admin('/api/suites', 'POST', { name: 'Local', targetUrl: 'http://localhost' })).json();
  assert.ok(suite.id);

  const memberRegistered = await post('/api/auth/register', { name: 'Member', email: 'member@example.test', password: 'correct horse battery staple' });
  assert.equal(memberRegistered.status, 201);
  const memberBody = await memberRegistered.json();
  assert.equal(memberBody.user.role, 'member');
  const memberCookie = memberRegistered.headers.get('set-cookie').split(';')[0];
  const memberCsrf = memberBody.csrfToken;
  const member = apiFetch(url, { cookie: memberCookie, csrf: memberCsrf });
  assert.equal((await member('/api/users')).status, 403);
  assert.equal((await admin('/api/users')).status, 200);

  const promoted = await (await admin('/api/users/' + memberBody.user.id, 'PATCH', { role: 'admin' })).json();
  assert.equal(promoted.role, 'admin');
  assert.equal((await admin('/api/users/' + adminBody.user.id, 'DELETE')).status, 409);

  const logout = await admin('/api/auth/logout', 'POST');
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /qa_session=;/);
  const loggedOut = await (await fetch(url + '/api/auth', { headers: { cookie: loginCookie } })).json();
  assert.equal(loggedOut.authenticated, false);

  const expiredToken = randomToken();
  await store.createSession({
    tokenHash: hashSessionToken(expiredToken),
    userId: adminBody.user.id,
    csrfToken: randomToken(),
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(0).toISOString(),
  });
  assert.deepEqual(await (await fetch(url + '/api/auth', { headers: { cookie: 'qa_session=' + expiredToken } })).json(), { authenticated: false });
});

test('report index redirects once and serves authenticated assets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-report-route-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'docs')); await writeFile(join(dir, 'docs', 'index.html'), '<h1>Failure report</h1>');
  const store = await memoryStore(t);
  const { cookie } = await makeSession(store);
  const runner = new EventEmitter(), run = { id: randomUUID(), status: 'failed' };
  runner.directory = () => dir; await store.put('runs', run);
  const { url } = await serve(t, createApp({ store, runner, origins: [] }));
  const path = '/reports/' + run.id + '/docs', headers = { cookie };
  assert.equal((await fetch(url + path + '/')).status, 401);
  const redirect = await fetch(url + path, { headers, redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), path + '/');
  const page = await fetch(url + path + '/', { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Failure report/);
});

test('WebSocket replays ordered persisted logs and delivers live logs', async t => {
  const store = await memoryStore(t);
  const { cookie } = await makeSession(store);
  const runner = new EventEmitter(), run = { id: randomUUID(), status: 'running' };
  await store.put('runs', run);
  await store.log(run.id, { seq: 1, stream: 'stdout', text: 'one', at: 'now' });
  await store.log(run.id, { seq: 2, stream: 'stdout', text: 'two', at: 'now' });
  const { server, url } = await serve(t, (req, res) => res.end());
  const wss = attachWebSocket(server, { store, runner });
  t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); });
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } });
  await once(ws, 'open'); t.after(() => ws.terminate());
  const received = []; ws.on('message', data => received.push(JSON.parse(data)));
  const replay = new Promise(resolve => ws.on('message', data => { if (JSON.parse(data).type === 'replay-complete') resolve(); }));
  ws.send(JSON.stringify({ type: 'subscribe', runId: run.id, after: 1 })); await replay;
  assert.deepEqual(received.filter(x => x.type === 'log').map(x => x.seq), [2]);
  const live = once(ws, 'message'); runner.emit('log', { type: 'log', runId: run.id, seq: 3, text: 'three' });
  assert.equal(JSON.parse((await live)[0]).seq, 3);
});

test('closed subscription does not attach runner listeners after database lookup', async t => {
  const runner = new EventEmitter(); let release, entered;
  const lookup = new Promise(r => release = r), started = new Promise(r => entered = r);
  const store = {
    getSession: async () => ({ csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000).toISOString(), user: { id: randomUUID(), role: 'admin' } }),
    get: async () => { entered(); await lookup; return { id: randomUUID() }; },
    logs: async () => ({ logs: [], hasMore: false, nextAfter: 0 }),
  };
  const { server, url } = await serve(t, (req, res) => res.end());
  const wss = attachWebSocket(server, { store, runner }); t.after(() => wss.close());
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { headers: { Cookie: 'qa_session=test' } });
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'subscribe', runId: randomUUID() })); await started;
  const closed = once([...wss.clients][0], 'close'); ws.close(); await closed; release(); await new Promise(setImmediate);
  assert.equal(runner.listenerCount('log'), 0);
  assert.equal(runner.listenerCount('status'), 0);
});

test('patch updates only an existing row and rolls back invalid changes', async t => {
  const store = await memoryStore(t);
  const suite = { id: randomUUID(), name: 'current', createdAt: new Date().toISOString() };
  await store.put('suites', suite);
  assert.deepEqual(await store.patch('suites', suite.id, old => ({ ...old, name: 'new' })), { ...suite, name: 'new' });
  assert.equal((await store.get('suites', suite.id)).name, 'new');
  assert.equal(await store.patch('suites', randomUUID(), () => assert.fail('missing row must not transform')), undefined);
  await assert.rejects(store.patch('suites', suite.id, () => { throw new Error('invalid'); }), /invalid/);
  assert.equal((await store.get('suites', suite.id)).name, 'new');
});

test('startup recovery separates execution and report interruption', async t => {
  const store = await memoryStore(t);
  const running = { id: randomUUID(), status: 'running', docsStatus: 'building' };
  const generating = { id: randomUUID(), status: 'passed', docsStatus: 'building' };
  const finished = { id: randomUUID(), status: 'passed', docsStatus: 'built' };
  for (const run of [running, generating, finished]) await store.put('runs', run);
  await store.init();
  const interrupted = await store.get('runs', running.id);
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.docsStatus, 'interrupted');
  assert.match(interrupted.error, /restarted/); assert.ok(interrupted.finishedAt);
  const reportOnly = await store.get('runs', generating.id);
  assert.equal(reportOnly.status, 'passed'); assert.equal(reportOnly.docsStatus, 'interrupted');
  assert.match(reportOnly.docsError, /report generation/); assert.equal(reportOnly.finishedAt, undefined);
  assert.deepEqual(await store.get('runs', finished.id), finished);
});

test('redirect preflight blocks unapproved origins without following them', async t => {
  const { url } = await serve(t, (req, res) => { res.writeHead(302, { location: 'https://not-allowlisted.invalid' }); res.end(); });
  await assert.rejects(checkTarget(url, [url]), /not allowlisted/);
});

test('runner captures process output and cancellation kills child', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await memoryStore(t);
  const runner = new Runner(store, { runsDir: dir, docs: false, timeout: 5000 });
  const run = { id: randomUUID(), status: 'running' }, state = { run, seq: 0, chain: Promise.resolve(), cancelled: false };
  await store.put('runs', run);
  runner.active = state;
  await mkdir(join(dir, run.id)); await writeFile(join(dir, run.id, 'logs.txt'), '');
  const logged = once(runner, 'log');
  const command = runner.command(state, ['-e', 'console.log("ready");setInterval(()=>{},1000)']);
  await logged; assert.equal(await runner.cancel(run.id), true); await command; await state.chain;
  const result = await store.logsRaw(run.id, 0);
  assert.match(result[0].text, /ready/); assert.equal(state.cancelled, true);
});

test('real Playwright executes generated TypeScript case and CommonJS fixture', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-playwright-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url } = await serve(t, (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Local QA</title>'); });
  const store = await memoryStore(t);
  const runner = new Runner(store, { runsDir: dir, origins: [url], docs: false, timeout: 30000 });
  const run = { id: randomUUID(), targetUrl: url, mode: 'pw', headed: false, status: 'queued' };
  await store.put('runs', run);
  await runner.start(run, [{ id: randomUUID(), code: "import {test,expect} from '@playwright/test'; test('generated fixture loads', async()=> { const n: number=2; expect(n).toBe(2); });" }]);
  const result = await store.get('runs', run.id);
  const allLogs = await store.logsRaw(run.id, 0);
  assert.equal(result.status, 'passed', allLogs.map(x => x.text).join(''));
  assert.equal(result.summary.passed, 1); assert.ok(result.artifacts.includes('playwright.json'));
});

test('SQLite data persists across connections and merges concurrent patches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-sqlite-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'qa.db');
  const first = new Store('sqlite:' + file); await first.init();
  const suite = { id: randomUUID(), name: 'persistence', createdAt: new Date().toISOString() };
  await first.put('suites', suite); await first.close();
  const second = new Store('sqlite:' + file); await second.init(); t.after(() => second.close());
  assert.deepEqual(await second.get('suites', suite.id), suite);
  await Promise.all([second.patch('suites', suite.id, old => ({ ...old, name: 'renamed' })), second.patch('suites', suite.id, old => ({ ...old, description: 'concurrent edit' }))]);
  const merged = await second.get('suites', suite.id);
  assert.equal(merged.name, 'renamed'); assert.equal(merged.description, 'concurrent edit');
  await second.delete('suites', suite.id);
  assert.equal(await second.patch('suites', suite.id, old => ({ ...old, name: 'resurrected' })), undefined);
  assert.equal(await second.get('suites', suite.id), undefined);
});

test('category CRUD and suite categoryId lifecycle', async t => {
  const store = await memoryStore(t);
  const { url } = await appFor(t, store);
  const { cookie, csrf } = await makeSession(store);
  const call = apiFetch(url, { cookie, csrf });
  const cat = await (await call('/api/categories', 'POST', { name: 'Frontend', description: 'Web tests' })).json();
  assert.ok(cat.id); assert.equal(cat.name, 'Frontend');
  const cats = await (await call('/api/categories')).json();
  assert.equal(cats.length, 1);
  assert.equal((await (await call('/api/categories/' + cat.id)).json()).name, 'Frontend');
  const updated = await (await call('/api/categories/' + cat.id, 'PATCH', { name: 'Frontend v2' })).json();
  assert.equal(updated.name, 'Frontend v2');
  const suite = await (await call('/api/suites', 'POST', { name: 'CatSuite', targetUrl: 'http://localhost', categoryId: cat.id })).json();
  assert.equal(suite.categoryId, cat.id);
  assert.equal((await call('/api/suites', 'POST', { name: 'Bad', targetUrl: 'http://localhost', categoryId: randomUUID() })).status, 400);
  assert.equal((await call('/api/categories/' + cat.id, 'DELETE')).status, 204);
  assert.equal((await fetch(url + '/api/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Unauth' }) })).status, 401);
});

test('run pagination returns correct slices and X-Total-Count', async t => {
  const store = await memoryStore(t);
  const { url } = await appFor(t, store);
  const { cookie, csrf } = await makeSession(store);
  const call = apiFetch(url, { cookie, csrf });
  for (let i = 0; i < 3; i++) await store.put('runs', { id: randomUUID(), status: 'passed', createdAt: new Date(Date.now() + i * 1000).toISOString() });
  const r1 = await call('/api/runs?limit=1&offset=0');
  const data1 = await r1.json();
  assert.equal(data1.length, 1);
  assert.equal(r1.headers.get('X-Total-Count'), '3');
  const r2 = await call('/api/runs?limit=1&offset=1');
  const data2 = await r2.json();
  assert.equal(data2.length, 1);
  assert.notEqual(data1[0].id, data2[0].id);
  assert.equal((await call('/api/runs?limit=-1')).status, 400);
  assert.equal((await call('/api/runs?offset=-1')).status, 400);
  assert.equal((await call('/api/runs?offset=abc')).status, 400);
});

test('log limit and download endpoint', async t => {
  const store = await memoryStore(t);
  const run = { id: randomUUID(), status: 'passed', createdAt: new Date().toISOString() };
  await store.put('runs', run);
  for (let i = 1; i <= 10; i++) await store.log(run.id, { seq: i, text: 'line ' + i + '\n', stream: 'stdout', at: new Date().toISOString() });
  const result = await store.logs(run.id, 0);
  assert.equal(result.logs.length, 10);
  assert.equal(result.hasMore, false);
  const limited = await store.logs(run.id, 0, 3);
  assert.equal(limited.logs.length, 3);
  assert.equal(limited.hasMore, true);
  assert.equal(limited.nextAfter, 3);
  const text = await store.logsText(run.id);
  assert.match(text, /line 1/);
  assert.match(text, /line 10/);
});

test('category CRUD with real SQLite store', async t => {
  const store = await memoryStore(t);
  const cat = { id: randomUUID(), name: 'Backend', description: 'API tests', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put('categories', cat);
  assert.deepEqual(await store.get('categories', cat.id), cat);
  const suite = { id: randomUUID(), name: 'APISuite', categoryId: cat.id, createdAt: new Date().toISOString() };
  await store.put('suites', suite);
  assert.equal((await store.get('suites', suite.id)).categoryId, cat.id);
  await store.deleteCategory(cat.id);
  assert.equal(await store.get('categories', cat.id), undefined);
  const updatedSuite = await store.get('suites', suite.id);
  assert.equal(updatedSuite.categoryId, null);
  assert.equal(updatedSuite.name, 'APISuite');
});
