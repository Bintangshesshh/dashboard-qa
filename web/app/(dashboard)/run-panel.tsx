"use client";

// Panel bawah (Terminal/Console/Network) untuk semua halaman run. Sumber data
// tunggal: array log; stream console/network disimpan sebagai JSON satu baris.
// ponytail: log bisa terpotong log_max_bytes; pakai run.console kalau butuh lengkap.
import { useEffect, useMemo, useRef, useState } from "react";
import { RunClock } from "../_components/run-clock";
import { fmtHms, type LogEntry, type Run } from "../../lib/playbook";

const stripAnsi = (s: string) => s.replace(/\u001b?\[[0-9;]*m/g, "");

type ConsoleRow = { seq: number; at: string; type: string; text: string; location: string | null };
type NetworkRow = { seq: number; at: string; url: string; status: number | null; method: string | null; failure: string | null; ms: number | null };

const badType = (t: string) => t === "error" || t === "pageerror";
const warnType = (t: string) => t === "warning" || t === "warn";

const shortUrl = (u: string) => {
  try { const x = new URL(u); return x.pathname + x.search; } catch { return u; }
};

export function RunPanel({ logs, run, live, downloadHref }: {
  logs: LogEntry[];
  run: Run | null;
  live?: boolean;
  downloadHref?: string | null;
}) {
  const [tab, setTab] = useState<"log" | "console" | "network">("log");
  const [chip, setChip] = useState<"all" | "error" | "warn">("all");
  const [cQuery, setCQuery] = useState("");
  const [nQuery, setNQuery] = useState("");
  const box = useRef<HTMLPreElement>(null);
  const consBox = useRef<HTMLDivElement>(null);
  const netBox = useRef<HTMLDivElement>(null);

  const { term, cons, net } = useMemo(() => {
    const term: LogEntry[] = [];
    const cons: ConsoleRow[] = [];
    const net: NetworkRow[] = [];
    for (const e of logs) {
      if (e.stream === "console") {
        try {
          const v = JSON.parse(e.text);
          cons.push({ seq: e.seq, at: e.at, type: String(v.type ?? "log"), text: String(v.text ?? ""), location: v.location ?? null });
        } catch { /* baris mentah: biarkan, hanya tampil di Terminal */ }
        continue;
      }
      if (e.stream === "network") {
        try {
          const v = JSON.parse(e.text);
          net.push({ seq: e.seq, at: e.at, url: String(v.url ?? ""), status: v.status ?? null, method: v.method ?? null, failure: v.failure ?? null, ms: v.ms ?? null });
        } catch { /* idem */ }
        continue;
      }
      term.push(e);
    }
    return { term, cons, net };
  }, [logs]);

  // Auto-scroll saat live untuk tab yang sedang dibuka.
  useEffect(() => {
    if (!live) return;
    const el = tab === "log" ? box.current : tab === "console" ? consBox.current : netBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term.length, cons.length, net.length, live, tab]);

  const errors = cons.filter(c => badType(c.type)).length;
  const warns = cons.filter(c => warnType(c.type)).length;
  const badNet = net.filter(n => n.failure || (n.status ?? 0) >= 400).length;

  const consView = cons.filter(c => {
    if (chip === "error" && !badType(c.type)) return false;
    if (chip === "warn" && !warnType(c.type)) return false;
    if (!cQuery) return true;
    const q = cQuery.toLowerCase();
    return c.text.toLowerCase().includes(q) || (c.location ?? "").toLowerCase().includes(q);
  });
  const netView = net.filter(n => !nQuery || n.url.toLowerCase().includes(nQuery.toLowerCase()));
  const maxMs = Math.max(1, ...netView.map(n => n.ms ?? 0));

  return (
    <section className="pb-card" style={{ marginBottom: 14 }}>
      <div className="pb-row" style={{ justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div className="pb-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "log"} className={"pb-tab" + (tab === "log" ? " active" : "")} onClick={() => setTab("log")}>
            Terminal
          </button>
          <button role="tab" aria-selected={tab === "console"} className={"pb-tab" + (tab === "console" ? " active" : "")} onClick={() => setTab("console")}>
            Console <span className={"pb-count" + (errors ? " bad" : warns ? " warn" : "")}>{cons.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "network"} className={"pb-tab" + (tab === "network" ? " active" : "")} onClick={() => setTab("network")}>
            Network <span className={"pb-count" + (badNet ? " bad" : "")}>{net.length}</span>
          </button>
        </div>
        <span className="pb-row" style={{ gap: 8, fontSize: 12 }}>
          {run && <RunClock run={run} />}
          <span className="pb-live-state">
            {live ? "berjalan" : run ? "selesai" : "menunggu"} · {term.length} baris
          </span>
          {downloadHref && <a className="pb-btn sm" href={downloadHref}>Unduh log</a>}
        </span>
      </div>

      {tab === "log" && (
        <pre className="pb-term" ref={box} style={{ maxHeight: 420, minHeight: 200 }}>
          {term.length === 0
            ? (run ? "Menunggu output…" : "Log run akan muncul di sini.")
            : term.map(l => <div key={l.seq} data-stream={l.stream}>{stripAnsi(l.text)}</div>)}
        </pre>
      )}

      {tab === "console" && (
        <>
          <div className="pb-subbar">
            <div className="pb-chips">
              {([["all", "Semua"], ["error", `Error ${errors}`], ["warn", `Peringatan ${warns}`]] as const).map(([k, label]) => (
                <button key={k} className={"pb-chip-btn" + (chip === k ? " active" : "")} onClick={() => setChip(k)}>{label}</button>
              ))}
            </div>
            <input className="pb-search" placeholder="Cari pesan / lokasi" value={cQuery}
              onChange={e => setCQuery(e.target.value)} aria-label="Cari console" />
          </div>
          {consView.length === 0
            ? <p className="pb-empty">Belum ada console yang terekam.</p>
            : <div className="pb-console" ref={consBox}>
              {consView.map(c => (
                <div key={c.seq} className={"pb-console-row" + (badType(c.type) ? " err" : warnType(c.type) ? " warn" : "")}>
                  <span className="pb-log-time">{fmtHms(c.at)}</span>
                  <span className={"pb-log-badge" + (badType(c.type) ? " bad" : warnType(c.type) ? " warn" : "")}>{c.type}</span>
                  <span className="pb-log-msg">{c.text}</span>
                  {c.location && <span className="pb-log-loc">{c.location}</span>}
                </div>
              ))}
            </div>}
        </>
      )}

      {tab === "network" && (
        <>
          <div className="pb-subbar">
            <span className="pb-muted" style={{ fontSize: 11.5 }}>
              {netView.length} dari {net.length} request · {badNet} gagal
            </span>
            <input className="pb-search" placeholder="Saring URL" value={nQuery}
              onChange={e => setNQuery(e.target.value)} aria-label="Saring URL" />
          </div>
          {netView.length === 0
            ? <p className="pb-empty">Belum ada request terekam.</p>
            : <div className="pb-net" ref={netBox}>
              <table>
                <thead>
                  <tr><th>Status</th><th>Metode</th><th>URL</th><th>Durasi</th><th>Waterfall</th></tr>
                </thead>
                <tbody>
                  {netView.map(n => {
                    const code = n.status;
                    const cls = n.failure || (code ?? 0) >= 400 ? " bad" : code && code < 400 ? " ok" : " mid";
                    return (
                      <tr key={n.seq}>
                        <td><span className={"pb-status" + cls}>{n.failure ? "ERR" : code ?? "-"}</span></td>
                        <td><span className="pb-method">{n.method ?? "—"}</span></td>
                        <td title={n.url}>{shortUrl(n.url)}</td>
                        <td>{n.ms == null ? "—" : `${Math.round(n.ms)}ms`}</td>
                        <td>
                          <span className="pb-wf">
                            <span style={{ width: `${Math.max(2, Math.round(((n.ms ?? 0) / maxMs) * 100))}%` }} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
        </>
      )}
    </section>
  );
}
