import { fmtTime, runStatusLabel, type RunMark } from "../../lib/playbook";

// Riwayat run terakhir sebagai blok berurutan kiri→kanan. Satu blok = satu run;
// warna menunjukkan hasil akhir, abu-abu untuk run yang belum selesai.
const state = (s: RunMark["status"]) =>
  s === "passed" ? "ok" : s === "failed" ? "bad" : s === "queued" || s === "running" || s === "uploading" ? "run" : "idle";

export function RunBar({ runs, label }: { runs: RunMark[]; label?: string }) {
  if (!runs.length) return <div className="pb-runbar" aria-label={label ? `${label}: belum ada run` : "Belum ada run"} />;
  return (
    <div className="pb-runbar" role="img" aria-label={label ? `${label}: ${runs.length} run terakhir` : `${runs.length} run terakhir`}>
      {runs.map(r => (
        <span
          key={r.id}
          className={`pb-runbar-seg ${state(r.status)}`}
          title={`${r.tool === "lh" ? "Lighthouse" : "Playwright"} · ${runStatusLabel(r.status)} · ${r.session_label}${r.finished_at ? ` · ${fmtTime(r.finished_at)}` : ""}`}
        />
      ))}
    </div>
  );
}
