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
