"use client";

// Panel terminal live untuk satu run (PRD §10.3): log, console, network.
// WS /ws → subscribe {runId, after} → log | status | replay-complete.
import { useEffect, useRef, useState } from "react";
import { api, type LogEntry } from "../../lib/playbook";
import { RunClock } from "../_components/run-clock";

type ConsoleLine = { seq: number; at: string; type: string; text: string; location: string | null };
type NetworkLine = { seq: number; at: string; url: string; status: number | null; method: string | null; failure: string | null; ms: number | null };

const MAX_LINES = 2000;

export function RunTerminal({ runId }: { runId: string }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [networkLines, setNetworkLines] = useState<NetworkLine[]>([]);
  const [live, setLive] = useState(true);
  const [tab, setTab] = useState<"log" | "console" | "network">("log");
  // Snapshot run untuk stopwatch + status; diperbarui oleh WS.
  const [run, setRun] = useState<any>(null);
  const box = useRef<HTMLPreElement>(null);

  // Log awal (paginasi) → panel console/network → baru WS dari seq terakhir.
  // Urutan ini penting: WS subscribe `after: 0` akan memutar ulang semua log dan
  // menduplikasi baris kalau dijalankan paralel dengan fetch awal.
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let closed = false;

    const pushLog = (entry: LogEntry) => {
      if (entry.stream === "console") {
        try {
          const v = JSON.parse(entry.text);
          setConsoleLines(p => [...p, { seq: entry.seq, at: entry.at, type: v.type ?? "log", text: String(v.text ?? ""), location: v.location ?? null }]);
        } catch { /* abaikan */ }
      } else if (entry.stream === "network") {
        try {
          const v = JSON.parse(entry.text);
          setNetworkLines(p => [...p, { seq: entry.seq, at: entry.at, url: v.url ?? "", status: v.status ?? null, method: v.method ?? null, failure: v.failure ?? null, ms: v.ms ?? null }]);
        } catch { /* abaikan */ }
      }
      setLines(prev => [...prev, entry].slice(-MAX_LINES));
    };

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
        // Console/network lengkap (log bisa terpotong log_max_bytes).
        const run: any = await api.run(runId);
        if (!alive) return;
        setRun(run);
        setConsoleLines(run.console ?? []);
        setNetworkLines(run.network ?? []);
        after = all.length ? all[all.length - 1].seq : 0;
      } catch { /* biarkan WS yang mengisi */ }
      if (!alive) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => ws!.send(JSON.stringify({ type: "subscribe", runId, after }));
      ws.onmessage = ev => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "log") {
          pushLog({ seq: msg.seq, stream: msg.stream, text: msg.text, at: msg.at });
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

  // Auto-scroll ke bawah selama live.
  useEffect(() => {
    if (!live || tab !== "log") return;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, live, tab]);

  const badConsole = consoleLines.filter(c => c.type === "error" || c.type === "pageerror");
  const badNetwork = networkLines.filter(n => n.failure || (n.status ?? 0) >= 400);

  return (
    <section className="pb-card" style={{ marginTop: 14 }}>
      <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="pb-row" style={{ gap: 6 }}>
          <button className={"pb-btn sm" + (tab === "log" ? " primary" : "")} onClick={() => setTab("log")}>Terminal</button>
          <button className={"pb-btn sm" + (tab === "console" ? " primary" : "")} onClick={() => setTab("console")}>
            Console {badConsole.length > 0 && <span className="pb-badge failed">{badConsole.length}</span>}
          </button>
          <button className={"pb-btn sm" + (tab === "network" ? " primary" : "")} onClick={() => setTab("network")}>
            Network {badNetwork.length > 0 && <span className="pb-badge failed">{badNetwork.length}</span>}
          </button>
        </div>
        <span className="pb-row" style={{ gap: 8, fontSize: 12 }}>
          {run && <RunClock run={run} />}
          <span className="pb-muted">{live ? "● live" : "selesai"} · {lines.length} baris</span>
          <a className="pb-btn sm" href={`/api/runs/${runId}/logs/download`}>Unduh log</a>
        </span>
      </div>

      {tab === "log" && (
        <pre className="pb-term" ref={box}>
          {lines.length === 0 ? "Menunggu output…" : lines.map(l => (
            <span key={l.seq} data-stream={l.stream}>{l.text}</span>
          ))}
        </pre>
      )}

      {tab === "console" && (
        consoleLines.length === 0
          ? <p className="pb-empty">Belum ada pesan console yang terekam.</p>
          : <table className="pb-table">
            <thead><tr><th>Tipe</th><th>Pesan</th><th>Lokasi</th></tr></thead>
            <tbody>
              {consoleLines.map(c => (
                <tr key={c.seq}>
                  <td><span className={"pb-badge " + (c.type === "error" || c.type === "pageerror" ? "failed" : c.type === "warning" ? "warn" : "")}>{c.type}</span></td>
                  <td className="mono">{c.text}</td>
                  <td className="pb-muted mono" style={{ fontSize: 11 }}>{c.location ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
      )}

      {tab === "network" && (
        networkLines.length === 0
          ? <p className="pb-empty">Belum ada request yang terekam.</p>
          : <table className="pb-table">
            <thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Gagal</th><th>Durasi</th></tr></thead>
            <tbody>
              {networkLines.map(n => (
                <tr key={n.seq}>
                  <td><span className={"pb-badge " + ((n.status ?? 0) >= 400 ? "failed" : "passed")}>{n.status ?? "-"}</span></td>
                  <td className="mono">{n.method ?? "-"}</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>{n.url}</td>
                  <td className="pb-muted">{n.failure ?? "-"}</td>
                  <td className="mono">{n.ms == null ? "-" : `${Math.round(n.ms)}ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
      )}
    </section>
  );
}
