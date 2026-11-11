const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const filename = path.join(__dirname, 'lh-config-editor.tsx');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const editor = new Module(filename, module);
editor.filename = filename;
editor.paths = module.paths;
// Type-only and UI dependencies are irrelevant to parser checks.
editor.require = id => id.startsWith('../../lib/') ? {} : require(id);
editor._compile(compiled, filename);
const { parseExtraUrl, lhConfigError, LH_CATEGORIES } = editor.exports;
const target = 'https://example.test';
assert.equal(parseExtraUrl('https://example.test/a?q=1#x', target, target), 'https://example.test/a?q=1#x');
assert.equal(parseExtraUrl('/a?q=1#x', target, target), 'https://example.test/a?q=1#x');
assert.equal(parseExtraUrl('https://other.test/a', target, target), 'https://other.test/a');
assert.equal(parseExtraUrl('//other.test/a', target, target), '//other.test/a');
assert.equal(parseExtraUrl('/\\other.test/a', target, target), '/\\other.test/a');
assert.equal(parseExtraUrl('invalid', target, target), 'invalid');
const scores = Object.fromEntries(LH_CATEGORIES.map(c => [c.key, 60]));
assert.match(lhConfigError({ target, extra: ['//other.test/a'], runs: 1, scores }), /tidak valid/);
assert.equal(lhConfigError({ target, extra: ['https://other.test/a'], runs: 1, scores }), '');
console.log('Lighthouse URL parser OK');
