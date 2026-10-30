import assert from 'node:assert/strict';
import { stripAnsi } from '../ansi.mjs';

// Pesan error Playwright yang sampai ke UI tidak boleh memuat kode warna.
const raw = '\u001b[2mTimeoutError\u001b[22m: locator.fill: Timeout 60000ms exceeded.\n    at [2mwaiting[22m';
assert.equal(stripAnsi(raw), 'TimeoutError: locator.fill: Timeout 60000ms exceeded.\n    at waiting');
assert.equal(stripAnsi('[31mfailed[39m'), 'failed');
assert.equal(stripAnsi('bersih'), 'bersih');
assert.equal(stripAnsi(''), '');

console.log('ok: ansi');
