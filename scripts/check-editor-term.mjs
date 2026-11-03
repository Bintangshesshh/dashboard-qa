// Check ringkas T7/T8: editor + tema terminal/form + panel run.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const css = readFileSync(new URL('../web/app/pb.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../web/app/(dashboard)/playwright/page.tsx', import.meta.url), 'utf8');
const lh = readFileSync(new URL('../web/app/(dashboard)/lighthouse/page.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../web/app/(dashboard)/run-panel.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../web/app/(dashboard)/code-editor.tsx', import.meta.url), 'utf8');

// 1) Editor satu lapisan: CodeMirror, bukan textarea transparan di atas <pre>.
assert.ok(editor.includes('@uiw/react-codemirror'), 'editor harus CodeMirror');
assert.ok(!editor.includes('<textarea'), 'editor tidak boleh textarea overlay');
assert.ok(!/from "shiki"/.test(editor) && !editor.includes('import("shiki")'), 'shiki harus sudah dibuang');
for (const token of ['lineNumbers: true', 'highlightActiveLine: true']) {
  assert.ok(editor.includes(token), `opsi editor hilang: ${token}`);
}
assert.ok(!page.includes('data-stream={l.stream}>{stripAnsi'), 'halaman masih merender semua stream ke terminal');

// 2) Tema editor & terminal sama (#0d1117) supaya tidak ada blok abu di tengah.
assert.match(css, /\.pb-editor \{[^}]*background: #0d1117/, 'editor bukan #0d1117');
assert.match(css, /\.pb-editor \.cm-editor \{[^}]*background: #0d1117/, 'cm-editor bukan #0d1117');
assert.match(css, /\.pb-editor \.cm-gutters \{[^}]*background: #0d1117/, 'gutter bukan #0d1117');
assert.match(css, /\.pb-editor \.cm-selectionBackground,[\s\S]{0,80}background: rgba\(56, 139, 253, \.35\)/, 'warna seleksi hilang');
assert.match(css, /\.pb-editor \.cm-content \{ padding: 12px 0; \}/, 'padding konten editor hilang');

// 3) Terminal satu tema, dipakai satu komponen bersama dua halaman.
assert.match(css, /\.pb-term \{[^}]*background: #0d1117/, 'pb-term belum #0d1117');
assert.match(css, /\.pb-term \{[^}]*font-size: 12\.5px/, 'pb-term belum 12.5px');
assert.match(css, /\.pb-term \[data-stream="stderr"\]/, 'warna stderr hilang');
assert.match(css, /\.pb-term \[data-stream="system"\]/, 'warna system hilang');
assert.ok(panel.includes('className="pb-term"'), 'RunPanel tidak memakai pb-term');
assert.ok(panel.includes('data-stream={l.stream}'), 'log belum diberi data-stream');
assert.ok(page.includes('<RunPanel') && lh.includes('<RunPanel'), 'pb-term tidak dipakai dua halaman');

// 4) Form LH di .pb-panel, bg-2 didefinisikan di kedua tema.
assert.ok(lh.includes('pb-panel pb-grid'), 'form LH belum dibungkus pb-panel');
assert.equal((css.match(/--bg-2:/g) ?? []).length, 2, '--bg-2 harus ada di light & dark');
assert.ok(lh.includes('pb-hint'), 'hint form LH hilang');

// 5) Bug terminal: baris console/network JSON tidak boleh ikut ke tab Terminal.
assert.ok(panel.includes('e.stream === "console"') && panel.includes('e.stream === "network"'), 'RunPanel belum memisah stream');
assert.ok(/continue;/.test(panel), 'stream console/network harus di-skip dari Terminal');

// 6) Artifact harus masuk DB sebelum status final: UI berhenti polling begitu
//    status final, jadi urutan terbalik bikin "report HTML tidak ada".
const runner = readFileSync(new URL('../server/runner.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
for (const tool of ['pw', 'lh']) {
  const collect = runner.indexOf(`collectArtifacts(runId, dir, '${tool}')`);
  const final = runner.indexOf(`    await this.store.patchRun(runId, {\n      status,`, collect);
  assert.ok(collect > 0, `collectArtifacts ${tool} tidak ada`);
  assert.ok(final > collect, `status final ${tool} di-patch sebelum artifact dikumpulkan`);
}

console.log('ok: editor CodeMirror + tema terminal/form + panel Terminal/Console/Network');
