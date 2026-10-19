"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API ?? "http://127.0.0.1:3001";

type Step = { title: string; ms: number; error?: string | null };
type Attachment = { name: string; contentType: string; path: string };
type PwTest = {
  file: string;
  site: string;
  host: string;
  title: string;
  status: string;
  ms: number;
  stale?: boolean;
  steps?: Step[];
  error?: string | null;
  attachments?: Attachment[];
};
type Pw = {
  passed: number;
  failed: number;
  skipped: number;
  ms: number;
  stale?: boolean;
  tests: PwTest[];
};
type Issue = {
  id: string;
  title: string;
  description?: string;
  category: string;
  display: string;
  score: number;
  impact: number;
  details?: AuditDetail | null;
};
type AuditDetail = {
  type: string;
  headings?: { key: string; label: string; valueType?: string }[];
  items?: any[];
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
};
type Metric = { display: string; score: number | null; weight: number };
type Lcp = {
  element: { selector: string; snippet: string; label?: string } | null;
  phases: { phase: string; timing: number; percent: string }[];
};
type LhUrl = {
  path: string;
  url: string;
  scores: Record<string, number>;
  metrics: Record<string, Metric>;
  issues: Issue[];
  lcp?: Lcp | null;
};
type LhTarget = {
  target: { site: string; host: string; dist: string };
  errors: number;
  warnings: number;
  stale?: boolean;
  urls: LhUrl[];
};
type Data = {
  generatedAt: string;
  playwright: Pw | null;
  lighthouse: { targets: Record<string, LhTarget> } | null;
};

type Sel =
  | { kind: "home" }
  | { kind: "pw"; id: string }
  | { kind: "lh"; target: string; path: string };

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const pct = (n?: number) => (typeof n === "number" ? Math.round(n * 100) : "—");
const sec = (ms = 0) => `${(ms / 1000).toFixed(1)} s`;
const ms = (n?: number) => (typeof n === "number" ? `${Math.round(n)} ms` : "—");
const kb = (b?: number) => (typeof b === "number" ? `${Math.round(b / 1024)} KiB` : "—");
const kelas = (s: string) =>
  s === "passed" ? "pass" : ["failed", "timedOut", "interrupted"].includes(s) ? "fail" : "warn";
// Warna lampu status: ijo kalau lulus, merah kalau gagal, kuning kalau di-skip.
const lampu = (s: string) => (kelas(s) === "pass" ? "ok" : kelas(s) === "fail" ? "bad" : "warn");

const artiFase: Record<string, string> = {
  TTFB: "server lambat menjawab. Cek cache, DB, atau hosting.",
  "Load Delay": "gambar telat ditemukan. Pasang preload, buang loading=lazy di atas fold, jangan disisipkan lewat JS.",
  "Load Time": "file gambar kegedean atau origin lambat. Kompres, pakai AVIF/WebP, taruh di CDN.",
  "Render Delay": "JS/CSS ngeblok render. Defer script, inline critical CSS.",
};

function diagnosaLcp(lcp: Lcp) {
  const fase = [...lcp.phases].sort((a, b) => parseInt(b.percent) - parseInt(a.percent))[0];
  if (!fase) return null;
  return { fase: fase.phase, persen: fase.percent, saran: artiFase[fase.phase] ?? "" };
}

export default function Page() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ kind: "home" });
  const [extra, setExtra] = useState<Record<"pw" | "lh", string[]>>({ pw: [], lh: [] });
  const [buka, setBuka] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [bukaLog, setBukaLog] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/latest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (window.innerWidth < 800) setBuka(false);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "start") {
        const target = (msg.specs ?? []).filter((s: string) => !s.startsWith("--"));
        setRunning(true);
        setLog([`> jalan: ${target.length ? target.join(" ") : "semua spec"}\n`]);
        setBukaLog(true);
      } else if (msg.type === "log") {
        setLog((prev) => [...prev, msg.line]);
      } else if (msg.type === "done") {
        setRunning(false);
        // Jangan tutup log pas selesai — biar bisa dibaca dulu.
        setBukaLog(true);
        setLog((prev) => [...prev, `> selesai (exit ${msg.code})`]);
        fetch(`${API}/api/latest`)
          .then((r) => r.json())
          .then(setData)
          .catch(() => null);
      } else if (msg.type === "status" && msg.running) {
        setRunning(true);
        setLog(msg.log ?? []);
      }
    };
    return () => ws.close();
  }, []);

  const jalankan = () => {
    if (running) return;
    // Kalau ada TC yang dipilih, jalankan TC itu doang lewat --grep (nggak perlu pecah file).
    // Ambil token TC id-nya saja: judul ada spasi, dan spawn pakai shell tanpa quote.
    const satu = sel.kind === "pw" ? pw?.tests.find((t) => `${t.file}|${t.title}` === sel.id) : null;
    const tc = satu?.title.split(" ")[0];
    const specs = tc ? [satu.file, `--grep=${tc}`] : ["--all"];
    fetch(`${API}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "pw", specs }),
    });
  };

  const pw = data?.playwright ?? null;
  const lh = data?.lighthouse?.targets ?? {};

  const perSitus = useMemo(() => {
    // Urutan tetap (file lalu judul TC), biar posisi nggak lompat-lompat tiap habis run.
    const daftar = [...(pw?.tests ?? [])].sort(
      (a, b) =>
        a.site.localeCompare(b.site) ||
        a.file.localeCompare(b.file) ||
        a.title.localeCompare(b.title, "id", { numeric: true }),
    );
    const m = new Map<string, PwTest[]>();
    for (const t of daftar) m.set(t.site, [...(m.get(t.site) ?? []), t]);
    return [...m.entries()];
  }, [pw]);

  const tambah = (grup: "pw" | "lh") =>
    setExtra((e) => ({ ...e, [grup]: [...e[grup], `item baru ${e[grup].length + 1}`] }));

  const pilih = (s: Sel) => {
    setSel(s);
    if (window.innerWidth < 800) setBuka(false);
  };

  const tes = sel.kind === "pw" ? pw?.tests.find((t) => `${t.file}|${t.title}` === sel.id) : null;
  const url =
    sel.kind === "lh" ? lh[sel.target]?.urls.find((u) => u.path === sel.path) : undefined;
  const lcpDiag = url?.lcp ? diagnosaLcp(url.lcp) : null;

  return (
    <div className={`shell ${buka ? "" : "tutup"}`}>
      <aside className="sidebar">
          <div>
            <div className="group-title">
              <span>Playwright</span>
              <button className="add" onClick={() => tambah("pw")} title="tambah sub-menu">
                +
              </button>
            </div>
            {perSitus.map(([site, tests]) => (
              <div key={site}>
                <div className="sub-label">{site}</div>
                <div className="nav-sub">
                  {tests.map((t) => {
                    const id = `${t.file}|${t.title}`;
                    return (
                      <button
                        key={id}
                        className={`nav-item ${sel.kind === "pw" && sel.id === id ? "on" : ""}`}
                        onClick={() => pilih({ kind: "pw", id })}
                        title={t.title}
                      >
                        <span
                          className="dot"
                          style={{
                            background: `var(--${lampu(t.status)})`,
                            boxShadow: `0 0 6px var(--${lampu(t.status)})`,
                          }}
                        />
                        {t.title}
                        {t.stale && <span className="muted"> · belum dijalankan ulang</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {extra.pw.map((x) => (
              <button key={x} className="nav-item muted" onClick={() => pilih({ kind: "home" })}>
                {x}
              </button>
            ))}
          </div>

          <div>
            <div className="group-title">
              <span>Lighthouse</span>
              <button className="add" onClick={() => tambah("lh")} title="tambah sub-menu">
                +
              </button>
            </div>
            {Object.entries(lh).map(([id, t]) => (
              <div key={id}>
                <div className="sub-label">{id}</div>
                <div className="nav-sub">
                  {t.urls.map((u) => (
                    <button
                      key={u.path}
                      className={`nav-item ${sel.kind === "lh" && sel.target === id && sel.path === u.path ? "on" : ""}`}
                      onClick={() => pilih({ kind: "lh", target: id, path: u.path })}
                    >
                      {u.path} · perf {pct(u.scores.performance)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {extra.lh.map((x) => (
              <button key={x} className="nav-item muted" onClick={() => pilih({ kind: "home" })}>
                {x}
              </button>
            ))}
          </div>

          <div className="spacer" />
          <div className="side-bottom">
            <a className="nav-item" href={`${base}/docs/intro/`}>
              Docusaurus / report
            </a>
          </div>
      </aside>

      <button className="backdrop" onClick={() => setBuka(false)} aria-label="tutup menu" />

      <main className="main">
        <button className="burger" onClick={() => setBuka(true)} aria-label="menu">
          ☰
        </button>

        <h1>QA Dashboard</h1>
        <div className="muted">
          Playwright + Lighthouse — jaja, masdis, ebh.
          {data ? ` Data: ${new Date(data.generatedAt).toLocaleString("id-ID")}.` : " Memuat data…"}
        </div>

        {err && <p className="fail">Gagal baca latest.json: {err}</p>}

        <h2>Proses</h2>
        <div className="card">
          <button className="btn" disabled={running} onClick={jalankan}>
            {running ? "Sedang jalan..." : tes ? "Jalankan TC ini" : "Jalankan semua spec"}
          </button>
          <div className="note">
            {running
              ? "tunggu, spec sedang dijalankan"
              : tes
                ? `cuma ${tes.title.split(" ")[0]} (${tes.file}) yang dijalankan.`
                : "klik untuk jalankan semua spec di eureka/."}
          </div>

          {log.length > 0 && (
            <details
              style={{ marginTop: 16 }}
              open={bukaLog}
              onToggle={(e) => setBukaLog((e.target as HTMLDetailsElement).open)}
            >
              <summary style={{ cursor: "pointer", fontWeight: 500 }}>
                Log ({log.length} baris)
              </summary>
              <pre
                style={{
                  marginTop: 10,
                  maxHeight: 300,
                  overflow: "auto",
                  fontSize: 11,
                  background: "#0d1013",
                  padding: 10,
                  borderRadius: 6,
                }}
              >
                {log.slice(-80).join("")}
              </pre>
            </details>
          )}
        </div>

        {sel.kind === "home" && (
          <>
            <h2>Ringkasan</h2>
            <div className="row">
              <div className="card">
                <div className="muted">Playwright</div>
                <div className="big">
                  {pw ? `${pw.passed}/${pw.passed + pw.failed + pw.skipped}` : "—"}
                </div>
                <div className="muted">
                  {pw ? `${pw.failed} gagal · ${sec(pw.ms)}` : "belum ada hasil"}
                </div>
              </div>
              {Object.entries(lh).map(([id, t]) => (
                <div className="card" key={id}>
                  <div className="muted">{t.target.site}</div>
                  <div className="big">
                    {pct(t.urls[0]?.scores.performance)}
                    <span className="muted" style={{ fontSize: 13 }}> perf</span>
                  </div>
                  <div className="muted">
                    {t.urls.length} URL · {t.errors} error · {t.warnings} warning
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tes && (
          <>
            <h2>
              {tes.title}{" "}
              <span className={`pill ${kelas(tes.status)}`}>{tes.status}</span>
            </h2>
            <div className="muted">
              <code>{tes.file}</code> · {tes.site} · {sec(tes.ms)}
            </div>

            <h2>Langkah</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Langkah</th>
                  <th>Durasi</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(tes.steps ?? []).map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{s.title}</td>
                    <td>{sec(s.ms)}</td>
                    <td>{s.error ? <span className="fail">gagal</span> : "ok"}</td>
                  </tr>
                ))}
                {!tes.steps?.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      langkah nggak terekam — pw-out/langkah.json kosong buat TC ini, jalankan
                      ulang tesnya.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {tes.error && (
              <>
                <h2>Error</h2>
                <pre>{tes.error}</pre>
              </>
            )}
          </>
        )}

        {url && (
          <>
            <h2>
              <code>{url.path}</code> — {lh[sel.kind === "lh" ? sel.target : ""]?.target.site}
            </h2>
            <div className="row">
              {["performance", "accessibility", "best-practices", "seo"].map((k) => (
                <div className="card" key={k}>
                  <div className="muted">{k}</div>
                  <div className="big">{pct(url.scores[k])}</div>
                  <div className="bar">
                    <i style={{ width: `${pct(url.scores[k])}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <h2>Metrik</h2>
            <table>
              <thead>
                <tr>
                  <th>Metrik</th>
                  <th>Nilai</th>
                  <th>Skor</th>
                  <th>Bobot</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(url.metrics).map(([k, m]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{m.display}</td>
                    <td>{pct(m.score ?? undefined)}</td>
                    <td>{Math.round(m.weight)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {url.lcp && (
              <>
                <h2>Diagnosa LCP — elemen terbesar</h2>
                {url.lcp.element && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Elemen
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <code style={{ fontSize: 11 }}>{url.lcp.element.selector}</code>
                    </div>
                    {url.lcp.element.label && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Label: {url.lcp.element.label}
                      </div>
                    )}
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>
                        lihat snippet
                      </summary>
                      <pre style={{ fontSize: 11, marginTop: 6 }}>{url.lcp.element.snippet}</pre>
                    </details>
                  </div>
                )}

                <table>
                  <thead>
                    <tr>
                      <th>Fase</th>
                      <th>Waktu</th>
                      <th>% LCP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {url.lcp.phases.map((p) => (
                      <tr key={p.phase}>
                        <td>{p.phase}</td>
                        <td>{p.timing} ms</td>
                        <td>
                          <strong>{p.percent}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {lcpDiag && (
                  <div className="card warn" style={{ marginTop: 16, borderColor: "#5a4415" }}>
                    <div style={{ fontWeight: 500, marginBottom: 6 }}>
                      Bottleneck: {lcpDiag.fase} ({lcpDiag.persen})
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {lcpDiag.saran}
                    </div>
                  </div>
                )}
              </>
            )}

            <h2>Masalah, urut dampak</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Audit</th>
                  <th>Kategori</th>
                  <th>Temuan</th>
                  <th>Dampak</th>
                </tr>
              </thead>
              <tbody>
                {url.issues.map((x, i) => (
                  <tr key={x.id}>
                    <td>{i + 1}</td>
                    <td>
                      <code>{x.id}</code>
                    </td>
                    <td>{x.category}</td>
                    <td>{x.display || x.title}</td>
                    <td>{x.impact.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {url.issues
              .filter((x) => x.details?.items?.length)
              .slice(0, 6)
              .map((x) => {
                const d = x.details!;
                const head = d.headings ?? [];
                const items = d.items ?? [];
                if (!head.length || !items.length) return null;

                const cellVal = (it: any, h: { key: string; valueType?: string }) => {
                  const v = it[h.key];
                  if (v && typeof v === "object") {
                    if (v.type === "node") return v.selector || v.snippet || "—";
                    if (v.url) return v.url;
                    if (v.items)
                      return v.items
                        .slice(0, 2)
                        .map((s: any) => `${s.url ?? "?"} (${ms(s.blockingTime ?? s.wastedMs)})`)
                        .join(", ");
                  }
                  if (h.valueType === "bytes") return kb(v);
                  if (h.valueType === "ms" || h.valueType === "timespanMs") return ms(v);
                  return String(v ?? "—");
                };

                return (
                  <details key={x.id} style={{ marginTop: 18 }} open={items.length <= 5}>
                    <summary style={{ cursor: "pointer", fontWeight: 500, marginBottom: 10 }}>
                      {x.title}
                      {d.overallSavingsMs ? ` — hemat ${ms(d.overallSavingsMs)}` : ""}
                      {d.overallSavingsBytes ? ` — hemat ${kb(d.overallSavingsBytes)}` : ""}
                    </summary>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            {head.map((h) => (
                              <th key={h.key}>{h.label || h.key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, j) => (
                            <tr key={j}>
                              {head.map((h) => (
                                <td key={h.key} style={{ maxWidth: 400, overflow: "hidden" }}>
                                  {cellVal(it, h)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
          </>
        )}
      </main>
    </div>
  );
}
