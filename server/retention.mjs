// Retensi harian (PRD §8.6). Urutan wajib:
// folder run → baris artifacts → reports 'stale' → run_logs lama → baris hasil dibiarkan.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const DAY = 86400000;
const iso = (now, ms) => new Date(now.getTime() - ms).toISOString();

// Bagian yang hanya membaca DB; dipisah supaya bisa diuji tanpa menyentuh disk.
export function planRetention({
  store,
  now = new Date(),
  artifactDays = 7,
  reportDays = 7,
  logDays = 30,
  queuedTimeoutMinutes = 30,
} = {}) {
  const artifactCutoff = iso(now, artifactDays * DAY);
  const reportCutoff = iso(now, reportDays * DAY);
  const logCutoff = iso(now, logDays * DAY);
  const queueCutoff = iso(now, queuedTimeoutMinutes * 60000);

  // Hanya run yang sudah final; run aktif tidak pernah dihapus.
  const runs = store.db.prepare(
    `SELECT id FROM runs
     WHERE status IN ('passed','failed','cancelled','interrupted')
       AND COALESCE(finished_at, queued_at) < ?
     ORDER BY queued_at`,
  ).all(artifactCutoff).map(r => r.id);

  const reports = store.db.prepare(
    `SELECT id FROM reports
     WHERE status IN ('ready','stale')
       AND COALESCE(built_at, created_at) < ?`,
  ).all(reportCutoff).map(r => r.id);

  const interrupted = store.db.prepare(
    `SELECT id FROM runs WHERE status='queued' AND queued_at < ?`,
  ).all(queueCutoff).map(r => r.id);

  return { runs, reports, interrupted, logCutoff, artifactCutoff, reportCutoff };
}

// PRD §8.6 langkah 1-4. Baris runs/playwright_results/lighthouse_results/sessions
// sengaja tidak disentuh: riwayat tetap ada walau file mentahnya hilang.
export async function runRetention({
  store,
  runsDir,
  reportsDir,
  now = new Date(),
  artifactDays = Number(store.getSetting('artifact_retention_days') ?? 7),
  reportDays = Number(store.getSetting('report_retention_days') ?? 7),
  logDays = Number(store.getSetting('log_retention_days') ?? 30),
} = {}) {
  const plan = planRetention({ store, now, artifactDays, reportDays, logDays });

  for (const id of plan.runs) await rm(join(runsDir, id), { recursive: true, force: true }).catch(() => {});
  if (plan.runs.length) {
    const marks = plan.runs.map(() => '?').join(',');
    store.db.prepare(`DELETE FROM artifacts WHERE run_id IN (${marks})`).run(...plan.runs);
  }

  // Folder laporan dibuang → status 'stale', bukan 'failed': isinya masih benar,
  // hanya filenya sudah tidak ada. UI menampilkan "artifact dihapus".
  for (const id of plan.reports) {
    await rm(join(reportsDir, id), { recursive: true, force: true }).catch(() => {});
    store.patchReport(id, { status: 'stale', path: null });
  }

  // Run yang masih aktif tidak boleh kehilangan log walau barisnya tua.
  const logs = store.db.prepare(
    `DELETE FROM run_logs WHERE at < ?
       AND run_id NOT IN (SELECT id FROM runs WHERE status IN ('queued','running','uploading'))`,
  ).run(plan.logCutoff);

  for (const id of plan.interrupted) {
    store.patchRun(id, {
      status: 'interrupted',
      error: 'Run antre > 30 menit tanpa mulai',
      finished_at: now.toISOString(),
    });
  }

  return {
    runs: plan.runs.length,
    reports: plan.reports.length,
    logs: Number(logs.changes ?? 0),
    interrupted: plan.interrupted.length,
  };
}
