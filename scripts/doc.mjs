// Render latest.json -> markdown buat Docusaurus.
//   node scripts/doc.mjs
// Hasil: docusaurus/docs/laporan-playwright.md, docusaurus/docs/laporan-lighthouse.md
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(join(root, 'latest.json'), 'utf8'));
const docs = join(root, 'docusaurus', 'docs');
const artefak = join(root, 'docusaurus', 'static', 'artefak');
const laporanDir = join(root, 'docusaurus', 'static', 'laporan');
const waktu = data.generatedAt?.replace('T', ' ').slice(0, 16) ?? '?';
const cap = '> Dihasilkan otomatis dari latest.json. Jangan edit manual — jalankan `npm run lapor`.';
const esc = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const num = (n) => (typeof n === 'number' ? n.toLocaleString('id-ID') : '—');
const kb = (b) => (typeof b === 'number' ? `${Math.round(b / 1024).toLocaleString('id-ID')} KiB` : '—');
const ms = (n) => (typeof n === 'number' ? `${num(Math.round(n))} ms` : '—');
const pct = (s) => (typeof s === 'number' ? Math.round(s * 100) : '—');
const detik = (n) => `${((n ?? 0) / 1000).toFixed(1)} s`;
const label = {passed: 'PASS', failed: 'FAIL', timedOut: 'TIMEOUT', interrupted: 'STOP', skipped: 'SKIP'};

const tabel = (head, rows) =>
  rows.length
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
    : '_tidak ada_';

// ---------- detail Lighthouse (generik: table / opportunity / list) ----------
const sel = (v) => {
  if (v && typeof v === 'object') {
    if (v.selector) return `\`${esc(v.selector)}\``;
    if (v.type === 'node') return `\`${esc(v.selector ?? v.snippet ?? '?')}\``;
    if (v.type === 'url') return esc(v.url ?? v.value ?? '?');
  }
  return esc(v);
};

const selDetail = (headings, items) => {
  const rows = items.map((it) =>
    headings.map((h) => {
      const v = it?.[h.key];
      if (v && typeof v === 'object' && v.type === 'node') return sel(v);
      if (h.valueType === 'bytes') return kb(v);
      if (h.valueType === 'ms' || h.valueType === 'timespanMs') return ms(v);
      if (h.valueType === 'url') return v ? `<${esc(v)}>` : '—';
      return esc(v);
    }),
  );
  return tabel(
    headings.map((h) => esc(h.label || h.key)),
    rows,
  );
};

const renderDetail = (d) => {
  if (!d) return '';
  if (d.type === 'list') return (d.items ?? []).map(renderDetail).filter(Boolean).join('\n\n');
  if (d.headings?.length && d.items?.length) {
    const t = selDetail(d.headings, d.items);
    const sub = (d.items ?? [])
      .flatMap((it) => (it?.subItems ?? []).filter((s) => s?.url).map((s) => `- \`${esc(s.url)}\` — ${ms(s.blockingTime ?? s.wastedMs)}`))
      .join('\n');
    return [t, sub].filter(Boolean).join('\n\n');
  }
  return '';
};

// ---------- Lighthouse ----------
const lh = data.lighthouse;
let lhMd = `${cap}\n\n# Log Lighthouse\n\nDigenerate ${waktu} UTC. Skor 0–100; angka kecil = buruk.`;

if (!lh) {
  lhMd += '\n\nBelum ada hasil Lighthouse. Jalankan `npm run cek:lh`.\n';
} else {
  for (const [id, t] of Object.entries(lh.targets)) {
    const meta = t.target ?? {};
    lhMd += `\n\n## ${id} — ${meta.site ?? id}\n\n${meta.dist ?? ''}\n`;
    lhMd += `\n${t.errors} error, ${t.warnings} warning, ${t.urls.length} URL diukur${t.stale ? ' — **data lama**' : ''}.\n`;

    for (const u of t.urls) {
      const s = u.scores ?? {};
      lhMd += `\n### \`${u.path}\`\n\n`;
      lhMd += tabel(
        ['Perf', 'A11y', 'BP', 'SEO'],
        [[pct(s.performance), pct(s.accessibility), pct(s['best-practices']), pct(s.seo)].map(String)],
      );
      lhMd += `\n\n**Metrik performa**\n\n`;
      lhMd += tabel(
        ['Metrik', 'Nilai', 'Skor', 'Bobot'],
        Object.entries(u.metrics ?? {}).map(([k, m]) => [k, esc(m.display), pct(m.score), `${Math.round(m.weight ?? 0)}%`]),
      );

      if (u.issues?.length) {
        lhMd += `\n\n**Masalah, urut dampak**\n\n`;
        lhMd += tabel(
          ['#', 'Audit', 'Kategori', 'Temuan', 'Dampak'],
          u.issues.map((x, i) => [String(i + 1), `\`${x.id}\``, x.category, esc(x.display || x.title), x.impact.toFixed(2)]),
        );
      }

      for (const x of (u.issues ?? []).slice(0, 5)) {
        const d = renderDetail(x.details);
        if (!d) continue;
        lhMd += `\n\n#### \`${x.id}\` — ${esc(x.title)}\n\n`;
        if (x.description) lhMd += `${esc(x.description)}\n\n`;
        lhMd += d;
      }
      if (u.report) {
        const nama = basename(u.report);
        await mkdir(laporanDir, {recursive: true});
        await copyFile(join(root, u.report), join(laporanDir, nama)).catch(() => null);
        lhMd += `\n\n[Laporan mentah](/laporan/${nama})`;
      }
      lhMd += '\n';
    }

    if (t.assertionDetails?.length) {
      lhMd += `\n### Assertion\n\n`;
      lhMd += tabel(
        ['Level', 'Audit', 'URL', 'Harapan', 'Kenyataan', 'Operator'],
        t.assertionDetails.map((a) => [a.level, `\`${a.audit}\``, `\`${a.url}\``, String(a.expected), String(a.actual), a.operator]),
      );
      lhMd += '\n';
    }
  }
}

// ---------- Playwright ----------
const pw = data.playwright;
let pwMd = `${cap}\n\n# Log Playwright\n\nDigenerate ${waktu} UTC.`;

if (!pw) {
  pwMd += '\n\nBelum ada hasil Playwright. Jalankan `npm run cek:pw`.\n';
} else {
  pwMd += `\n\n${pw.passed} pass, ${pw.failed} gagal, ${pw.skipped} skip — total ${detik(pw.ms)}${pw.stale ? ' — **data lama**' : ''}.\n`;
  pwMd += `\n${tabel(['Situs', 'Host', 'Akun', 'Lulus'], (pw.targets ?? []).map((g) => [g.site, g.host, g.akun ? 'ya' : 'tidak', `${g.passed}/${g.total}`]))}\n`;

  for (const t of pw.tests ?? []) {
    const st = label[t.status] ?? t.status;
    pwMd += `\n## ${esc(t.title)} — ${st}\n\n`;
    pwMd += `\`${t.file}\` · ${esc(t.site)} · ${detik(t.ms)}\n`;

    if (t.steps?.length) {
      pwMd += `\n\n${tabel(
        ['#', 'Langkah', 'Durasi', 'Status'],
        t.steps.map((s, i) => [String(i + 1), esc(s.title), detik(s.ms), s.error ? '**gagal**' : 'ok']),
      )}`;
    }

    if (t.error) pwMd += `\n\n\`\`\`\n${t.error}\n\`\`\``;

    const gambar = [];
    for (const a of t.attachments ?? []) {
      if (!a.contentType?.startsWith('image/')) continue;
      const nama = `${t.file.replace(/\.spec\.ts$/, '')}-${basename(a.path)}`;
      await mkdir(artefak, {recursive: true});
      await copyFile(join(root, a.path), join(artefak, nama)).catch(() => null);
      gambar.push(`![${esc(a.name)}](/artefak/${nama})`);
    }
    if (gambar.length) pwMd += `\n\n${gambar.join('\n\n')}`;
    pwMd += '\n';
  }
}

await mkdir(docs, {recursive: true});
await writeFile(join(docs, 'laporan-lighthouse.md'), lhMd);
await writeFile(join(docs, 'laporan-playwright.md'), pwMd);
console.log('docs -> docusaurus/docs/laporan-lighthouse.md, laporan-playwright.md');
