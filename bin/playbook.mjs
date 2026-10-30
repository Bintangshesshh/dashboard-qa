#!/usr/bin/env node
// CLI Playbook (PRD §7, C6). Mengorkestrasi endpoint yang sudah ada:
// login → cli-token, run lokal → runs/local + start + logs + artifacts + PATCH.
// ponytail: satu file, tanpa dependensi. Kalau perlu `record`/codegen, tambah perintah baru di sini.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Runner, lhConfig, filesBelow } from '../server/runner.mjs';

const CRED_DIR = join(homedir(), '.playbook');
const CRED_FILE = join(CRED_DIR, 'credentials.json');
const OUT_ROOT = '.playbook-runs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

async function credentials() {
  try {
    return JSON.parse(await readFile(CRED_FILE, 'utf8'));
  } catch {
    die('Belum login. Jalankan: playbook login --server http://127.0.0.1:3001');
  }
}

async function api(path, { method = 'GET', body, raw, token, baseUrl, cookie } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': 'application/octet-stream' } : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
  return { json, res };
}

// ─── login / logout / whoami ───────────────────────────────────────────────
async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  // Password: baca stdin langsung. `rl._writeToOutput` privat readline dan sudah
  // tidak ada di Node baru, jadi jangan dipakai.
  if (!hidden || !process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('');
    rl.close();
    return answer;
  }
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise(resolve => {
    let buf = '';
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') { // Ctrl+C
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function login() {
  const baseUrl = String(flag('server', process.env.PLAYBOOK_URL ?? 'http://127.0.0.1:3001')).replace(/\/$/, '');
  const username = process.env.PLAYBOOK_USER ?? await ask('Username: ');
  const password = process.env.PLAYBOOK_PASSWORD ?? await ask('Password: ', { hidden: true });
  const { res } = await api('/api/auth/login', { method: 'POST', body: { username, password }, baseUrl });
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')])
    .filter(Boolean).map(c => c.split(';')[0]).join('; ');
  if (!cookie) die('Login tidak mengembalikan cookie');
  // Token bearer supaya perintah berikutnya tidak butuh cookie.
  const { json } = await api('/api/auth/cli-token', { method: 'POST', body: { label: `cli-${hostname()}` }, baseUrl, cookie });
  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(CRED_FILE, JSON.stringify({ baseUrl, token: json.token, user: username }, null, 2));
  await chmod(CRED_FILE, 0o600).catch(() => {});
  console.log(`Login sebagai ${username}. Token disimpan di ${CRED_FILE}`);
}

async function logout() {
  await rm(CRED_FILE, { force: true });
  console.log('Kredensial lokal dihapus. Cabut token di /settings kalau perlu.');
}

async function whoami() {
  const cred = await credentials();
  const { json } = await api('/api/me', { token: cred.token, baseUrl: cred.baseUrl });
  console.log(`${json.username} (${json.role}) @ ${cred.baseUrl}`);
}

// ─── run lokal ─────────────────────────────────────────────────────────────
async function findTestFile(cred, specArg, tool) {
  const projects = (await api('/api/projects', { token: cred.token, baseUrl: cred.baseUrl })).json;
  const wanted = String(flag('project', '')).toLowerCase();
  const project = wanted
    ? projects.find(p => p.slug.toLowerCase() === wanted || p.name.toLowerCase() === wanted)
    : projects.length === 1 ? projects[0] : null;
  if (!project) die(wanted ? `Project "${wanted}" tidak ada` : 'Project lebih dari satu, pakai --project <slug>');

  const files = (await api(`/api/test-files?project=${project.id}&tool=${tool}`, { token: cred.token, baseUrl: cred.baseUrl })).json;
  const norm = s => s.replaceAll('\\', '/');
  const target = norm(specArg);
  const match = files.find(f => norm(f.path) === target)
    ?? files.find(f => norm(f.path).endsWith('/' + target))
    ?? files.find(f => norm(f.path).split('/').pop() === target);
  if (!match) {
    die(`Test file "${specArg}" tidak terdaftar untuk ${project.slug} (${tool}).\nTersedia:\n${files.map(f => '  ' + f.path).join('\n') || '  (kosong)'}`);
  }
  return match;
}

// Log dikirim per batch supaya run panjang tidak menahan semuanya di memori.
function makeLogger(cred, runId) {
  let queue = [];
  let seq = 0;
  let chain = Promise.resolve();
  const flush = () => {
    if (!queue.length) return chain;
    const entries = queue;
    queue = [];
    chain = chain.then(() => api(`/api/runs/${runId}/logs`, {
      method: 'POST', token: cred.token, baseUrl: cred.baseUrl,
      body: { entries: entries.map(e => ({ ...e, seq: ++seq })) },
    })).catch(err => console.error('[log]', err.message));
    return chain;
  };
  const timer = setInterval(flush, 1000);
  return {
    push(stream, text) {
      for (const line of String(text).split('\n')) if (line) queue.push({ stream, text: line + '\n', at: new Date().toISOString() });
      if (queue.length >= 200) flush();
    },
    async done() { clearInterval(timer); await flush(); },
  };
}

async function uploadArtifacts(cred, runId, artifactsDir, tool) {
  const files = await filesBelow(artifactsDir).catch(() => []);
  for (const rel of files) {
    const body = await readFile(join(artifactsDir, rel));
    const kind = rel.endsWith('.json') ? (tool === 'lh' ? 'lh-json' : 'pw-json')
      : rel.endsWith('.html') ? (tool === 'lh' ? 'lh-html' : 'pw-html')
      : rel.includes('trace') ? 'trace'
      : rel.includes('video') ? 'video'
      : /\.(png|jpe?g)$/i.test(rel) ? 'screenshot'
      : 'log';
    await api(`/api/runs/${runId}/artifacts?kind=${kind}&path=${encodeURIComponent(rel)}`, {
      method: 'PUT', raw: body, token: cred.token, baseUrl: cred.baseUrl,
    });
  }
  return files.length;
}

// Unggah hasil parse + status final. Dipakai `run` dan `upload` (A16).
async function finalize(cred, runId, { outDir, tool, exitCode, durationMs, error }) {
  // Parser milik Runner dipakai ulang supaya bentuk hasil sama dengan run server.
  const parser = new Runner({}, { runsDir: outDir });
  const parsed = tool === 'lh'
    ? await parser.parseLighthouse(outDir)
    : await parser.parsePlaywright(outDir);
  const uploaded = await uploadArtifacts(cred, runId, join(outDir, 'artifacts'), tool);

  const patch = {
    exitCode, durationMs, error: error ?? null,
    ...(tool === 'lh' ? { lighthouse: parsed } : { results: parsed }),
  };
  const ok = !error && (tool === 'lh' ? exitCode === 0 : parsed.length > 0 && parsed.every(r => r.status === 'passed'));
  patch.status = ok ? 'passed' : 'failed';
  if (!error && tool === 'pw' && !parsed.length) patch.error = 'JSON Playwright tidak ditemukan';
  await api(`/api/runs/${runId}`, { method: 'PATCH', body: patch, token: cred.token, baseUrl: cred.baseUrl });
  return { status: patch.status, tests: parsed.length, uploaded };
}

async function run() {
  const specArg = argv[1];
  if (!specArg || specArg.startsWith('--')) die('Usage: playbook run <spec|config> [--env local|staging|production] [--confirm <nama project>] [--project slug] [--session id]');
  const cred = await credentials();
  const env = String(flag('env', 'local'));
  const tool = /lighthouserc|lhci/i.test(specArg) ? 'lh' : 'pw';
  const testFile = await findTestFile(cred, specArg, tool);
  // PRD §8.5: production harus diketik ulang nama project-nya.
  const confirm = flag('confirm', undefined) ?? undefined;

  const created = (await api('/api/runs/local', {
    method: 'POST', token: cred.token, baseUrl: cred.baseUrl,
    body: { testFileId: testFile.id, env, confirm, sessionId: flag('session', undefined) ?? undefined },
  })).json;
  const { runId, targetUrl, code, config } = created;
  console.log(`run ${runId} · ${tool} · ${env} · ${targetUrl ?? '(tanpa URL)'}`);

  const outDir = resolve(OUT_ROOT, runId);
  const artifactsDir = join(outDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const log = makeLogger(cred, runId);
  await api(`/api/runs/${runId}/start`, { method: 'POST', token: cred.token, baseUrl: cred.baseUrl });
  log.push('system', `[cli] ${testFile.path} → ${targetUrl ?? '-'}\n`);

  const childEnv = {
    ...process.env,
    ...(targetUrl ? { BASE_URL: targetUrl } : {}),
    PLAYBOOK_CAPTURE_FILE: join(outDir, 'capture.jsonl'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: join(artifactsDir, 'report.json'),
    PLAYWRIGHT_HTML_OUTPUT_DIR: join(artifactsDir, 'playwright-report'),
  };

  let args;
  let cwd = process.cwd();
  let cleanup = null;
  if (tool === 'pw') {
    // Kode dari DB menang; spec eureka mengimpor file relatif, jadi ditulis di sebelah aslinya.
    let specPath = resolve(cwd, testFile.path);
    if (code?.trim()) {
      const original = resolve(cwd, testFile.path);
      const generated = join(dirname(original), `.playbook-cli-${runId.slice(0, 8)}.spec.ts`);
      await writeFile(generated, code);
      cleanup = generated;
      specPath = generated;
    }
    // Config sendiri: reporter harus menulis ke artifacts run, bukan pw-out/ repo.
    const cfgPath = join(outDir, 'playwright.config.mjs');
    await writeFile(cfgPath, `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: ${JSON.stringify(dirname(specPath))},
  testMatch: ${JSON.stringify(basename(specPath))},
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: ${JSON.stringify(join(artifactsDir, 'report.json'))} }],
    ['html', { outputDir: ${JSON.stringify(join(artifactsDir, 'playwright-report'))}, open: 'never' }],
  ],
  use: { ...devices['Desktop Chrome'], navigationTimeout: 90000 },
});
`);
    args = ['playwright', 'test', `--config=${cfgPath}`, `--output=${artifactsDir}`];
  } else {
    const cfg = (() => { try { return JSON.parse(config ?? 'null'); } catch { return null; } })();
    const cfgPath = join(outDir, 'lighthouserc.cjs');
    await writeFile(cfgPath, cfg
      ? lhConfig(cfg, targetUrl, artifactsDir)
      : `module.exports = { ci: { collect: { url: [${JSON.stringify(targetUrl)}] }, upload: { target: 'filesystem', outputDir: ${JSON.stringify(artifactsDir.replaceAll('\\', '/'))} } } };\n`);
    args = ['lhci', 'autorun', '--config=' + cfgPath, '--upload.target=filesystem', '--upload.outputDir=' + artifactsDir];
    cwd = outDir;
  }

  const started = Date.now();
  const code_ = await new Promise(res => {
    const child = spawn('npx', args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    child.stdout.on('data', d => { process.stdout.write(d); log.push('stdout', d); });
    child.stderr.on('data', d => { process.stderr.write(d); log.push('stderr', d); });
    child.on('error', e => { log.push('stderr', e.message + '\n'); res(1); });
    child.on('close', res);
  });
  if (cleanup) await rm(cleanup, { force: true }).catch(() => {});

  // capture.jsonl → stream console/network, sama seperti runner server.
  const capture = await readFile(join(outDir, 'capture.jsonl'), 'utf8').catch(() => '');
  for (const line of capture.split('\n')) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item?.stream && item?.payload) log.push(item.stream, JSON.stringify(item.payload) + '\n');
    } catch { /* baris rusak diabaikan */ }
  }

  await log.done();
  const result = await finalize(cred, runId, { outDir, tool, exitCode: code_, durationMs: Date.now() - started });
  console.log(`${result.status} · ${result.tests} hasil · ${result.uploaded} artifact · ${cred.baseUrl}/runs/${runId}`);
  process.exit(result.status === 'passed' ? 0 : 1);
}

// A16: hasil lokal tersimpan walau jaringan putus saat run.
async function upload() {
  const runId = argv[1];
  if (!runId) die('Usage: playbook upload <runId> [--dir folder]');
  const cred = await credentials();
  const outDir = resolve(String(flag('dir', join(OUT_ROOT, runId))));
  const runInfo = (await api(`/api/runs/${runId}`, { token: cred.token, baseUrl: cred.baseUrl })).json;
  const result = await finalize(cred, runId, { outDir, tool: runInfo.tool, exitCode: 0, durationMs: 0 });
  console.log(`${result.status} · ${result.tests} hasil · ${result.uploaded} artifact`);
}

async function status() {
  const cred = await credentials();
  const runId = argv[1];
  if (runId) {
    const run = (await api(`/api/runs/${runId}`, { token: cred.token, baseUrl: cred.baseUrl })).json;
    console.log(`${run.id} ${run.tool} ${run.status} ${run.error ?? ''}`.trim());
    for (const a of run.artifacts) console.log(`  ${a.kind} ${a.path} (${a.bytes ?? '?'} B)`);
    return;
  }
  const runs = (await api('/api/runs?limit=10', { token: cred.token, baseUrl: cred.baseUrl })).json;
  if (!runs.length) return console.log('Belum ada run.');
  for (const r of runs) console.log(`${r.id.slice(0, 8)} ${r.tool.padEnd(2)} ${r.status.padEnd(11)} ${r.session_label ?? ''}`);
}

const commands = { login, logout, whoami, run, upload, status };
if (!commands[cmd]) {
  console.log(`Playbook CLI

  playbook login [--server URL]        simpan token di ~/.playbook/credentials.json
  playbook logout
  playbook whoami
  playbook run <spec|config> [--env local|staging|production] [--confirm <nama project>] [--project slug] [--session id]
  playbook upload <runId> [--dir folder]   unggah hasil lokal (A16)
  playbook status [runId]
`);
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch(err => die(err.message));
