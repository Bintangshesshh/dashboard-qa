import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specPath, readSpec, writeSpec, sha } from '../spec-sync.mjs';

const root = await mkdtemp(join(tmpdir(), 'spec-sync-'));

// path traversal / absolut ditolak
for (const bad of ['../x.ts', 'a/../../b.ts', 'C:\\win\\abs.ts']) {
  assert.throws(() => specPath(root, bad), /valid|keluar/);
}
assert.throws(() => specPath(root, ''), /valid/);

const abs = specPath(root, 'eureka/cart.spec.ts');
assert.equal(await readSpec(abs), null, 'belum ada → null');

const h1 = await writeSpec(abs, 'hello');
assert.equal(h1, sha('hello'));
const r1 = await readSpec(abs);
assert.equal(r1.hash, h1);
assert.equal(r1.text, 'hello');

// hash berubah saat isi berubah → dasar guard konflik
const h2 = await writeSpec(abs, 'world');
assert.notEqual(h1, h2);

assert.equal(await readFile(abs, 'utf8'), 'world');
console.log('PASS: spec-sync path guard, null read, hash berubah');
