"use client";

// Panel terminal live untuk satu run (PRD §10.3). WS /ws → subscribe {runId, after}
// → log | status | replay-complete; tampilan diserahkan ke RunPanel.
import { useEffect, useState } from "react";
import { api, type LogEntry, type Run } from "../../lib/playbook";
import { RunPanel } from "./run-panel";

const MAX_LINES = 4000;

// Bentuk pesan WS /ws setelah subscribe; sisanya diabaikan.
type WsMessage = { type: "log"; seq: number; stream: string; text: string; at: string }
  | { type: "status"; run: Run }
  | { type: "replay-complete" };

export function RunTerminal({ runId }: { runId: string }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [live, setLive] = useState(true);
  // Snapshot run untuk stopwatch + status; diperbarui oleh WS.
  const [run, setRun] = useState<Run | null>(null);

  // Log awal (paginasi) → WS dari seq terakhir. Urutan penting: subscribe `after: 0`
  // memutar ulang semua log dan menduplikasi baris kalau paralel dengan fetch awal.
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let closed = false;

    (async () => {
      let after = 0;
      try {
        const first = await api.runLogs(runId, 0);
        if (!alive) return;
        let all = first.logs;
        if (first.hasMore) {
          const more = await api.runLogs(runId, first.nextAfter);
          all = [...all, ...more.logs];
        }
        setLines(all);
        const r = await api.run(runId);
        if (!alive) return;
        setRun(r);
        after = all.length ? all[all.length - 1].seq : 0;
      } catch { /* biarkan WS yang mengisi */ }
      if (!alive) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => ws!.send(JSON.stringify({ type: "subscribe", runId, after }));
      ws.onmessage = ev => {
        let msg: WsMessage;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "log") {
          const entry: LogEntry = { seq: msg.seq, stream: msg.stream, text: msg.text, at: msg.at };
          setLines(p => [...p, entry].slice(-MAX_LINES));
        } else if (msg.type === "status" && msg.run) {
          // WS yang menentukan kapan berhenti, bukan snapshot props.
          setRun(msg.run);
          if (["passed", "failed", "cancelled", "interrupted"].includes(msg.run.status)) {
            closed = true; setLive(false); ws!.close();
          }
        }
      };
      ws.onerror = () => setLive(false);
      ws.onclose = () => { if (!closed) setLive(false); };
    })();

    return () => { alive = false; closed = true; ws?.close(); };
  }, [runId]);

  return (
    <RunPanel
      logs={lines}
      run={run}
      live={live}
      downloadHref={`/api/runs/${runId}/logs/download`}
    />
  );
}
