// Markdown bahan evaluasi untuk satu report sesi (PRD §9).
// Dipakai server + scripts/build-session-report.mjs -> <reportDir>/report.md
// Tanpa dependency: markdown dirakit manual, dirender apa adanya oleh klien.

const cell = v => String(v ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '-';

// Satu format waktu untuk web dan report, supaya angka tidak pernah beda.
// Tahun hanya muncul kalau bukan tahun berjalan: tanggal lama tetap jelas,
// tanggal hari ini tetap ringkas.
const TZ = 'Asia/Jakarta';
const ymd = v => new Date(v).toLocaleString('id-ID', { timeZone: TZ, year: 'numeric' });
const date = v => {
  if (!v) return '-';
  const opts = { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (ymd(v) !== ymd(Date.now())) opts.year = 'numeric';
  return new Date(v).toLocaleString('id-ID', opts) + ' WIB';
};

const dur = v => (v == null ? '-' : v >= 60000 ? `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s` : `${(v / 1000).toFixed(1)}s`);

const pct = v => (v == null ? '-' : `${Math.round(v * 100)}%`);

const table = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n')
  : '_tidak ada_';

const scopeLabel = scope => (scope === 'both' ? 'Gabungan' : scope === 'pw' ? 'Playwright' : 'Lighthouse');

// Satu run jadi blok markdown: tabel hasil + daftar temuan.
function runBlock({ run, results }) {
  const out = [];
  const isPw = run.tool === 'pw';
  out.push(`### ${isPw ? 'Playwright' : 'Lighthouse'} · ${cell(run.status)}`);
  out.push(`Mulai ${date(run.started_at)} · selesai ${date(run.finished_at)} · durasi ${dur(run.duration_ms)} · exit ${cell(run.exit_code)}`);
  out.push('');

  if (isPw) {
    const rows = results.map(r => [r.tc_id ?? '-', r.title, r.file, r.status, dur(r.duration_ms), r.retry ?? 0]);
    out.push(table(['TC', 'Judul', 'File', 'Status', 'Durasi', 'Retry'], rows));
    const gagal = results.filter(r => r.status === 'failed' || r.error);
    for (const r of gagal) {
      out.push('');
      out.push(`#### ${cell(r.tc_id ?? r.title)}`);
      out.push(`Lokasi: \`${cell(r.file)}\``);
      out.push('');
      out.push('```');
      out.push(String(r.error ?? 'tanpa pesan error').slice(0, 2000));
      out.push('```');
    }
  } else {
    const rows = results.map(r => [
      r.url, pct(r.performance), pct(r.accessibility), pct(r.best_practices), pct(r.seo),
      r.lcp_ms == null ? '-' : `${Math.round(r.lcp_ms)} ms`, r.budget_failed ?? '-',
    ]);
    out.push(table(['URL', 'Perf', 'A11y', 'BP', 'SEO', 'LCP', 'Budget gagal'], rows));
    const kurang = results.filter(r => [r.performance, r.accessibility, r.best_practices, r.seo].some(v => v != null && v < 1));
    for (const r of kurang) {
      out.push('');
      out.push(`#### ${cell(r.url)}`);
      const skor = [['performance', r.performance], ['accessibility', r.accessibility], ['best-practices', r.best_practices], ['seo', r.seo]]
        .filter(([, v]) => v != null && v < 1).map(([k, v]) => `${k} ${pct(v)}`);
      out.push(`Skor di bawah 100%: ${skor.join(', ')}`);
      if (r.warnings) out.push(`Catatan: ${String(r.warnings).slice(0, 1000)}`);
      if (r.budget_failed) out.push(`Budget gagal: ${r.budget_failed}`);
    }
  }
  return out.join('\n');
}

// Frontmatter YAML sederhana supaya urutan blok stabil saat digabung.
export function renderReportMarkdown({ session, project, report, runs, position, frontmatter = false }) {
  const gagal = runs.filter(r => !['passed'].includes(r.run.status));
  const judul = `${session?.label ?? 'Laporan'} - ${scopeLabel(report.scope)}`;

  const out = [];
  if (frontmatter) {
    out.push('---');
    out.push(`title: "${judul.replace(/"/g, "'")}"`);
    out.push(`sidebar_position: ${position ?? 1}`);
    out.push('---');
    out.push('');
  }
  out.push(`# ${judul}`);
  out.push('');
  out.push([project?.name, session?.env, session?.target_url, date(session?.created_at)].filter(Boolean).map(cell).join(' | '));
  out.push('');
  out.push(gagal.length
    ? `> [!WARNING]\n> ${gagal.length} dari ${runs.length} run tidak lulus. Tabel di bawah adalah bahan evaluasi, bukan bukti lulus.`
    : `> [!NOTE]\n> Semua ${runs.length} run lulus. Artefak yang hilang tetap bukan berarti lulus.`);
  out.push('');

  out.push('## Ringkasan run');
  out.push('');
  out.push(table(['Tool', 'Status', 'Durasi', 'Exit', 'Selesai'], runs.map(({ run }) => [
    run.tool === 'pw' ? 'Playwright' : 'Lighthouse', run.status, dur(run.duration_ms), run.exit_code ?? '-', date(run.finished_at),
  ])));
  out.push('');

  out.push('## Detail per run');
  out.push('');
  if (!runs.length) out.push('_tidak ada run di report ini_');
  for (const item of runs) {
    out.push(runBlock(item));
    out.push('');
  }

  out.push('## Temuan (bahan evaluasi)');
  out.push('');
  const temuan = [];
  for (const { run, results } of runs) {
    if (run.tool === 'pw') {
      for (const r of results.filter(x => x.status === 'failed' || x.error)) {
        temuan.push(`- [ ] ${cell(r.tc_id ?? r.title)} (\`${cell(r.file)}\`) - ${cell(String(r.error ?? 'cek manual').split('\n')[0])}`);
      }
    } else {
      for (const r of results) {
        if (r.budget_failed) temuan.push(`- [ ] ${cell(r.url)} - budget: ${cell(r.budget_failed)}`);
        for (const k of ['performance', 'accessibility', 'best_practices', 'seo']) {
          if (r[k] != null && r[k] < 1) temuan.push(`- [ ] ${cell(r.url)} - ${k} ${pct(r[k])}`);
        }
      }
    }
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) {
      temuan.push(`- [ ] Run ${run.tool} ${run.id.slice(0, 8)} berstatus ${run.status}${run.error ? `: ${cell(run.error)}` : ''}`);
    }
  }
  out.push(temuan.length ? temuan.join('\n') : '_tidak ada temuan otomatis_');
  out.push('');

  out.push('## Artefak');
  out.push('');
  out.push(table(['Run', 'Artefak'], runs.map(({ run }) => [
    run.id.slice(0, 8),
    (run.artifacts ?? []).map(a => a.path).join(', ') || 'tidak ada (mungkin sudah dibuang retensi)',
  ])));
  out.push('');

  out.push('---');
  out.push('');
  out.push(`Dibangun ${date(new Date().toISOString())} · cakupan ${cell(report.scope)} · ${runs.length} run · run_ids: ${report.run_ids ?? '[]'}`);
  return out.join('\n');
}

// Muat satu report dari DB lalu render. Dipakai server untuk report lama yang
// foldernya belum punya report.md.
export function reportMarkdownFor(store, reportId) {
  const report = store.getReport(reportId);
  if (!report) return null;
  const session = store.getSession(report.session_id);
  const project = session ? store.getProject(session.project_id) : null;
  const runs = [];
  for (const runId of JSON.parse(report.run_ids ?? '[]')) {
    const run = store.getRun(runId);
    if (!run) continue;
    runs.push({
      run: { ...run, artifacts: store.listArtifacts(run.id) },
      results: run.tool === 'pw' ? store.listPlaywrightResults(run.id) : store.listLighthouseResults(run.id),
    });
  }
  return renderReportMarkdown({ session, project, report, runs });
}
