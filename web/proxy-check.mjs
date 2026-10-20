import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = process.env.CHECK_URL ?? 'http://127.0.0.1:3000';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Local verification only');
const token = process.env.QA_OPERATOR_TOKEN;
assert.ok(token, 'Set QA_OPERATOR_TOKEN');
const headers = { Authorization: 'Bearer ' + token };
const response = await fetch(base + '/api/runs', { headers });
assert.equal(response.status, 200);
const runs = await response.json();
const run = runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
assert.ok(run, 'Create a local fixture run first');
const replay = url => new Promise((resolve, reject) => {
  const ws = new WebSocket(url), logs = [];
  const timer = setTimeout(() => { ws.terminate(); reject(new Error('Replay timed out: ' + url)); }, 8000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', token, runId: run.id, after: 0 })));
  ws.on('error', reject);
  ws.on('close', () => clearTimeout(timer));
  ws.on('message', data => {
    const event = JSON.parse(data);
    if (event.type === 'log') logs.push(event);
    if (event.type === 'replay-complete') { clearTimeout(timer); ws.close(); resolve(logs); }
  });
});
const direct = await replay('ws://127.0.0.1:3001/ws');
const proxied = await replay(base.replace(/^http/, 'ws') + '/ws');
assert.ok(direct.length, 'Latest run must contain logs');
assert.deepEqual(proxied, direct);
assert.ok(run.docsUrl, 'Latest run must contain docs');
const docs = await fetch(new URL(run.docsUrl, base), { headers });
assert.equal(docs.status, 200);
assert.match(await docs.text(), /Docusaurus/);
console.log('PASS', run.id, direct.length, 'identical replay logs; same-origin Docusaurus 200');
