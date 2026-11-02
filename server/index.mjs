import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID, createHash, scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath, lstat, rm, mkdir, writeFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Runner, MAX_LH_URLS } from './runner.mjs';
import { buildSessionReport } from '../scripts/build-session-report.mjs';
import { ensureQuickFiles, writeLighthouseConfig, pwConfig } from './quick-check.mjs';
import { reportMarkdownFor } from '../scripts/report-md.mjs';
import { runRetention } from './retention.mjs';
import { specPath, readSpec, writeSpec } from './spec-sync.mjs';
import { backupDatabase } from './backup.mjs';
import { fail, id, text, code as codeValue, env as envValue, tool as toolValue, allowlist, target, url as urlValue, originList, authorized, cursor, bool, rangeDays, isoTimestamp } from './validation.mjs';

const scrypt = promisify(_scrypt);
const root = fileURLToPath(new URL('../', import.meta.url));
const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

const sha256 = value => createHash('sha256').update(value).digest('hex');

// ?range=N → ISO timestamp N hari lalu; tanpa range → undefined (tanpa batas).
const rangeStart = value => value === undefined ? undefined
  : new Date(Date.now() - rangeDays({ range: value }) * 86400000).toISOString();

async function verifyPassword(password, hash) {
  // format hash: scrypt$N$r$p$salt_b64$hash_b64
  const [scheme, N, r, p, saltB64, expectedB64] = String(hash).split('$');
  if (scheme !== 'scrypt') throw new Error('password_hash format tidak dikenal');
  const expected = Buffer.from(expectedB64, 'base64');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Stream `console`/`network` ditulis reporter sebagai satu baris JSON; toleran ke teks mentah.
function parseConsole(text) {
  try {
    const v = JSON.parse(text);
    return { type: v.type ?? 'log', text: String(v.text ?? ''), location: v.location ?? null };
  } catch { return { type: 'log', text: String(text).trim(), location: null }; }
}
function parseNetwork(text) {
  try {
    const v = JSON.parse(text);
    return { url: v.url ?? '', status: v.status ?? null, method: v.method ?? null, failure: v.failure ?? null, ms: v.ms ?? null };
  } catch { return { url: String(text).trim(), status: null, method: null, failure: null, ms: null }; }
}

export function createApp({ store, runner, token, origins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({
    limit: '256kb',
    type: req => !(req.method === 'PUT' && /^\/api\/runs\/[^/]+\/artifacts$/.test(req.path)),
  }));

  // PRD §7: hapus sesi/run ikut hapus artifact di disk.
  const runsDir = runner?.runsDir ?? resolve(root, '.runs');
  const reportsDir = resolve(root, process.env.REPORTS_DIR ?? '.reports');
  const dropDirs = (...dirs) => Promise.all(dirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));

  // Browser session cookie (PRD §7: cookie pb_session + same-origin check).
  const sessionCookie = req => {
    const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim());
    const pair = cookies.find(s => s.startsWith('pb_session='));
    if (!pair) return null;
    try { return decodeURIComponent(pair.slice('pb_session='.length)); } catch { return null; }
  };

  // PRD §7: cookie hanya boleh dipakai dari origin sendiri.
  // Tanpa Origin DAN tanpa Sec-Fetch-Site dianggap CLI/curl (bukan browser) → tolak untuk cookie.
  const sameOrigin = req => {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'same-site') return false;
    if (req.headers.origin) {
      try { return new URL(req.headers.origin).host === req.get('host'); } catch { return false; }
    }
    return !site;
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

  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  const requireAuth = (req, res, next) => {
    const auth = resolveUser(req);
    if (!auth) return res.status(401).json({ error: 'Sesi tidak valid' });
    // PRD §7: cookie + cek same-origin. Bearer CLI dikecualikan (tidak punya Origin).
    if (auth.via === 'cookie' && !SAFE_METHODS.has(req.method) && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Permintaan lintas origin ditolak' });
    }
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
    if (!sameOrigin(req)) fail('Permintaan lintas origin ditolak', 403);
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

  app.get('/api/auth/cli-token', requireAuth, requireAdmin, route(async (req, res) => {
    res.json(store.listCliTokens(req.user.id));
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
    if (req.body.base_url !== undefined) fields.base_url = urlValue(req.body.base_url, 'base_url');
    if (req.body.staging_url !== undefined) fields.staging_url = req.body.staging_url ? urlValue(req.body.staging_url, 'staging_url') : null;
    if (req.body.local_url !== undefined) fields.local_url = req.body.local_url ? urlValue(req.body.local_url, 'local_url') : null;
    if (req.body.origins !== undefined) fields.origins = originList(req.body.origins);
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
  // Session target already claims one URL slot, so extra URLs are capped below it.
  function checkLhUrls(tool, config) {
    if (tool !== 'lh' || !config) return;
    const cfg = typeof config === 'string' ? (() => { try { return JSON.parse(config); } catch { return null; } })() : config;
    const extra = Array.isArray(cfg?.urls) ? cfg.urls.length : 0;
    if (extra + 1 > MAX_LH_URLS) fail(`Maksimal ${MAX_LH_URLS} URL per run Lighthouse (target + ${MAX_LH_URLS - 1} tambahan)`, 400);
  }

  app.post('/api/test-files', requireAuth, requireAdmin, route(async (req, res) => {
    const t = toolValue(req.body?.tool);
    const projectId = id(req.body?.projectId);
    if (!store.getProject(projectId)) fail('Project tidak ditemukan', 400);
    const path = text(req.body?.path, 'path', 500);
    const code = codeValue(req.body?.code);
    const label = text(req.body?.label, 'label', 200);
    const config = req.body?.config != null ? (typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config)) : null;
    checkLhUrls(t, config);
    const tf = { id: randomUUID(), projectId, tool: t, path, label, code, config, updatedBy: req.user.id };
    store.createTestFile(tf);
    store.audit({ userId: req.user.id, action: 'create_test_file', entity: 'test_files', entityId: tf.id });
    res.status(201).json(store.getTestFile(tf.id));
  }));
  app.patch('/api/test-files/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const tf = store.getTestFile(id(req.params.id));
    if (!tf) fail('Not found', 404);
    const fields = {};
    if (req.body.code !== undefined) fields.code = codeValue(req.body.code);
    if (req.body.label !== undefined) fields.label = text(req.body.label, 'label');
    if (req.body.config !== undefined) fields.config = req.body.config != null ? (typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config)) : null;
    checkLhUrls(tf.tool, fields.config);
    if (req.body.enabled !== undefined) fields.enabled = bool(req.body.enabled, 'enabled');

    // Sinkron ke disk hanya untuk spec Playwright yang punya path file nyata.
    // Guard: tolak kalau file di disk sudah berubah sejak sinkron terakhir,
    // supaya edit di git tidak tertimpa diam-diam. `force: true` = timpa paksa.
    if (fields.code !== undefined && tf.tool === 'pw') {
      const abs = specPath(root, tf.path);
      const disk = await readSpec(abs);
      const expected = tf.disk_hash ?? (disk ? disk.hash : null);
      if (!req.body.force && disk && tf.disk_hash && disk.hash !== tf.disk_hash) {
        return res.status(409).json({
          error: 'File spec di disk sudah berubah sejak sinkron terakhir.',
          conflict: true, diskHash: disk.hash, expected,
        });
      }
      fields.disk_hash = await writeSpec(abs, fields.code);
    }

    store.patchTestFile(req.params.id, fields);
    store.audit({ userId: req.user.id, action: 'update_test_file', entity: 'test_files', entityId: req.params.id });
    res.json(store.getTestFile(req.params.id));
  }));

  // Muat ulang isi spec dari disk ke DB (arah sebaliknya, manual).
  app.post('/api/test-files/:id/reload', requireAuth, requireAdmin, route(async (req, res) => {
    const tf = store.getTestFile(id(req.params.id));
    if (!tf) fail('Not found', 404);
    if (tf.tool !== 'pw') fail('Hanya spec Playwright yang punya file di disk', 400);
    const disk = await readSpec(specPath(root, tf.path));
    if (!disk) fail('File spec tidak ada di disk', 404);
    store.patchTestFile(tf.id, { code: disk.text, disk_hash: disk.hash });
    store.audit({ userId: req.user.id, action: 'reload_test_file', entity: 'test_files', entityId: tf.id });
    res.json(store.getTestFile(tf.id));
  }));

  // ─── Sessions ────────────────────────────────────────────────────────────
  // PRD §7/§8.2: URL target selalu dari `projects`, tidak pernah dari input bebas.
  // Origin hasil resolve wajib ada di `projects.origins` atau TARGET_ALLOWLIST (anti-SSRF).
  // ponytail: env local dikecualikan dari cek origin - local_url menunjuk mesin
  // developer, bukan jaringan server. Kalau nanti runner jalan di server juga,
  // hapus pengecualian ini.
  const resolveTarget = (project, e) => {
    const raw = e === 'local' ? project.local_url : e === 'staging' ? project.staging_url : project.base_url;
    if (!raw) return null;
    const href = urlValue(raw, `target ${e}`);
    return e === 'local' ? raw : target(href, [...(project.origins ?? []), ...origins]);
  };

  // PRD §8.2 step 2: setiap run production meninggalkan satu baris `system`.
  const traceProduction = (runId, e, user) => {
    if (e === 'production') store.systemLog(runId, `production run by ${user.username} at ${new Date().toISOString()}`);
  };

  app.post('/api/sessions', requireAuth, requireAdmin, route(async (req, res) => {
    const projectId = id(req.body?.projectId);
    const project = store.getProject(projectId);
    if (!project) fail('Project tidak ditemukan', 400);
    const e = envValue(req.body?.env);
    const targetUrl = resolveTarget(project, e);
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
      const label = `${project.name} ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
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

  app.get('/api/stats', requireAuth, route(async (req, res) => {
    const projectId = req.query.project ?? undefined;
    const from = rangeStart(req.query.range);
    res.json({
      ...store.stats({ projectId, from }),
      failures: store.listRecentFailures({ projectId, from, limit: req.query.failures }),
      daily: store.runsPerDay({ projectId, from }),
    });
  }));

  app.get('/api/sessions', requireAuth, route(async (req, res) => {
    const { project, status, from, to } = req.query;
    res.json(store.listSessions({
      projectId: project ?? undefined,
      status: status ?? undefined,
      from: from ?? rangeStart(req.query.range),
      to: to ?? undefined,
    }));
  }));

  app.get('/api/sessions/:id', requireAuth, route(async (req, res) => {
    const session = store.getSession(id(req.params.id), true);
    if (!session) fail('Not found', 404);
    session.reports = store.listReportsBySession(session.id);
    res.json(session);
  }));

  // PRD §10.6: `Tutup sesi` mengunci sesi (closed_at), bukan menghapus.
  app.post('/api/sessions/:id/close', requireAuth, requireAdmin, route(async (req, res) => {
    const session = store.getSession(id(req.params.id));
    if (!session) fail('Not found', 404);
    if (session.closed_at) return res.json(session);
    if (store.countRunsByStatus(session.id, ['queued', 'running', 'uploading']) > 0) fail('Masih ada run berjalan di sesi ini', 409);
    store.closeSession(session.id);
    store.audit({ userId: req.user.id, action: 'close_session', entity: 'sessions', entityId: session.id });
    res.json(store.getSession(session.id));
  }));

  app.delete('/api/sessions/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const session = store.getSession(id(req.params.id), true);
    if (!session) fail('Not found', 404);
    // Jangan hapus folder di bawah proses yang masih jalan.
    if (store.countRunsByStatus(session.id, ['queued', 'running', 'uploading']) > 0) fail('Masih ada run berjalan di sesi ini', 409);
    const runIds = (session.runs ?? []).map(r => r.id);
    const reportIds = store.listReportsBySession(session.id).map(r => r.id);
    store.deleteSession(req.params.id);
    await dropDirs(
      ...runIds.map(r => join(runsDir, r)),
      ...reportIds.map(r => join(reportsDir, r)),
    );
    store.audit({ userId: req.user.id, action: 'delete_session', entity: 'sessions', entityId: req.params.id, detail: JSON.stringify({ runs: runIds.length, reports: reportIds.length }) });
    res.sendStatus(204);
  }));

  // ─── Quick check (PRD §7, A43/A48) ───────────────────────────────────────
  app.post('/api/quick-check', requireAuth, requireAdmin, route(async (req, res) => {
    const project = store.getProject(id(req.body?.projectId));
    if (!project) fail('Project tidak ditemukan', 400);
    const e = envValue(req.body?.env);
    const targetUrl = resolveTarget(project, e);
    if (!targetUrl) fail(`Project ini belum punya URL untuk env ${e}`, 400);
    if (e === 'production') {
      if (!project.allow_production) fail('Run production diblokir untuk project ini', 403);
      if (req.body?.confirm !== project.name) fail('Ketik ulang nama project untuk konfirmasi production', 400);
    }
    if (store.countActiveRuns() >= Number(store.getSetting('max_queue_length') ?? 10)) fail('Antrean penuh', 429);

    let session = store.findOpenSession(project.id, e, req.user.id);
    if (!session) {
      const sessionId = randomUUID();
      const label = `Quick check ${project.name} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
      store.createSession({ id: sessionId, projectId: project.id, env: e, targetUrl, label, createdBy: req.user.id });
      session = { id: sessionId };
    }

    await ensureQuickFiles();
    // Default tetap smoke generik (PRD A43: tanpa test_files). Opt-in
    // files='project' memakai spec/lhci milik project, supaya yang diuji alur
    // departemennya (cart, login), bukan cuma status HTTP halaman depan.
    const useProject = req.body?.files === 'project';
    const projectFile = tool => (useProject ? store.listTestFiles({ projectId: project.id, tool })[0] ?? null : null);
    const pwTest = projectFile('pw');
    const lhTest = projectFile('lh');

    const pwRun = randomUUID();
    const lhRun = randomUUID();
    store.createRun({ id: pwRun, sessionId: session.id, testFileId: pwTest?.id ?? null, tool: 'pw' });
    store.createRun({ id: lhRun, sessionId: session.id, testFileId: lhTest?.id ?? null, tool: 'lh' });
    traceProduction(pwRun, e, req.user);
    traceProduction(lhRun, e, req.user);

    const pwFile = pwTest ?? {
      id: null, tool: 'pw', path: 'quick.spec.ts',
      label: 'Quick check smoke', config: JSON.stringify({ configPath: pwConfig }),
    };
    const lhFile = lhTest
      ?? { id: null, tool: 'lh', path: await writeLighthouseConfig(join(runner.runsDir, lhRun), targetUrl), label: 'Quick check Lighthouse' };

    // Runner hanya menjalankan satu proses sekaligus → antre berurutan.
    runner.start(pwRun, pwFile, session.id, targetUrl)
      .catch(err => console.error('[quick-check pw]', err.message))
      .then(() => runner.start(lhRun, lhFile, session.id, targetUrl))
      .catch(err => console.error('[quick-check lh]', err.message))
      // Hasil quick check langsung bisa dibuka; tanpa ini laporan harus dipublish manual.
      .then(() => { try { publishReport(session.id, 'both', req.user.id); }
        catch (err) { console.error('[quick-check report]', err.message); } });

    store.audit({ userId: req.user.id, action: 'quick_check', entity: 'sessions', entityId: session.id, detail: JSON.stringify({ project: project.slug, env: e }) });
    res.status(202).json({ sessionId: session.id, runIds: [pwRun, lhRun] });
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
    traceProduction(runId, session.env, req.user);
    runner.start(runId, tf, session.id, session.target_url);
    res.status(202).json({ runId });
  }));

  // ─── CLI lokal (PRD §7): laptop developer yang menjalankan tool ──────────
  // Alur: POST /api/runs/local → start → logs (batch) → artifacts → PATCH (finalisasi).
  app.post('/api/runs/local', requireAuth, requireAdmin, route(async (req, res) => {
    const tf = store.getTestFile(id(req.body?.testFileId));
    if (!tf) fail('Test file tidak ditemukan', 400);
    const project = store.getProject(tf.project_id);
    if (!project) fail('Project tidak ditemukan', 400);
    const e = envValue(req.body?.env);
    const targetUrl = resolveTarget(project, e);
    if (!targetUrl) fail(`Project ini belum punya URL untuk env ${e}`, 400);
    if (e === 'production') {
      if (!project.allow_production) fail('Run production diblokir untuk project ini', 403);
      if (req.body?.confirm !== project.name) fail('Ketik ulang nama project untuk konfirmasi production', 400);
    }
    if (store.countActiveRuns() >= Number(store.getSetting('max_queue_length') ?? 10)) fail('Antrean penuh', 429);

    let sessionId = req.body?.sessionId ? id(req.body.sessionId) : null;
    if (sessionId) {
      const s = store.getSession(sessionId);
      if (!s) fail('Sesi tidak ditemukan', 404);
      if (s.project_id !== project.id || s.env !== e) fail('Sesi milik project/env lain', 400);
      if (s.closed_at) fail('Sesi sudah ditutup', 409);
      if (store.countRunsByStatus(sessionId, ['queued', 'running', 'uploading']) > 0) fail('Masih ada run berjalan di sesi ini', 409);
    } else {
      const open = store.findOpenSession(project.id, e, req.user.id);
      if (open) {
        if (store.countRunsByStatus(open.id, ['queued', 'running', 'uploading']) > 0) fail('Masih ada run berjalan di sesi ini', 409);
        sessionId = open.id;
      } else {
        sessionId = randomUUID();
        const label = `${project.name} ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
        store.createSession({ id: sessionId, projectId: project.id, env: e, targetUrl, label, createdBy: req.user.id });
      }
    }

    const runId = randomUUID();
    store.createRun({ id: runId, sessionId, testFileId: tf.id, tool: tf.tool });
    store.audit({ userId: req.user.id, action: 'run_local', entity: 'runs', entityId: runId, detail: JSON.stringify({ testFile: tf.path, env: e }) });
    traceProduction(runId, e, req.user);
    res.status(201).json({ runId, sessionId, code: tf.code, targetUrl, tool: tf.tool, config: tf.config });
  }));

  app.post('/api/runs/:id/start', requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    if (['passed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) fail('Run sudah final', 409);
    res.json(store.patchRun(run.id, { status: 'running', started_at: run.started_at ?? new Date().toISOString() }));
  }));

  app.post('/api/runs/:id/logs', requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    const entries = req.body?.entries;
    if (!Array.isArray(entries)) fail('entries must be an array');
    if (entries.length > 5000) fail('entries maksimal 5000 per batch');
    const clean = entries.map(e => {
      if (!Number.isSafeInteger(Number(e?.seq)) || Number(e.seq) < 0) fail('seq must be a non-negative integer');
      if (typeof e?.text !== 'string') fail('text must be a string');
      return { seq: Number(e.seq), stream: String(e.stream ?? 'stdout').slice(0, 20), text: e.text, at: isoTimestamp(e.at ?? new Date().toISOString()) };
    });
    store.logsBatch(run.id, clean);
    res.json({ inserted: clean.length });
  }));

  // Upload artifact mentah: body biner, query ?kind=&path=
  app.put('/api/runs/:id/artifacts', express.raw({ type: () => true, limit: '100mb' }), requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    const kind = String(req.query.kind ?? 'log');
    if (!['pw-html', 'lh-html', 'pw-json', 'lh-json', 'trace', 'screenshot', 'video', 'log'].includes(kind)) fail('kind tidak dikenal');
    const rel = String(req.query.path ?? '');
    if (!rel || rel.includes('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) fail('Invalid path', 400);
    const maxMb = Number(store.getSetting('max_upload_mb') ?? 100);
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) fail('Body harus biner (application/octet-stream)');
    if (body.length > maxMb * 1024 * 1024) fail(`File melebihi ${maxMb} MB`, 413);

    const dest = join(runsDir, run.id, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
    store.addArtifact({ runId: run.id, kind, path: rel, bytes: body.length });
    res.status(201).json({ path: rel, bytes: body.length });
  }));

  app.get('/api/runs', requireAuth, route(async (req, res) => {
    res.json(store.listRuns({ projectId: req.query.project ?? undefined, tool: req.query.tool ?? undefined, limit: req.query.limit }));
  }));

  app.get('/api/lighthouse', requireAuth, route(async (req, res) => {
    res.json(store.listLighthouseByProject({ projectId: req.query.project ?? undefined, limit: req.query.limit }));
  }));

  app.get('/api/runs/:id', requireAuth, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    run.artifacts = store.listArtifacts(run.id);
    run.results = run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id);
    // PRD §7: console & network dipisah dari logs (dipakai panel §10.3).
    const raw = store.logsRaw(run.id);
    run.console = raw.filter(e => e.stream === 'console').map(e => ({ seq: e.seq, at: e.at, ...parseConsole(e.text) }));
    run.network = raw.filter(e => e.stream === 'network').map(e => ({ seq: e.seq, at: e.at, ...parseNetwork(e.text) }));
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

  const RUN_STATUS = ['queued', 'running', 'uploading', 'passed', 'failed', 'cancelled', 'interrupted'];
  const FINAL_STATUS = new Set(['passed', 'failed', 'cancelled', 'interrupted']);

  app.patch('/api/runs/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const existing = store.getRun(id(req.params.id));
    if (!existing) fail('Not found', 404);
    const b = req.body ?? {};
    const fields = {};

    if (b.status !== undefined) {
      if (!RUN_STATUS.includes(b.status)) fail(`status must be ${RUN_STATUS.join('|')}`);
      fields.status = b.status;
    }
    // PRD §7 pakai camelCase; snake_case tetap diterima (klien lama).
    const startedAt = b.startedAt ?? b.started_at;
    const finishedAt = b.finishedAt ?? b.finished_at;
    const exitCode = b.exitCode ?? b.exit_code;
    const durationMs = b.durationMs ?? b.duration_ms;
    if (startedAt !== undefined) fields.started_at = isoTimestamp(startedAt);
    if (finishedAt !== undefined) fields.finished_at = isoTimestamp(finishedAt);
    if (b.finalized_at !== undefined) fields.finalized_at = isoTimestamp(b.finalized_at);
    if (durationMs !== undefined) {
      if (!Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) fail('duration_ms must be a non-negative number');
      fields.duration_ms = Number(durationMs);
    }
    if (exitCode !== undefined) {
      if (!Number.isInteger(Number(exitCode))) fail('exit_code must be an integer');
      fields.exit_code = Number(exitCode);
    }
    if (b.error !== undefined) fields.error = b.error == null ? null : String(b.error).slice(0, 2000);
    if (Array.isArray(b.results)) store.addPlaywrightResults(existing.id, b.results);
    if (Array.isArray(b.lighthouse)) store.addLighthouseResults(existing.id, b.lighthouse);

    // Finalisasi: sekali saja, jangan timpa finalized_at yang sudah ada.
    const now = new Date().toISOString();
    if (fields.status && FINAL_STATUS.has(fields.status) && !existing.finalized_at) {
      fields.finalized_at = now;
      fields.finished_at ??= now;
    }
    const run = store.patchRun(existing.id, fields);
    if (fields.finalized_at) store.markReportsStale(existing.session_id);
    res.json(run);
  }));

  app.post('/api/runs/:id/cancel', requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    if (['passed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) fail('Run sudah final', 409);
    // Run yang masih antre belum dipegang runner; tandai langsung.
    if (run.status === 'queued') {
      store.patchRun(run.id, { status: 'cancelled', finished_at: new Date().toISOString() });
      store.markReportsStale(run.session_id);
      return res.json(store.getRun(run.id));
    }
    if (!await runner.cancel(run.id)) fail('Run is not active', 409);
    res.json(store.getRun(run.id));
  }));

  app.delete('/api/runs/:id', requireAuth, requireAdmin, route(async (req, res) => {
    const run = store.getRun(id(req.params.id));
    if (!run) fail('Not found', 404);
    if (['queued', 'running', 'uploading'].includes(run.status)) fail('Run masih berjalan, batalkan dulu', 409);
    store.deleteRun(req.params.id);
    store.markReportsStale(run.session_id);
    await dropDirs(join(runsDir, run.id));
    store.audit({ userId: req.user.id, action: 'delete_run', entity: 'runs', entityId: req.params.id });
    res.sendStatus(204);
  }));

  // ─── Reports ─────────────────────────────────────────────────────────────
  // Satu laporan per scope per sesi; isinya run final terbaru per tool.
  function publishReport(sessionId, scope, userId) {
    if (!['pw', 'lh', 'both'].includes(scope)) fail("scope must be 'pw'|'lh'|'both'", 400);
    // cancelled/interrupted sudah selesai; hanya run aktif yang memblokir.
    if (store.countRunsByStatus(sessionId, ['queued', 'running', 'uploading']) > 0) fail('Ada run yang belum final', 409);
    const finals = store.listRunsBySession(sessionId).filter(r => ['passed', 'failed'].includes(r.status));
    const tools = new Set(finals.map(r => r.tool));
    if (scope === 'both' && (!tools.has('pw') || !tools.has('lh'))) fail("'both' butuh minimal satu run pw dan satu run lh", 409);
    if (scope === 'pw' && !tools.has('pw')) fail('Tidak ada run Playwright final', 409);
    if (scope === 'lh' && !tools.has('lh')) fail('Tidak ada run Lighthouse final', 409);
    const latest = tool => finals.filter(r => r.tool === tool).at(-1)?.id;
    const runIds = (scope === 'both' ? ['pw', 'lh'] : [scope]).map(latest).filter(Boolean);
    const report = store.createReport({ id: randomUUID(), sessionId, scope, runIds, builtBy: userId });
    // Satu worker build: antre berurutan, jangan blok request.
    app.__buildChain = (app.__buildChain ?? Promise.resolve())
      .then(() => buildSessionReport(store, report.id))
      .catch(err => console.error('[report]', report.id, err.message));
    return report;
  }

  app.post('/api/sessions/:id/reports', requireAuth, requireAdmin, route(async (req, res) => {
    const session = store.getSession(id(req.params.id));
    if (!session) fail('Not found', 404);
    const report = publishReport(session.id, req.body?.scope, req.user.id);
    res.status(202).json({ reportId: report.id, runIds: JSON.parse(report.run_ids ?? '[]') });
  }));

  app.get('/api/reports/:id', requireAuth, route(async (req, res) => {
    const report = store.getReport(id(req.params.id));
    if (!report) fail('Not found', 404);
    res.json(report);
  }));

  // ─── Settings (PRD §10.7) ────────────────────────────────────────────────
  // Whitelist key + rentang: key tak dikenal ditolak supaya salah ketik tidak
  // diam-diam jadi baris baru di tabel settings.
  const SETTING_LIMITS = {
    session_reuse_minutes: [1, 10080],
    log_max_bytes: [1024, 104857600],
    artifact_retention_days: [1, 365],
    report_retention_days: [1, 365],
    log_retention_days: [1, 365],
    max_queue_length: [1, 100],
    max_upload_mb: [1, 1024],
    range_default_days: [1, 365],
  };
  // Angka retensi dipakai label UI untuk semua role; sisanya tetap admin-only.
  app.get('/api/settings/public', requireAuth, route(async (req, res) => {
    const all = store.getSettings();
    res.json({
      artifact_retention_days: all.artifact_retention_days,
      report_retention_days: all.report_retention_days,
    });
  }));
  app.get('/api/settings', requireAuth, requireAdmin, route(async (req, res) => {
    res.json(store.getSettings());
  }));
  app.patch('/api/settings', requireAuth, requireAdmin, route(async (req, res) => {
    const body = req.body ?? {};
    const updates = {};
    for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
      if (body[key] === undefined) continue;
      const n = Number(body[key]);
      if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${key} harus bilangan bulat ${min}-${max}`);
      updates[key] = n;
    }
    if (!Object.keys(updates).length) fail('Tidak ada setting yang diubah');
    for (const [key, value] of Object.entries(updates)) store.setSetting(key, value);
    store.audit({ userId: req.user.id, action: 'update_settings', entity: 'settings', detail: JSON.stringify(updates) });
    res.json(store.getSettings());
  }));

  // ─── Audit ───────────────────────────────────────────────────────────────
  app.get('/api/audit', requireAuth, requireAdmin, route(async (req, res) => {
    res.json(store.listAudit({ limit: req.query.limit, entity: req.query.entity }));
  }));

  app.get('/artifacts/reports/:reportId/*', requireAuth, route(async (req, res) => {
    const report = store.getReport(id(req.params.reportId));
    if (!report) fail('Not found', 404);
    // Link ke folder (mis. "<runId>/") dipetakan ke index.html; link lama tetap hidup.
    const asked = (req.params[0] ?? '').replace(/\/$/, '');
    const rel = asked === '' || !/\.[a-z0-9]+$/i.test(asked) ? (asked ? asked + '/index.html' : 'index.html') : asked;
    if (rel.includes('..')) fail('Invalid path', 400);
    const base = join(reportsDir, report.id);
    // Report lama tidak punya report.md; susun dari DB supaya tautan tidak 404.
    if (rel === 'report.md') {
      const cached = await realpath(join(base, rel)).catch(() => null);
      if (!cached) {
        const markdown = reportMarkdownFor(store, report.id);
        if (!markdown) fail('Not found', 404);
        res.type('text/markdown; charset=utf-8');
        res.setHeader('X-Robots-Tag', 'noindex');
        res.send(markdown);
        return;
      }
    }
    // realpath melempar ENOENT kalau file belum ada (mis. report lama tanpa report.md).
    const file = await realpath(join(base, rel)).catch(() => null);
    if (!file || !file.startsWith(await realpath(base).catch(() => base))) fail('Not found', 404);
    const stat = await lstat(file).catch(() => null);
    if (!stat?.isFile()) fail('Not found', 404);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Robots-Tag', 'noindex');
    res.sendFile(file);
  }));

  app.get('/artifacts/:runId/*', requireAuth, route(async (req, res) => {
    const runId = id(req.params.runId);
    const run = store.getRun(runId);
    if (!run) fail('Not found', 404);
    // Sama: folder artifact (mis. "playwright-report/") dipetakan ke index.html.
    const asked = (req.params[0] ?? '').replace(/\/$/, '');
    const rel = asked === '' || !/\.[a-z0-9]+$/i.test(asked) ? (asked ? asked + '/index.html' : 'index.html') : asked;
    if (rel.includes('..')) fail('Invalid path', 400);
    const base = join(runsDir, runId, 'artifacts');
    const file = await realpath(join(base, rel)).catch(() => null);
    if (!file || !file.startsWith(await realpath(base).catch(() => base))) fail('Path tidak ada', 404);
    const stat = await lstat(file).catch(() => null);
    if (!stat?.isFile()) fail('Not found', 404);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Robots-Tag', 'noindex');
    const isDownload = /\.(zip|trace)$/i.test(rel);
    if (isDownload) res.setHeader('Content-Disposition', 'attachment');
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
  const staleUploads = await store.init();
  const runsDirEnv = resolve(process.env.RUNS_DIR ?? join(root, '.runs'));
  // PRD §8.6/A32: run `uploading` > 24 jam dibersihkan folder + baris artifact-nya.
  if (staleUploads.length) {
    await Promise.all(staleUploads.map(id => rm(join(runsDirEnv, id), { recursive: true, force: true }).catch(() => {})));
    console.log(`membersihkan ${staleUploads.length} run upload basi`);
  }
  const origins = allowlist(process.env.TARGET_ALLOWLIST);
  if (!origins.length) throw new Error('TARGET_ALLOWLIST must contain at least one exact origin');
  // PRD §8.6: retensi harian. Opt-in lewat env supaya deployment bisa pakai cron
  // eksternal (scripts/retention.mjs) tanpa dua job jalan bersamaan.
  // PRD §8.6/A60: backup wajib jalan SEBELUM retensi. Kalau RETENTION_INTERVAL_MS
  // aktif tapi BACKUP_INTERVAL_MS lebih lambat/lagi tak diset, jadwalnya terbalik
  // (retensi duluan → yang tersimpan hanya sisa). Tolak saat startup.
  const retentionMs = Number(process.env.RETENTION_INTERVAL_MS ?? 0);
  const backupMs = Number(process.env.BACKUP_INTERVAL_MS ?? 0);
  if (retentionMs > 0 && (backupMs === 0 || backupMs > retentionMs)) {
    throw new Error('BACKUP_INTERVAL_MS harus ≤ RETENTION_INTERVAL_MS (A60: backup sebelum retensi)');
  }
  if (retentionMs > 0) {
    const reportsDirEnv = resolve(process.env.REPORTS_DIR ?? join(root, '.reports'));
    const backupDir = resolve(process.env.BACKUP_DIR ?? join(root, 'data', 'backups'));
    const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 7);
    const job = async () => {
      // Backup dulu, retensi belakangan. Backup gagal → retensi dilewati.
      try {
        const b = await backupDatabase({ store, backupDir, keepDays });
        console.log('backup:', JSON.stringify({ file: b.file, bytes: b.bytes, pruned: b.pruned }));
      } catch (err) {
        console.error('[backup] gagal, retensi dilewati:', err.message);
        return;
      }
      await runRetention({ store, runsDir: runsDirEnv, reportsDir: reportsDirEnv })
        .then(r => console.log('retensi:', JSON.stringify(r)))
        .catch(err => console.error('[retensi]', err.message));
    };
    setTimeout(job, 60_000).unref();
    setInterval(job, retentionMs).unref();
  }
  const runner = new Runner(store, {
    origins,
    runsDir: runsDirEnv,
    timeout: Number(process.env.RUN_TIMEOUT_MS ?? 300000),
  });
  const app = createApp({ store, runner, token: null, origins });
  const server = app.__wssServer ?? createServer(app);
  server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () => console.log('QA backend listening', server.address()));
  const close = async () => {
    if (runner.active) { await runner.cancel(runner.active.runId); await runner.active?.done; }
    for (const client of app.__wss?.clients ?? []) client.close();
    server.close();
    await store.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return { server, store, runner };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
