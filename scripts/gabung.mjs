// Normalizer: pw-out/hasil.json + lhci-results-<target>/*.report.json
//   -> latest.json (root) + docusaurus/static/data/latest.json
//
//   node scripts/gabung.mjs                -> refresh semua yang ada datanya
//   node scripts/gabung.mjs --only=pw      -> Playwright aja, Lighthouse dibawa run lama (stale)
//   node scripts/gabung.mjs --only=lh
//   node scripts/gabung.mjs --target=ebh   -> batasi satu target Lighthouse
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SPEC, SITES, LIGHTHOUSE_TARGETS} from '../qa.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'latest.json');
const destStatic = join(root, 'docusaurus', 'static', 'data', 'latest.json');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const readJsonOrNull = (p) => readJson(p).catch(() => null);
const pad = (s, n) => String(s).padEnd(n);
const pct = (s) => Math.round((s ?? 0) * 100);
const cut = (s, n = 200) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s);
const round = (n) => (typeof n === 'number' ? Math.round(n) : n);

const arg = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1] || fallback;

const parts = arg('only', 'all').split(',').flatMap((p) => (p === 'all' ? ['pw', 'lh'] : p));
const wantPw = parts.includes('pw');
const wantLh = parts.includes('lh');
const onlyTarget = arg('target', null);
const now = new Date().toISOString();
const prev = await readJsonOrNull(dest);

// ---------- Playwright ----------
const situs = (file) => SITES[SPEC[file]] ?? {site: file, host: '?', akun: false};

const trimSteps = (steps = []) =>
  steps.slice(0, 40).map((s) => ({
    title: cut(s.title ?? '', 120),
    ms: round(s.duration ?? 0),
    error: s.error ? cut(s.error.message ?? String(s.error), 300) : null,
  }));

let playwright = null;
if (wantPw) {
  const r = await readJsonOrNull(join(root, 'pw-out', 'hasil.json'));
  // Langkah (termasuk aksi pw:api) dari reporter sendiri; reporter JSON bawaan buang itu.
  const langkah = await readJsonOrNull(join(root, 'pw-out', 'langkah.json'));
  const petaLangkah = new Map((langkah?.tests ?? []).map((t) => [`${t.file}|${t.title}`, t.steps]));
  if (r) {
    const tests = [];
    const walk = (s, file) => {
      const f = s.file ?? file ?? '';
      for (const spec of s.specs ?? []) {
        const res = spec.tests?.[0]?.results ?? [];
        const last = res[res.length - 1] ?? {};
        const nama = f.replace(/^.*[\\/]/, '');
        const err = last.error?.message ?? last.errors?.[0]?.message ?? null;
        tests.push({
          file: nama,
          ...situs(nama),
          title: spec.title,
          status: last.status ?? 'skipped',
          ms: round(last.duration ?? 0),
          steps: trimSteps(petaLangkah.get(`${nama}|${spec.title}`) ?? last.steps),
          error: err ? cut(err, 600) : null,
          attachments: (last.attachments ?? [])
            .filter((a) => a.path)
            .map((a) => ({name: a.name, contentType: a.contentType, path: a.path})),
        });
      }
      for (const c of s.suites ?? []) walk(c, f);
    };
    for (const s of r.suites ?? []) walk(s);

    // Run sebagian (mis. --grep satu TC) cuma nulis TC itu ke hasil.json. Bawa TC lain
    // apa adanya dari latest.json sebelumnya - jangan ditandai stale, karena TC itu
    // memang nggak diminta jalan.
    const kunci = (t) => `${t.file}|${t.title}`;
    const baru = new Set(tests.map(kunci));
    const lama = (prev?.playwright?.tests ?? []).filter((t) => !baru.has(kunci(t)));
    const semua = [...lama, ...tests];

    const bySite = new Map();
    for (const t of semua) {
      const k = `${t.site}|${t.host}`;
      const g = bySite.get(k) ?? {site: t.site, host: t.host, akun: t.akun, total: 0, passed: 0, failed: 0};
      g.total++;
      if (t.status === 'passed') g.passed++;
      if (['failed', 'timedOut', 'interrupted'].includes(t.status)) g.failed++;
      bySite.set(k, g);
    }

    playwright = {
      ranAt: now,
      stale: false,
      targets: [...bySite.values()],
      total: semua.length,
      passed: semua.filter((t) => t.status === 'passed').length,
      failed: semua.filter((t) => ['failed', 'timedOut', 'interrupted'].includes(t.status)).length,
      skipped: semua.filter((t) => t.status === 'skipped').length,
      ms: round(r.stats?.duration ?? 0),
      tests: semua,
    };
  }
}

// ---------- Lighthouse ----------
const METRICS = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS'],
  ['speed-index', 'SI'],
];

const trimNode = (n) =>
  n ? {type: 'node', selector: n.selector, snippet: cut(n.snippet, 160), label: n.nodeLabel} : null;

const trimItem = (it) => {
  const o = {};
  for (const [k, v] of Object.entries(it)) {
    if (k === 'node') o.node = trimNode(v);
    else if (k === 'subItems') o.subItems = (v?.items ?? []).slice(0, 3).map(trimItem);
    else if (typeof v === 'number') o[k] = round(v);
    else if (typeof v === 'string') o[k] = cut(v, 160);
    else if (typeof v === 'boolean') o[k] = v;
  }
  return o;
};

const trimDetails = (d) => {
  if (!d) return null;
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 8).map((it) => (it && it.type ? trimDetails(it) : trimItem(it)));
  return {
    type: d.type,
    headings: (d.headings ?? []).map((h) => ({key: h.key, label: h.label, valueType: h.valueType})),
    items,
    overallSavingsMs: round(d.overallSavingsMs),
    overallSavingsBytes: round(d.overallSavingsBytes),
  };
};

const bacaLhr = async (target) => {
  const dir = join(root, `lhci-results-${target}`);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.report.json'));
  const lhrs = [];
  for (const f of files) {
    const lhr = await readJsonOrNull(join(dir, f));
    if (lhr?.finalUrl) lhrs.push({...lhr, file: join(dir, f)});
  }
  // Terbaru per finalUrl — file run lama suka ikut keupload.
  const newest = new Map();
  for (const l of lhrs) {
    const k = l.finalUrl;
    if (!newest.has(k) || new Date(l.fetchTime) > new Date(newest.get(k).fetchTime)) newest.set(k, l);
  }
  return [...newest.values()];
};

const detailAssertion = async (target) => {
  const perTarget = join(root, `lhci-results-${target}`, 'assertion-results.json');
  const fallback = join(root, '.lighthouseci', 'assertion-results.json');
  const raw = (await readJsonOrNull(perTarget)) ?? (await readJsonOrNull(fallback)) ?? [];
  return raw.map((a) => ({
    level: a.level,
    audit: a.auditId ?? a.audit ?? '?',
    url: a.url ? new URL(a.url).pathname : '?',
    expected: a.expected,
    actual: a.actual,
    operator: a.operator,
    passed: a.passed ?? a.level !== 'error',
  }));
};

let lighthouse = null;
if (wantLh) {
  const targets = {};
  for (const [id, meta] of Object.entries(LIGHTHOUSE_TARGETS)) {
    if (onlyTarget && onlyTarget !== id) continue;
    const lhrs = await bacaLhr(id);
    if (!lhrs.length) continue;

    const urls = lhrs.map((lhr) => {
      const weights = {};
      for (const [catId, cat] of Object.entries(lhr.categories ?? {}))
        for (const ref of cat.auditRefs ?? []) weights[ref.id] = {category: catId, weight: ref.weight ?? 1};

      const issues = Object.values(lhr.audits ?? {})
        .filter(
          (a) =>
            typeof a.score === 'number' &&
            a.score < 0.9 &&
            !['informative', 'notApplicable', 'manual'].includes(a.scoreDisplayMode),
        )
        .map((a) => {
          const w = weights[a.id] ?? {category: 'lain', weight: 0};
          return {
            id: a.id,
            title: a.title,
            description: cut(a.description, 400),
            score: a.score,
            display: a.displayValue ?? '',
            category: w.category,
            weight: w.weight,
            impact: Number((w.weight * (1 - a.score)).toFixed(4)),
            details: trimDetails(a.details),
          };
        })
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 12);

      // Diagnosa LCP: elemen + fase (TTFB / Load Delay / Load Time / Render Delay).
      const lcpItems = lhr.audits?.['largest-contentful-paint-element']?.details?.items ?? [];
      const nodeTable = lcpItems.find((d) => d.type === 'table' && d.items?.[0]?.node);
      const phaseTable = lcpItems.find((d) => d.type === 'table' && d.items?.[0]?.phase);
      const lcp = nodeTable || phaseTable
        ? {
            element: trimNode(nodeTable?.items?.[0]?.node),
            phases: (phaseTable?.items ?? []).map((p) => ({
              phase: p.phase,
              timing: round(p.timing),
              percent: p.percent,
            })),
          }
        : null;

      return {
        path: new URL(lhr.finalUrl).pathname,
        url: lhr.finalUrl,
        fetchTime: lhr.fetchTime,
        report: lhr.file.replace(`${root}\\`, '').replace(`${root}/`, ''),
        scores: Object.fromEntries(Object.entries(lhr.categories ?? {}).map(([k, c]) => [k, c.score])),
        metrics: Object.fromEntries(
          METRICS.map(([id, label]) => {
            const a = lhr.audits?.[id] ?? {};
            return [label, {display: a.displayValue ?? '', score: a.score ?? null, weight: weights[id]?.weight ?? 0}];
          }),
        ),
        issues,
        lcp,
      };
    });

    urls.sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));
    const asserts = await detailAssertion(id);
    targets[id] = {
      ranAt: now,
      stale: false,
      target: meta,
      assertionDetails: asserts,
      errors: asserts.filter((a) => a.level === 'error' && a.passed === false).length,
      warnings: asserts.filter((a) => a.level === 'warn' && a.passed === false).length,
      runs: urls.length,
      urls,
    };
  }
  if (Object.keys(targets).length) lighthouse = {ranAt: now, stale: false, targets};
}

// ---------- Gabung + simpan ----------
const carry = (s) => (s ? {...s, stale: true} : null);

const out = {
  generatedAt: now,
  playwright: wantPw ? playwright ?? carry(prev?.playwright) : carry(prev?.playwright),
  lighthouse: wantLh ? lighthouse ?? carry(prev?.lighthouse) : carry(prev?.lighthouse),
};

await mkdir(dirname(destStatic), {recursive: true});
const json = `${JSON.stringify(out, null, 2)}\n`;
await writeFile(dest, json);
await writeFile(destStatic, json);

// ---------- Tabel terminal ----------
const tua = (s) => (s?.stale ? '  (data lama, belum dijalankan ulang)' : '');

console.log('\n=== PLAYWRIGHT ===');
if (!out.playwright) {
  console.log('pw-out/hasil.json belum ada');
} else {
  for (const g of out.playwright.targets ?? [])
    console.log(`${pad(g.site, 26)}${pad(g.host, 22)}${g.akun ? 'butuh akun' : 'tanpa akun'}  ${g.passed}/${g.total} pass`);
  console.log('');
  for (const t of out.playwright.tests) {
    const label = {passed: 'PASS', failed: 'FAIL', timedOut: 'TIMEOUT', interrupted: 'STOP', skipped: 'SKIP'}[t.status] ?? t.status;
    console.log(`${pad(label, 8)}${pad(t.site ?? t.file, 26)}${pad(t.file, 24)}${pad(t.title, 44)}${(t.ms / 1000).toFixed(1)}s`);
  }
  console.log(`${out.playwright.passed} passed, ${out.playwright.failed} failed, ${out.playwright.skipped} skipped (${(out.playwright.ms / 1000).toFixed(1)}s)${tua(out.playwright)}`);
}

console.log('\n=== LIGHTHOUSE ===');
if (!out.lighthouse) {
  console.log('lhci-results-<target>/*.report.json belum ada');
} else {
  for (const [id, t] of Object.entries(out.lighthouse.targets)) {
    console.log(`\n${id}: ${t.target.site} - ${t.target.dist}`);
    console.log(`${pad('path', 20)}${pad('perf', 6)}${pad('a11y', 6)}${pad('bp', 6)}seo`);
    for (const u of t.urls)
      console.log(
        `${pad(u.path, 20)}${pad(pct(u.scores.performance), 6)}${pad(pct(u.scores.accessibility), 6)}${pad(pct(u.scores['best-practices']), 6)}${pct(u.scores.seo)}`,
      );
    console.log(`${t.urls.length} url, ${t.errors} error, ${t.warnings} warning${tua(t)}`);
  }
}

console.log('\nlatest.json -> latest.json + docusaurus/static/data/latest.json');
