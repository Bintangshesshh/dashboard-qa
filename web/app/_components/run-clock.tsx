"use client";

import { useEffect, useState } from "react";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

// 00:00 / 1:05:09 - stopwatch ringkas untuk run yang masih berjalan.
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export type RunClockInput = {
  status: string;
  queued_at?: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
};

// Sumber waktu: duration_ms kalau sudah final, selain itu hitung dari started_at.
// Mulai dari queued_at supaya stopwatch jalan sejak run masuk antrean.
// diekstrak supaya bisa diuji tanpa DOM.
export function runElapsed(run: RunClockInput, now: number): number | null {
  const start = Date.parse(run.started_at ?? run.queued_at ?? "") || null;
  if (FINAL.includes(run.status)) {
    if (run.duration_ms != null) return run.duration_ms;
    return start && run.finished_at ? Date.parse(run.finished_at) - start : null;
  }
  return start ? now - start : null;
}

export function RunClock({ run }: { run: RunClockInput }) {
  const live = !FINAL.includes(run.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, run.started_at]);

  const ms = runElapsed(run, now);
  const value = ms == null ? "--:--" : clock(ms);
  // Pisahkan digit supaya detik bisa diberi aksen seperti jarum stopwatch.
  const parts = value.split(":");
  // Garis progres mengikuti detik dalam menit berjalan, bukan total durasi:
  // run panjang tidak pernah tampak "berhenti" di ujung kanan.
  const secPct = ms == null ? 0 : (((ms / 1000) % 60) / 60) * 100;

  return (
    <span
      className={"pb-clock" + (live ? " live" : "")}
      role="timer"
      aria-label={live ? `Durasi berjalan ${value}` : `Durasi ${value}`}
      title={live ? "sedang berjalan" : "durasi eksekusi"}
    >
      <span className="pb-clock-digits" aria-hidden="true">
        {parts.map((part, i) => (
          <span key={i} className="pb-clock-part">
            {i > 0 && <span className="pb-clock-colon">:</span>}
            <span className={i === parts.length - 1 ? "pb-clock-sec" : undefined}>{part}</span>
          </span>
        ))}
      </span>
      <span className="pb-clock-rule" aria-hidden="true">
        <span style={{ width: `${secPct}%` }} />
      </span>
    </span>
  );
}
