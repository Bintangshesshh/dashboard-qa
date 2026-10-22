// Test backend Playbook v5 (docs/PRD.md §7). Jalankan: npm test
// Menggantikan berkas lama yang masih memakai skema v4 (suites/cases/categories).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allowlist, target, id, cursor, authorized, rangeDays, isoTimestamp, bool } from '../validation.mjs';
import { createApp } from '../index.mjs';
import { Store, databasePath } from '../store.mjs';
import { Runner } from '../runner.mjs';

const scrypt = promisify(_scrypt);
const PASSWORD = 'rahasia-test-123';
const ORIGIN = 'http://127.0.0.1:4173';

async function hash(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function fixture(t) {
  const store = new Store(':memory:');
  await store.init();
  const user = { id: randomUUID(), username: 'tester', role: 'admin' };
  store.createUser({ ...user, passwordHash: await hash(PASSWORD) });
  store.db.prepare(`INSERT INTO projects (id, slug, name, base_url, staging_url, local_url, origins, allow_production, active, created_at)
    VALUES ('p1','ebh','EBH',?,?,?,'[]',0,1,?)`)
    .run('https://ebh.test', 'https://staging.ebh.test', ORIGIN, new Date().toISOString());

  const runner = {
    runsDir: await mkdtemp(join(tmpdir(), 'pb-runs-')),
    start() {},
    async cancel() { return true; },
  };
  const app = createApp({ store, runner, token: null, origins: [ORIGIN, 'https://ebh.test', 'https://staging.ebh.test'] });
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    server.closeAllConnections();
    server.close();
    store.close();
    await rm(runner.runsDir, { recursive: true, force: true });
  });

  const call = async (path, { method = 'GET', cookie, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: base,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };

  const login = async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const raw = res.headers.get('set-cookie').split(';')[0];
    return raw;
  };

  return { store, user, runner, app, server, base, call, login };
}

test('trust boundary menolak ID, origin, cursor, timestamp, boolean ngawur', () => {
  assert.deepEqual(allowlist('http://localhost:1234,https://example.test'), ['http://localhost:1234', 'https://example.test']);
  assert.equal(databasePath(':memory:'), ':memory:');
  assert.equal(databasePath('sqlite:./data/qa.db'), resolve('data/qa.db'));
  assert.throws(() => databasePath(''), /DATABASE_URL is required/);
  assert.throws(() => allowlist('https://example.test/path'));
  for (const value of ['file:///etc/passwd', 'http://bad.test', 'http://user:pass@localhost']) assert.throws(() => target(value, ['http://localhost']));
  assert.equal(target('http://localhost/path', ['http://localhost']), 'http://localhost/path');
  assert.throws(() => id('../foo'));
  assert.throws(() => cursor(-1));
  assert.throws(() => cursor('nan'));
  assert.throws(() => rangeDays({ range: 0 }));
  assert.throws(() => isoTimestamp('bukan-tanggal'));
  assert.throws(() => bool('ya', 'x'));
  assert.equal(authorized('abc', 'abc'), true);
  assert.equal(authorized('abc', 'abd'), false);
});

test('login, /api/me, logout, dan penolakan password salah', async t => {
  const f = await fixture(t);
  let r = await f.call('/api/auth/login', { method: 'POST', body: { username: 'tester', password: 'salah-sekali' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Username atau password salah');

  const cookie = await f.login();
  r = await f.call('/api/me', { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.username, 'tester');
  assert.equal(r.body.role, 'admin');

  r = await f.call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(r.status, 200);
  r = await f.call('/api/me', { cookie });
  assert.equal(r.status, 401);
});

test('mutasi cookie lintas origin ditolak, bearer CLI lolos', async t => {
  const f = await fixture(t);
  const cookie = await f.login();

  let r = await f.call('/api/auth/logout', { method: 'POST', cookie, headers: { origin: 'http://evil.test' } });
  assert.equal(r.status, 403);

  r = await f.call('/api/auth/logout', { method: 'POST', cookie, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);

  r = await f.call('/api/auth/login', { method: 'POST', body: { username: 'tester', password: PASSWORD }, headers: { origin: 'http://evil.test' } });
  assert.equal(r.status, 403);

  r = await f.call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(r.status, 200);
});

test('sesi: production diblokir tanpa flag, reuse mengembalikan 409', async t => {
  const f = await fixture(t);
  const cookie = await f.login();

  let r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'production' } });
  assert.equal(r.status, 403);

  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(r.status, 201);
  const first = r.body.sessionId;
  assert.equal(r.body.targetUrl, ORIGIN);

  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.sessionId, first);
  assert.equal(r.body.reuse, true);
});

test('run: 409 saat sudah ada run belum final, 429 saat antrean penuh', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });

  let r = await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } });
  assert.equal(r.status, 202);

  r = await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } });
  assert.equal(r.status, 409);

  f.store.setSetting('max_queue_length', '0');
  f.store.db.prepare("UPDATE runs SET status='passed'").run();
  r = await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } });
  assert.equal(r.status, 429);
});

test('PATCH run: status di-whitelist, finalisasi set finalized_at + stale', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const runId = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;
  f.store.createReport({ id: 'rep1', sessionId: session, scope: 'pw', runIds: [runId], builtBy: f.user.id });
  f.store.patchReport('rep1', { status: 'ready', path: 'index.html' });

  let r = await f.call(`/api/runs/${runId}`, { method: 'PATCH', cookie, body: { status: 'ngawur' } });
  assert.equal(r.status, 400);

  r = await f.call(`/api/runs/${runId}`, { method: 'PATCH', cookie, body: { status: 'failed', exitCode: 1, results: [{ file: 'a.spec.ts', title: 'TC-1', status: 'failed' }] } });
  assert.equal(r.status, 200);
  assert.ok(r.body.finalized_at);
  assert.equal(r.body.exit_code, 1);
  assert.equal(f.store.getReport('rep1').status, 'stale');
  assert.equal(f.store.listPlaywrightResults(runId).length, 1);

  const finalized = r.body.finalized_at;
  r = await f.call(`/api/runs/${runId}`, { method: 'PATCH', cookie, body: { status: 'passed' } });
  assert.equal(r.body.finalized_at, finalized, 'finalized_at tidak boleh ditimpa');

  r = await f.call(`/api/runs/${runId}`, { method: 'PATCH', cookie, body: { finishedAt: 'bukan-tanggal' } });
  assert.equal(r.status, 400);
});

test('hapus run & sesi ikut menghapus folder artifact', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const runId = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;

  const runDir = join(f.runner.runsDir, runId);
  await mkdir(join(runDir, 'artifacts'), { recursive: true });
  await writeFile(join(runDir, 'artifacts', 'report.json'), '{}');

  // run belum final → 409, folder utuh
  let r = await f.call(`/api/runs/${runId}`, { method: 'DELETE', cookie });
  assert.equal(r.status, 409);
  assert.ok(existsSync(runDir));

  f.store.patchRun(runId, { status: 'passed', finalized_at: new Date().toISOString() });
  r = await f.call(`/api/runs/${runId}`, { method: 'DELETE', cookie });
  assert.equal(r.status, 204);
  assert.equal(existsSync(runDir), false, 'folder run harus terhapus');

  // hapus sesi dengan run baru
  const run2 = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;
  const dir2 = join(f.runner.runsDir, run2);
  await mkdir(dir2, { recursive: true });
  f.store.patchRun(run2, { status: 'failed', finalized_at: new Date().toISOString() });
  r = await f.call(`/api/sessions/${session}`, { method: 'DELETE', cookie });
  assert.equal(r.status, 204);
  assert.equal(existsSync(dir2), false, 'folder run dalam sesi harus terhapus');
});

test('log per run dipotong tengah sesuai log_max_bytes', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const runId = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;
  f.store.setSetting('log_max_bytes', '2000');

  let seq = 0;
  const push = text => f.store.log(runId, { seq: ++seq, stream: 'stdout', text, at: new Date().toISOString() });
  push('HEAD\n');
  for (let i = 0; i < 300; i++) push(`baris-${i}-${'x'.repeat(40)}\n`);
  push('TAIL\n');

  const text = await f.store.logsText(runId);
  assert.ok(text.length <= 2100, `log harus terpotong, dapat ${text.length}`);
  assert.ok(text.startsWith('HEAD'));
  assert.ok(text.endsWith('TAIL\n'));
  assert.match(text, /baris dipotong/);

  const rows = f.store.logsRaw(runId);
  const seqs = rows.map(r => r.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);

  const page = f.store.logs(runId, 0, 5);
  assert.equal(page.logs.length, 5);
  assert.equal(page.hasMore, true);
});

test('quick-check: 400 tanpa projectId/env, 202 dengan 2 run, production diblokir', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const started = [];
  f.runner.start = (runId, testFile) => { started.push({ runId, tool: testFile.tool }); return Promise.resolve(); };

  let r = await f.call('/api/quick-check', { method: 'POST', cookie, body: {} });
  assert.equal(r.status, 400);

  r = await f.call('/api/quick-check', { method: 'POST', cookie, body: { projectId: 'p1', env: 'production' } });
  assert.equal(r.status, 403);

  r = await f.call('/api/quick-check', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(r.status, 202);
  assert.equal(r.body.runIds.length, 2);
  const runs = f.store.listRunsBySession(r.body.sessionId);
  assert.deepEqual(runs.map(x => x.tool).sort(), ['lh', 'pw']);
  assert.equal(runs.every(x => x.test_file_id === null), true, 'quick check tidak memakai test_files');
  await new Promise(res => setImmediate(res));
  assert.deepEqual(started.map(s => s.tool), ['pw', 'lh']);
});

test('CLI token: dibuat, terdaftar tanpa nilai plain, lalu dicabut', async t => {
  const f = await fixture(t);
  const cookie = await f.login();

  let r = await f.call('/api/auth/cli-token', { method: 'POST', cookie, body: { label: 'laptop-kerja' } });
  assert.equal(r.status, 201);
  const { id, token } = r.body;
  assert.ok(token && token.length === 64, 'token plain hanya sekali');

  r = await f.call('/api/auth/cli-token', { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].id, id);
  assert.equal(r.body[0].label, 'laptop-kerja');
  assert.equal(r.body[0].revoked_at, null);
  assert.equal(JSON.stringify(r.body).includes(token), false, 'token plain tidak boleh ikut terdaftar');

  // token bisa dipakai sebagai bearer
  r = await f.call('/api/me', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200);
  r = await f.call('/api/auth/cli-token', { cookie });
  assert.ok(r.body[0].last_used_at, 'last_used_at harus terisi setelah dipakai');

  r = await f.call(`/api/auth/cli-token/${id}`, { method: 'DELETE', cookie });
  assert.equal(r.status, 204);
  r = await f.call('/api/me', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.status, 401, 'token yang dicabut harus ditolak');
});

test('CLI lokal: local → start → logs → upload artifact → finalisasi', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'test("x",()=>{})' });

  let r = await f.call('/api/runs/local', { method: 'POST', cookie, body: { testFileId: 'tf1', env: 'local' } });
  assert.equal(r.status, 201);
  const { runId, sessionId, code, targetUrl, tool } = r.body;
  assert.equal(code, 'test("x",()=>{})');
  assert.equal(targetUrl, ORIGIN);
  assert.equal(tool, 'pw');
  assert.ok(runId && sessionId);

  // sesi dipakai ulang untuk project+env+user yang sama
  r = await f.call('/api/runs/local', { method: 'POST', cookie, body: { testFileId: 'tf1', env: 'local' } });
  assert.equal(r.status, 409, 'sesi masih punya run belum final');

  r = await f.call(`/api/runs/${runId}/start`, { method: 'POST', cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'running');
  assert.ok(r.body.started_at);

  r = await f.call(`/api/runs/${runId}/logs`, {
    method: 'POST', cookie,
    body: { entries: [{ seq: 1, stream: 'stdout', text: 'mulai\n', at: new Date().toISOString() }] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.inserted, 1);

  r = await f.call(`/api/runs/${runId}/artifacts?kind=pw-json&path=report.json`, {
    method: 'PUT', cookie, body: { a: 1 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.path, 'report.json');

  r = await f.call(`/api/runs/${runId}/artifacts?kind=pw-json&path=..%2Fescape.json`, { method: 'PUT', cookie, body: { a: 1 } });
  assert.equal(r.status, 400);

  r = await f.call(`/api/runs/${runId}`, { method: 'PATCH', cookie, body: { status: 'passed', exitCode: 0 } });
  assert.equal(r.status, 200);
  assert.ok(r.body.finalized_at);

  const run = f.store.getRun(runId);
  assert.equal(run.status, 'passed');
  assert.equal(f.store.listArtifacts(runId).length, 1);
  assert.equal((await f.store.logsText(runId)), 'mulai\n');
});

test('GET run memisahkan console & network dari logs', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const runId = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;

  const at = new Date().toISOString();
  f.store.logsBatch(runId, [
    { seq: 1, stream: 'stdout', text: 'mulai\n', at },
    { seq: 2, stream: 'console', text: JSON.stringify({ type: 'error', text: 'boom', location: 'app.js:1' }), at },
    { seq: 3, stream: 'network', text: JSON.stringify({ url: '/x', method: 'GET', status: 500 }), at },
    { seq: 4, stream: 'console', text: 'teks mentah', at },
  ]);

  const r = await f.call(`/api/runs/${runId}`, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.console.length, 2);
  assert.equal(r.body.console[0].type, 'error');
  assert.equal(r.body.console[0].text, 'boom');
  assert.equal(r.body.console[1].text, 'teks mentah', 'baris non-JSON tetap terbaca');
  assert.equal(r.body.network.length, 1);
  assert.equal(r.body.network[0].status, 500);
  assert.equal(r.body.network[0].url, '/x');
  assert.equal(r.body.results.length, 0);
});

test('artifact: traversal ditolak, file sah disajikan dengan header aman', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const runId = (await f.call(`/api/sessions/${session}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf1' } })).body.runId;

  const dir = join(f.runner.runsDir, runId, 'artifacts');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'report.json'), '{"ok":true}');

  let r = await f.call(`/artifacts/${runId}/report.json`, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');

  r = await f.call(`/artifacts/${runId}/..%2F..%2Fpackage.json`, { cookie });
  assert.equal(r.status, 400);

  r = await f.call(`/artifacts/${runId}/report.json`);
  assert.equal(r.status, 401);
});

test('parseLighthouse: banyak LHR URL sama → satu baris per URL', async () => {
  const { Runner } = await import('../runner.mjs');
  const runsDir = await mkdtemp(join(tmpdir(), 'pb-lh-'));
  const dir = join(runsDir, 'run1');
  const artifacts = join(dir, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const lhr = (perf, url) => JSON.stringify({
    finalUrl: url,
    categories: { performance: { score: perf }, accessibility: { score: 0.9 }, 'best-practices': { score: 0.8 }, seo: { score: 1 } },
    audits: { 'largest-contentful-paint': { numericValue: 1200 } },
  });
  // numberOfRuns: 3 → tiga LHR untuk URL yang sama.
  await writeFile(join(artifacts, 'lhr-1.json'), lhr(0.5, 'https://a.test/'));
  await writeFile(join(artifacts, 'lhr-2.json'), lhr(0.7, 'https://a.test/'));
  await writeFile(join(artifacts, 'lhr-3.json'), lhr(0.9, 'https://a.test/'));
  await writeFile(join(artifacts, 'lhr-4.json'), lhr(0.4, 'https://a.test/login'));
  await writeFile(join(artifacts, 'manifest.json'), JSON.stringify([
    { url: 'https://a.test/', htmlPath: join(artifacts, 'lhr-1.html') },
    { url: 'https://a.test/', htmlPath: join(artifacts, 'lhr-3.html') },
  ]));

  const runner = new Runner({}, { runsDir });
  const rows = await runner.parseLighthouse(dir);

  assert.equal(rows.length, 2, 'satu baris per URL unik');
  const home = rows.find(r => r.url === 'https://a.test/');
  assert.equal(home.performance, 0.9, 'run terakhir yang menang');
  assert.equal(home.reportPath, 'lhr-3.html');
  assert.equal(rows.find(r => r.url === 'https://a.test/login').performance, 0.4);
  await rm(runsDir, { recursive: true, force: true });
});

test('warningLines: runWarnings LH jadi baris log system', async () => {
  const { warningLines } = await import('../runner.mjs');
  const rows = [
    { url: 'https://a.test/', warnings: JSON.stringify(['warn satu', { code: 'X' }]) },
    { url: 'https://b.test/', warnings: 'bukan json' },
    { url: 'https://c.test/', warnings: null },
  ];
  const lines = warningLines(rows);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '[lh] https://a.test/: warn satu\n');
  assert.equal(lines[1], '[lh] https://a.test/: {"code":"X"}\n');
  assert.equal(lines[2], '[lh] https://b.test/: bukan json\n');
  assert.deepEqual(warningLines([]), []);
  assert.deepEqual(warningLines(null), []);
});

test('lhConfig: URL sesi didahulukan, dedupe, budget jadi assertion warn', async () => {
  const { lhConfig } = await import('../runner.mjs');
  const cfg = {
    urls: ['https://prod.test/', 'https://staging.test/'],
    numberOfRuns: 2,
    budgets: { 'categories:performance': { minScore: 0.8 } },
  };
  const text = lhConfig(cfg, 'https://staging.test/', 'D:\\runs\\abc\\artifacts');
  assert.match(text, /^module\.exports = /);
  const parsed = JSON.parse(text.replace(/^module\.exports = /, '').replace(/;\n$/, ''));
  assert.deepEqual(parsed.ci.collect.url, ['https://staging.test/', 'https://prod.test/'], 'URL sesi dulu, duplikat dibuang');
  assert.equal(parsed.ci.collect.numberOfRuns, 2);
  assert.deepEqual(parsed.ci.assert.assertions['categories:performance'], ['warn', { minScore: 0.8 }]);
  assert.equal(parsed.ci.upload.outputDir, 'D:/runs/abc/artifacts', 'backslash dinormalisasi');

  assert.throws(() => lhConfig({ urls: [] }, null, 'x'), /Tidak ada URL/);
  const minimal = lhConfig(null, 'https://a.test/', 'out');
  assert.equal(JSON.parse(minimal.replace(/^module\.exports = /, '').replace(/;\n$/, '')).ci.collect.numberOfRuns, 1);
});

test('recover: run uploading > 24 jam dibersihkan, yang baru hanya interrupted', async t => {
  const f = await fixture(t);
  const session = (await f.call('/api/sessions', { method: 'POST', cookie: await f.login(), body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf1', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  for (const [id, started] of [['r-old', old], ['r-new', fresh]]) {
    f.store.createRun({ id, sessionId: session, testFileId: 'tf1', tool: 'pw' });
    f.store.patchRun(id, { status: 'uploading', started_at: started });
    f.store.addArtifact({ runId: id, kind: 'pw-json', path: 'report.json', bytes: 10 });
  }

  const stale = f.store.recover();

  assert.deepEqual(stale, ['r-old'], 'hanya run > 24 jam yang dilaporkan untuk hapus folder');
  assert.equal(f.store.getRun('r-old').status, 'interrupted');
  assert.match(f.store.getRun('r-old').error, /24 jam/);
  assert.equal(f.store.getRun('r-new').status, 'interrupted', 'run baru tetap interrupted karena restart');
  assert.match(f.store.getRun('r-new').error, /Server restarted/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE run_id=?').get('r-old').n, 0);
});

test('GET /api/sessions: ringkasan run per tool, gagal, dan aktif', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf-pw', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  f.store.createTestFile({ id: 'tf-lh', projectId: 'p1', tool: 'lh', path: 'lh.js', label: 'L', code: 'x' });

  f.store.createRun({ id: 'r1', sessionId: session, testFileId: 'tf-pw', tool: 'pw' });
  f.store.createRun({ id: 'r2', sessionId: session, testFileId: 'tf-pw', tool: 'pw' });
  f.store.createRun({ id: 'r3', sessionId: session, testFileId: 'tf-lh', tool: 'lh' });
  f.store.patchRun('r1', { status: 'passed' });
  f.store.patchRun('r2', { status: 'failed' });

  const rows = (await f.call('/api/sessions', { cookie })).body;
  const row = rows.find(s => s.id === session);
  assert.equal(row.run_count, 3);
  assert.equal(row.pw_count, 2);
  assert.equal(row.lh_count, 1);
  assert.equal(row.failed_count, 1, 'r2 gagal + r3 masih queued');
  assert.equal(row.active_count, 1, 'r3 queued dihitung aktif');
  assert.ok(!('runs' in row), 'daftar sesi tidak memuat baris run penuh');
});

test('settings: GET daftar, PATCH whitelist + rentang, audit tercatat', async t => {
  const f = await fixture(t);
  const cookie = await f.login();

  let r = await f.call('/api/settings', { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.log_max_bytes, '5242880');

  // key tak dikenal diabaikan, bukan bikin baris baru
  r = await f.call('/api/settings', { method: 'PATCH', cookie, body: { log_max_bytes: 1048576, key_ngawur: 5 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.log_max_bytes, '1048576');
  assert.equal(r.body.key_ngawur, undefined);

  // di luar rentang ditolak, tidak ada yang tersimpan
  r = await f.call('/api/settings', { method: 'PATCH', cookie, body: { artifact_retention_days: 0 } });
  assert.equal(r.status, 400);
  r = await f.call('/api/settings', { cookie });
  assert.equal(r.body.artifact_retention_days, '7');

  // body kosong ditolak
  r = await f.call('/api/settings', { method: 'PATCH', cookie, body: {} });
  assert.equal(r.status, 400);

  const audit = f.store.listAudit({ limit: 10 });
  assert.ok(audit.some(a => a.action === 'update_settings'), 'perubahan settings masuk audit');
});

test('A6: session_reuse_minutes membatasi sesi yang dipakai ulang', async t => {
  const f = await fixture(t);
  const cookie = await f.login();

  const first = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(first.status, 201);
  const oldId = first.body.sessionId;

  // masih di dalam jendela (default 240 menit) → dipakai ulang
  let r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.sessionId, oldId);

  // dimundurkan 5 jam → lewat jendela, sesi baru dibuat
  f.store.db.prepare('UPDATE sessions SET created_at=? WHERE id=?').run(new Date(Date.now() - 5 * 3600e3).toISOString(), oldId);
  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(r.status, 201, 'sesi kedaluwarsa tidak dipakai ulang');
  assert.notEqual(r.body.sessionId, oldId);
  assert.ok(f.store.getSession(oldId).closed_at, 'sesi lama ditutup agar index unik bebas');

  // jendela diubah lewat settings → ikut dipakai
  f.store.setSetting('session_reuse_minutes', '1');
  f.store.db.prepare('UPDATE sessions SET created_at=? WHERE id=?').run(new Date(Date.now() - 5 * 60e3).toISOString(), r.body.sessionId);
  const third = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  assert.equal(third.status, 201, '5 menit > 1 menit → sesi baru');
});

test('A2: runner menolak target di luar allowlist-nya sendiri', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const session = (await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } })).body.sessionId;
  f.store.createTestFile({ id: 'tf-a2', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });
  f.store.createRun({ id: 'r-a2', sessionId: session, testFileId: 'tf-a2', tool: 'pw' });

  const runsDir = await mkdtemp(join(tmpdir(), 'pb-runner-a2-'));
  t.after(() => rm(runsDir, { recursive: true, force: true }));
  const runner = new Runner(f.store, { runsDir, origins: [ORIGIN] });

  await runner.start('r-a2', f.store.getTestFile('tf-a2'), session, 'https://evil.test/');

  const run = f.store.getRun('r-a2');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /not allowlisted/);
  assert.equal(existsSync(join(runsDir, 'r-a2')), false, 'tidak ada folder/spawn untuk target terlarang');
});

test('A3: target divalidasi terhadap projects.origins, bukan cuma TARGET_ALLOWLIST', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.store.db.prepare(`INSERT INTO projects (id, slug, name, base_url, staging_url, local_url, origins, allow_production, active, created_at)
    VALUES ('p2','p2','P2','https://p2.test',?,?,'[]',0,1,?)`)
    .run('https://staging.p2.test', 'http://localhost:5173', new Date().toISOString());

  // origin staging.p2.test tak ada di allowlist global fixture, tapi ada di projects.origins
  let r = await f.call('/api/projects/p2', { method: 'PATCH', cookie, body: { origins: ['https://staging.p2.test'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.origins, ['https://staging.p2.test']);

  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p2', env: 'staging' } });
  assert.equal(r.status, 201, 'origin dari projects.origins diterima');
  assert.equal(r.body.targetUrl, 'https://staging.p2.test/');

  // origin tak terdaftar di mana pun → ditolak
  f.store.db.prepare("UPDATE projects SET staging_url='https://evil.test/' WHERE id='p2'").run();
  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p2', env: 'staging' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not allowlisted/);

  // skema aneh & origins bukan array ditolak
  r = await f.call('/api/projects/p2', { method: 'PATCH', cookie, body: { local_url: 'javascript:alert(1)' } });
  assert.equal(r.status, 400);
  r = await f.call('/api/projects/p2', { method: 'PATCH', cookie, body: { origins: ['https://ok.test/path'] } });
  assert.equal(r.status, 400, 'origin tidak boleh punya path');
  assert.deepEqual(f.store.getProject('p2').origins, ['https://staging.p2.test'], 'origins lama tidak berubah');
});

test('A5: run production menulis satu baris log system', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.store.db.prepare("UPDATE projects SET allow_production=1, origins='[\"https://ebh.test\"]' WHERE id='p1'").run();
  f.store.createTestFile({ id: 'tf-a5', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });

  // local: tidak ada baris production
  let r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'local' } });
  const localSession = r.body.sessionId;
  let runId = (await f.call(`/api/sessions/${localSession}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf-a5' } })).body.runId;
  assert.equal(f.store.logsRaw(runId).some(l => /production run by/.test(l.text)), false);

  // production: satu baris, berisi username
  r = await f.call('/api/sessions', { method: 'POST', cookie, body: { projectId: 'p1', env: 'production', confirm: 'EBH' } });
  assert.equal(r.status, 201);
  runId = (await f.call(`/api/sessions/${r.body.sessionId}/runs`, { method: 'POST', cookie, body: { testFileId: 'tf-a5' } })).body.runId;

  const lines = f.store.logsRaw(runId).filter(l => l.stream === 'system' && /production run by/.test(l.text));
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /production run by tester at \d{4}-\d{2}-\d{2}T/);

  // runner tidak boleh mulai dari seq 0 — baris system tadi sudah pakai seq 1.
  const runsDir = await mkdtemp(join(tmpdir(), 'pb-runner-a5-'));
  t.after(() => rm(runsDir, { recursive: true, force: true }));
  const runner = new Runner(f.store, { runsDir, origins: [ORIGIN] });
  runner.execute = async state => { await mkdir(runner.directory(runId), { recursive: true }); await runner.log(state, 'system', 'mulai\n'); };
  await runner.start(runId, f.store.getTestFile('tf-a5'), null, null);

  const seqs = f.store.logsRaw(runId).map(l => l.seq);
  assert.deepEqual(seqs, [1, 2], 'seq lanjut, tidak bentrok primary key');
});

test('CLI: batch log setelah baris system tidak hilang', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.store.db.prepare("UPDATE projects SET allow_production=1, origins='[\"https://ebh.test\"]' WHERE id='p1'").run();
  f.store.createTestFile({ id: 'tf-cli', projectId: 'p1', tool: 'pw', path: 'a.spec.ts', label: 'A', code: 'x' });

  const r = await f.call('/api/runs/local', { method: 'POST', cookie, body: { testFileId: 'tf-cli', env: 'production', confirm: 'EBH' } });
  assert.equal(r.status, 201);

  // klien tetap mengirim seq mulai 1, seperti CLI sekarang
  const post = await f.call(`/api/runs/${r.body.runId}/logs`, {
    method: 'POST', cookie,
    body: { entries: [{ seq: 1, stream: 'stdout', text: 'mulai\n', at: new Date().toISOString() }] },
  });
  assert.equal(post.status, 200);

  const texts = f.store.logsRaw(r.body.runId).map(l => l.text);
  assert.equal(texts.length, 2, 'baris system + baris klien');
  assert.ok(texts.some(t => t.includes('production run by')));
  assert.ok(texts.includes('mulai\n'), 'log klien tidak dibuang');
});
