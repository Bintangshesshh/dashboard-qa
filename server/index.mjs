import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID, createHash, scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath, lstat } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { fail, id, text, env as envValue, tool as toolValue, allowlist, target, authorized, cursor, bool } from './validation.mjs';

const scrypt = promisify(_scrypt);
const root = fileURLToPath(new URL('../', import.meta.url));
const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function verifyPassword(password, hash) {
  // format hash: scrypt$N$r$p$salt_b64$hash_b64
  const [scheme, N, r, p, saltB64, expectedB64] = String(hash).split('$');
  if (scheme !== 'scrypt') throw new Error('password_hash format tidak dikenal');
  const expected = Buffer.from(expectedB64, 'base64');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function createApp({ store, runner, token, origins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Browser session cookie (PRD §7: cookie pb_session + same-origin check).
  const sessionCookie = req => {
    const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim());
    const pair = cookies.find(s => s.startsWith('pb_session='));
    if (!pair) return null;
    try { return decodeURIComponent(pair.slice('pb_session='.length)); } catch { return null; }
  };

  const sameOrigin = req => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true; // CLI / curl tanpa Origin
    try { return new URL(req.headers.origin).host === req.get('host'); } catch { return false; }
  };

  // Resolve authenticated user. Returns { user, via: 'cookie' | 'bearer' } or null.
  const resolveUser = req => {
    // 1. Bearer token CLI → cli_tokens
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    if (bearer) {
      const tok = store.cliTokenByHash(sha256(bearer));
      if (tok && !tok.revoked_at) {
        store.touchCliToken(tok.id);
        const user = store.userById(tok.user_id);
        if (user) return { user, via: 'bearer', tokenRow: tok };
      }
      return null;
    }
    // 2. Cookie pb_session → auth_sessions (browser, wajib same-origin untuk mutasi)
    const sess = sessionCookie(req);
    if (sess) {
      const row = store.authSessionById(sha256(sess));
      if (row && new Date(row.expires_at) > new Date()) {
        const user = store.userById(row.user_id);
        if (user) return { user, via: 'cookie' };
      }
    }
    return null;
  };

  const requireAuth = (req, res, next) => {
    const auth = resolveUser(req);
    if (!auth) return res.status(401).json({ error: 'Sesi tidak valid' });
    req.user = auth.user;
    req.via = auth.via;
    req.tokenRow = auth.tokenRow;
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Butuh akses admin' });
    next();
  };

  const health = 'ok';
  app.get('/api/health', route(async (req, res) => { await store.ping(); res.json({ ok: true, database: 'sqlite' }); }));

  // ─── Auth ────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', route(async (req, res) => {
    const username = text(req.body?.username, 'username', 64);
    const password = req.body?.password;
    if (typeof password !== 'string' || !password) fail('Username atau password salah', 401);
    const user = store.userByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash).catch(() => false))) {
      fail('Username atau password salah', 401);
    }
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8 jam
    store.createAuthSession({ id: sha256(rawToken), userId: user.id, expiresAt, ip: req.ip, userAgent: req.get('user-agent') });
    store.touchLogin(user.id);
    store.audit({ userId: user.id, action: 'login', entity: 'auth', detail: JSON.stringify({ ip: req.ip }) });
    res.cookie('pb_session', rawToken, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 8 * 60 * 60 * 1000 });
    res.json({ id: user.id, username: user.username, role: user.role });
  }));

  app.post('/api/auth/logout', requireAuth, route(async (req, res) => {
    const sess = sessionCookie(req);
    if (sess) store.deleteAuthSession(sha256(sess));
    res.clearCookie('pb_session', { path: '/' });
    res.json({ ok: true });
  }));

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
  });

  app.post('/api/auth/cli-token', requireAuth, requireAdmin, route(async (req, res) => {
    const label = req.body?.label != null ? text(req.body.label, 'label', 64) : null;
    const rawToken = randomBytes(32).toString('hex');
    store.createCliToken({ id: randomUUID(), userId: req.user.id, tokenHash: sha256(rawToken), label });
    const row = store.cliTokenByHash(sha256(rawToken));
    res.status(201).json({ id: row.id, token: rawToken, label: row.label });
  }));

  app.delete('/api/auth/cli-token/:id', requireAuth, requireAdmin, route(async (req, res) => {
    if (!store.revokeCliToken(id(req.params.id))) fail('Token tidak ditemukan atau sudah dicabut', 404);
    res.sendStatus(204);
  }));

  // ─── Projects ────────────────────────────────────────────────────────────
  app.get('/api/projects', requireAuth, route(async (req, res) => res.json(store.listProjects())));
  app.patch('/api/projects/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const p = store.getProject(id(req.params.id));
    if (!p) fail('Not found', 404);
    const fields = {};
    if (req.body.name !== undefined) fields.name = text(req.body.name, 'name');
    if (req.body.base_url !== undefined) fields.base_url = target(req.body.base_url, allowlist((p.allow_production ? [p.base_url] : [p.base_url]).join(',')).concat(origins));
    if (req.body.staging_url !== undefined) fields.staging_url = req.body.staging_url ? new URL(req.body.staging_url).href : null;
    if (req.body.local_url !== undefined) fields.local_url = req.body.local_url ? new URL(req.body.local_url).href : null;
    if (req.body.origins !== undefined) fields.origins = req.body.origins;
    if (req.body.allow_production !== undefined) fields.allow_production = bool(req.body.allow_production, 'allow_production');
    if (req.body.active !== undefined) fields.active = bool(req.body.active, 'active');
    store.patchProject(id(req.params.id), fields);
    store.audit({ userId: req.user.id, action: 'update_project', entity: 'projects', entityId: req.params.id });
    res.json(store.getProject(req.params.id));
  }));

  // ─── Test files ──────────────────────────────────────────────────────────
  app.get('/api/test-files', requireAuth, route(async (req, res) => {
    const { project, tool } = req.query;
    res.json(store.listTestFiles({ projectId: project ?? undefined, tool: tool === 'pw' || tool === 'lh' ? tool : undefined }));
  }));
  app.post('/api/test-files', requireAuth, requireAdmin, route(async (req, res) => {
    const t = toolValue(req.body?.tool);
    const projectId = id(req.body?.projectId);
    if (!store.getProject(projectId)) fail('Project tidak ditemukan', 400);
    const path = text(req.body?.path, 'path', 500);
    const code = text(req.body?.code, 'code', 200000);
    const label = text(req.body?.label, 'label', 200);
    const config = req.body?.config != null ? (typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config)) : null;
    const tf = { id: randomUUID(), projectId, tool: t, path, label, code, config, updatedBy: req.user.id };
    store.createTestFile(tf);
    store.audit({ userId: req.user.id, action: 'create_test_file', entity: 'test_files', entityId: tf.id });
    res.status(201).json(store.getTestFile(tf.id));
  }));
  app.patch('/api/test-files/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const tf = store.getTestFile(id(req.params.id));
    if (!tf) fail('Not found', 404);
    const fields = {};
    if (req.body.code !== undefined) fields.code = text(req.body.code, 'code', 200000);
    if (req.body.label !== undefined) fields.label = text(req.body.label, 'label');
    if (req.body.config !== undefined) fields.config = req.body.config != null ? (typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config)) : null;
    if (req.body.enabled !== undefined) fields.enabled = bool(req.body.enabled, 'enabled');
    store.patchTestFile(req.params.id, fields);
    store.audit({ userId: req.user.id, action: 'update_test_file', entity: 'test_files', entityId: req.params.id });
    res.json(store.getTestFile(req.params.id));
  }));

  // ─── Sessions ────────────────────────────────────────────────────────────
  app.post('/api/sessions', requireAuth, requireAdmin, route(async (req, res) => {
    const projectId = id(req.body?.projectId);
    const project = store.getProject(projectId);
    if (!project) fail('Project tidak ditemukan', 400);
    const e = envValue(req.body?.env);
    // determine target URL from project per env
    let targetUrl;
    if (e === 'local') targetUrl = project.local_url;
    else if (e === 'staging') targetUrl = project.staging_url;
    else targetUrl = project.base_url;
    if (!targetUrl) fail(`Project ini belum punya URL untuk env ${e}`, 400);
    // production guard (PRD §8.2 step 2)
    if (e === 'production') {
      if (!project.allow_production) fail('Run production diblokir untuk project ini', 403);
      if (req.body?.confirm !== project.name) fail('Ketik ulang nama project untuk konfirmasi production', 400);
    }
    // reuse: sesi terbuka milik user yang sama
    const existing = store.findOpenSession(projectId, e, req.user.id);
    if (existing) return res.status(409).json({ sessionId: existing.id, reuse: true });
    try {
      const id = randomUUID();
      const label = `${project.name} — ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
      store.createSession({ id, projectId, env: e, targetUrl, label, createdBy: req.user.id });
      const session = store.getSession(id);
      res.status(201).json({ sessionId: id, targetUrl, session });
    } catch (err) {
      // partial unique index race → already exists
      const again = store.findOpenSession(projectId, e, req.user.id);
      if (again) return res.status(409).json({ sessionId: again.id, reuse: true });
      throw err;
    }
  }));

  app.get('/api/sessions', requireAuth, route(async (req, res) => {
    const { project, status, from, to } = req.query;
    res.json(store.listSessions({
      projectId: project ?? undefined,
      status: status ?? undefined,
      from: from ?? undefined,
      to: to ?? undefined,
    }));
  }));

  app.get('/api/sessions/:id', requireAuth, route(async (req, res) => {
    const session = store.getSession(id(req.params.id), true);
    if (!session) fail('Not found', 404);
    session.reports = store.listReportsBySession(session.id);
    res.json(session);
  }));

  app.delete('/api/sessions/:id', requireAuth, requireAdmin, route(async (req, res) => {
    if (!store.getSession(id(req.params.id))) fail('Not found', 404);
    store.deleteSession(req.params.id);
    store.audit({ userId: req.user.id, action: 'delete_session', entity: 'sessions', entityId: req.params.id });
    res.sendStatus(204);
  }));

  // ─── Runs ────────────────────────────────────────────────────────────────
  app.post('/api/sessions/:id/runs', requireAuth, requireAdmin, route(async (req, res) => {
    const session = store.getSession(id(req.params.id));
    if (!session) fail('Not found', 404);
    const testFileId = id(req.body?.testFileId);
    const tf = store.getTestFile(testFileId);
    if (!tf) fail('Test file tidak ditemukan', 400);
    if (tf.project_id !== session.project_id) fail('Test file milik project lain.', 400);
    // 409 bila ada run belum final di sesi ini (PRD §7)
    if (store.countRunsByStatus(session.id, ['queued', 'running', 'uploading']) > 0) fail('Masih ada run berjalan di sesi ini', 409);
    // max queue
    if (store.countActiveRuns() >= Number(store.getSetting('max_queue_length') ?? 10)) fail('Antrean penuh', 429);
    const runId = randomUUID();
    store.createRun({ id: runId, sessionId: session.id, testFileId, tool: tf.tool });
    runner.start(runId, tf);
    res.status(202).json({ runId });
  }));

  // CLI-local run endpoint (PRD §7: POST /api/runs/local)
  app.post('/api/runs/local', requireAuth, requireAdmin, route(async (req, res) => {
    const tf = store.getTestFile(id(req.body?.testFileId));
    if (!tf) fail('Test file tidak ditemukan', 400);
    res.status(201).json({ testFile: tf });
  }));

  app.get('/api/runs/:id', requireAuth, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    run.artifacts = store.listArtifacts(run.id);
    run.results = run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id);
    res.json(run);
  }));

  app.get('/api/runs/:id/logs', requireAuth, route(async (req, res) => {
    if (!store.getRun(id(req.params.id))) fail('Not found', 404);
    const after = cursor(req.query.after);
    res.json(await store.logs(req.params.id, after));
  }));

  app.get('/api/runs/:id/logs/download', requireAuth, route(async (req, res) => {
    if (!store.getRun(id(req.params.id))) fail('Not found', 404);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(await store.logsText(req.params.id));
  }));

  app.patch('/api/runs/:id', requireAuth, requireAdmin, route(async (req, res) => {
    if (!store.getRun(id(req.params.id))) fail('Not found', 404);
    const fields = {};
    if (req.body.status !== undefined) fields.status = req.body.status;
    if (req.body.started_at !== undefined) fields.started_at = req.body.started_at;
    if (req.body.finished_at !== undefined) fields.finished_at = req.body.finished_at;
    if (req.body.finalized_at !== undefined) fields.finalized_at = req.body.finalized_at;
    if (req.body.duration_ms !== undefined) fields.duration_ms = Number(req.body.duration_ms);
    if (req.body.exit_code !== undefined) fields.exit_code = Number(req.body.exit_code);
    if (req.body.error !== undefined) fields.error = req.body.error;
    if (req.body.results !== undefined && Array.isArray(req.body.results)) store.addPlaywrightResults(req.params.id, req.body.results);
    if (req.body.lighthouse !== undefined && Array.isArray(req.body.lighthouse)) store.addLighthouseResults(req.params.id, req.body.lighthouse);
    const run = store.patchRun(req.params.id, fields);
    res.json(run);
  }));

  app.post('/api/runs/:id/cancel', requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    if (!await runner.cancel(req.params.id)) fail('Run is not active', 409);
    res.json(store.getRun(req.params.id));
  }));

  app.delete('/api/runs/:id', requireAuth, requireAdmin, route(async (req, res) => {
    if (!store.getRun(id(req.params.id))) fail('Not found', 404);
    store.deleteRun(req.params.id);
    store.audit({ userId: req.user.id, action: 'delete_run', entity: 'runs', entityId: req.params.id });
    res.sendStatus(204);
  }));

  // ─── Reports ─────────────────────────────────────────────────────────────
  app.post('/api/sessions/:id/reports', requireAuth, requireAdmin, route(async (req, res) => {
    const session = store.getSession(id(req.params.id));
    if (!session) fail('Not found', 404);
    const scope = req.body?.scope;
    if (!['pw', 'lh', 'both'].includes(scope)) fail("scope must be 'pw'|'lh'|'both'", 400);
    const runs = store.listRunsBySession(session.id);
    const finals = runs.filter(r => ['passed', 'failed'].includes(r.status));
    if (finals.length !== runs.length) fail('Ada run yang belum final', 409);
    const tools = new Set(finals.map(r => r.tool));
    if (scope === 'both' && (!tools.has('pw') || !tools.has('lh'))) fail("'both' butuh minimal satu run pw dan satu run lh", 409);
    if (scope === 'pw' && !tools.has('pw')) fail("Tidak ada run Playwright final", 409);
    if (scope === 'lh' && !tools.has('lh')) fail("Tidak ada run Lighthouse final", 409);
    const runIds = finals.filter(r => scope === 'both' || r.tool === scope).map(r => r.id);
    const report = store.createReport({ id: randomUUID(), sessionId: session.id, scope, runIds, builtBy: req.user.id });
    res.status(202).json({ reportId: report.id, runIds });
  }));

  app.get('/api/reports/:id', requireAuth, route(async (req, res) => {
    const report = store.getReport(id(req.params.id));
    if (!report) fail('Not found', 404);
    res.json(report);
  }));

  // ─── Audit ───────────────────────────────────────────────────────────────
  app.get('/api/audit', requireAuth, requireAdmin, route(async (req, res) => {
    res.json(store.listAudit({ limit: req.query.limit, entity: req.query.entity }));
  }));

  // ─── Artifacts (raw files) ───────────────────────────────────────────────
  app.get('/artifacts/:runId/*', requireAuth, route(async (req, res) => {
    const runId = id(req.params.runId);
    const run = store.getRun(runId);
    if (!run) fail('Not found', 404);
    const rel = req.params[0];
    if (rel.includes('..')) fail('Invalid path', 400);
    const base = join(root, '.runs', runId);
    const file = realpath(join(base, rel));
    const stat = await lstat(file);
    if (!stat.isFile()) fail('Not found', 404);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Robots-Tag', 'noindex');
    const isDownload = /\.(zip|trace)$/i.test(rel);
    if (isDownload) res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(file);
  }));

  app.get('/artifacts/reports/:reportId/*', requireAuth, route(async (req, res) => {
    const report = store.getReport(id(req.params.reportId));
    if (!report) fail('Not found', 404);
    const rel = req.params[0];
    if (rel.includes('..')) fail('Invalid path', 400);
    const base = join(root, '.reports', report.id);
    const file = realpath(join(base, rel));
    const stat = await lstat(file);
    if (!stat.isFile()) fail('Not found', 404);
    res.setHeader('X-Robots-Tag', 'noindex');
    res.sendFile(file);
  }));

  // ─── WebSocket (log streaming) ───────────────────────────────────────────
  attachWebSocket(app, { store, runner });

  // ─── Error handler ───────────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message ?? 'Internal error' });
  });

  return app;
}

function attachWebSocket(app, { store, runner }) {
  const server = app.__wssServer ?? createServer(app);
  app.__wssServer = server;
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    let subscribed = false;
    const onLog = (msg) => { if (subscribed) ws.send(JSON.stringify(msg)); };
    const onStatus = (msg) => { if (subscribed) ws.send(JSON.stringify(msg)); };
    const timer = setTimeout(() => { if (!subscribed) ws.close(1008, 'No subscription'); }, 30000);
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'subscribe' || !msg.runId) return;
        clearTimeout(timer);
        const runId = id(msg.runId);
        const after = cursor(msg.after);
        if (!store.getRun(runId)) return ws.close(1008, 'Unknown run');
        runner.on('log', onLog); runner.on('status', onStatus);
        subscribed = true;
        const replay = await store.logs(runId, after, 5000);
        let last = after;
        for (const entry of replay.logs) { if (entry.seq > last) { last = entry.seq; ws.send(JSON.stringify({ type: 'log', runId, ...entry })); } }
        if (replay.hasMore) ws.send(JSON.stringify({ type: 'replay-truncated', runId, fromSeq: replay.nextAfter }));
        ws.send(JSON.stringify({ type: 'status', run: store.getRun(runId) }));
        ws.send(JSON.stringify({ type: 'replay-complete', runId }));
      } catch { ws.close(1008, 'Invalid subscription'); }
    });
    ws.on('close', () => { clearTimeout(timer); runner.off('log', onLog); runner.off('status', onStatus); });
    ws.on('error', () => ws.close());
  });
  app.__wss = wss;
  return server;
}

export async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; SQLite persistence cannot be disabled');
  const store = new Store(process.env.DATABASE_URL);
  await store.init();
  const origins = allowlist(process.env.TARGET_ALLOWLIST);
  if (!origins.length) throw new Error('TARGET_ALLOWLIST must contain at least one exact origin');
  const runner = new Runner(store, {
    origins,
    runsDir: resolve(process.env.RUNS_DIR ?? join(root, '.runs')),
    timeout: Number(process.env.RUN_TIMEOUT_MS ?? 300000),
  });
  const app = createApp({ store, runner, token: null, origins });
  const server = app.__wssServer ?? createServer(app);
  server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () => console.log('QA backend listening', server.address()));
  const close = async () => {
    if (runner.active) { await runner.cancel(runner.active.run.id); await runner.active?.done; }
    for (const client of app.__wss?.clients ?? []) client.close();
    server.close();
    await store.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return { server, store, runner };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
