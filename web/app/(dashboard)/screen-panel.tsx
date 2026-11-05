"use client";

// Panel kanan log: layar live bot, rekaman video, dan trace Playwright.
// Semua frame berasal dari preload (scripts/pw-capture.cjs) yang menulis JPEG
// ke folder run; panel ini hanya memilih frame terbaru dan menyediakan scrub.
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, liveFrameUrl, fmtTime,
  type LiveFrame, type Run, type RunControl,
} from "../../lib/playbook";

type Tab = "layar" | "rekaman" | "trace";

const CONTROL_ERROR = (e: unknown) => (e as Error).message;

export function ScreenPanel({ runId, run, live }: {
  runId: string | null;
  run: Run | null;
  live: boolean;
}) {
  const [tab, setTab] = useState<Tab>("layar");
  const [frames, setFrames] = useState<LiveFrame[]>([]);
  const [latest, setLatest] = useState<number | null>(null);
  const [mode, setMode] = useState<RunControl["mode"]>("run");
  const [paused, setPaused] = useState<RunControl["state"]>(null);
  const [debug, setDebug] = useState(false);
  const [picked, setPicked] = useState<number | null>(null); // null = ikuti frame terbaru
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Poll 1 dtk selama run. Setelah final, satu fetch terakhir mengambil frame
  // sisa (runner menyisakan 1 menit terakhir untuk scrub).
  useEffect(() => {
    if (!runId) { setFrames([]); setLatest(null); setPaused(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const x = await api.live(runId);
        if (!alive) return;
        setFrames(x.frames);
        setLatest(x.latest ?? null);
        setMode(x.mode);
        setPaused(x.state ?? null);
        setDebug(!!x.debug);
      } catch (e) {
        if (alive) setError(CONTROL_ERROR(e));
      }
      if (alive && live) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [runId, live]);

  // Ganti run → jangan bawa frame lama atau posisi scrub run sebelumnya.
  useEffect(() => { setPicked(null); setError(""); }, [runId]);

  // Esc menutup tampilan besar.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const control = async (action: "pause" | "resume" | "step") => {
    if (!runId) return;
    setBusy(true); setError("");
    try {
      const x = await api.control(runId, action);
      setMode(x.mode as RunControl["mode"]);
    } catch (e) {
      setError(CONTROL_ERROR(e));
    } finally { setBusy(false); }
  };

  const shown = picked ?? latest;
  const index = Math.max(0, frames.findIndex(f => f.n === shown));
  const frame = shown == null ? null : frames.find(f => f.n === shown) ?? null;
  const videos = (run?.artifacts ?? []).filter(a => a.kind === "video");
  const traces = (run?.artifacts ?? []).filter(a => a.kind === "trace");
  const isDebug = debug || mode !== "run" || !!paused;

  return (
    <section className="pb-card pb-screen" aria-label="Layar run">
      <div className="pb-row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div className="pb-tabs" role="tablist">
          {(["layar", "rekaman", "trace"] as const).map(k => (
            <button key={k} role="tab" aria-selected={tab === k}
              className={"pb-tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>
              {k === "layar" ? "Layar" : k === "rekaman" ? `Rekaman ${videos.length || ""}` : `Trace ${traces.length || ""}`}
            </button>
          ))}
        </div>
        {live && <span className="pb-live-state">langsung</span>}
      </div>

      {tab === "layar" && (
        <>
          {isDebug && (
            <div className="pb-debug-bar">
              <span className={"pb-debug-badge" + (mode === "pause" ? " pause" : "")}>
                {mode === "pause" ? "jeda" : mode === "step" ? "melangkah" : "debug"}
              </span>
              <span className="pb-debug-label" title={paused?.label ?? ""}>
                {paused?.label ? `di: ${paused.label}` : "menunggu checkpoint…"}
              </span>
              <span className="pb-row" style={{ gap: 6, marginLeft: "auto" }}>
                {mode === "pause"
                  ? <button className="pb-btn sm" disabled={busy} onClick={() => control("step")}>Step</button>
                  : <button className="pb-btn sm" disabled={busy || !live} onClick={() => control("pause")}>Jeda</button>}
                {mode !== "run" && <button className="pb-btn sm" disabled={busy} onClick={() => control("resume")}>Lanjut</button>}
              </span>
            </div>
          )}

          <div className="pb-frame" ref={box}>
            {frame ? (
              <img src={liveFrameUrl(runId!, frame.n)} alt={`Layar ${fmtTime(frame.at)}`}
                onClick={() => setZoom(true)} title="Klik untuk memperbesar" />
            ) : (
              <span className="pb-frame-empty">
                {!runId ? "Mulai run untuk melihat layar bot."
                  : live ? "Menunggu frame pertama…"
                  : "Tidak ada frame terekam untuk run ini."}
              </span>
            )}
          </div>

          <div className="pb-row" style={{ justifyContent: "space-between", gap: 8, marginTop: 8 }}>
            <span className="pb-muted" style={{ fontSize: 11.5 }}>
              {frames.length ? `${frames.length} frame · ${frame ? fmtTime(frame.at) : "-"}` : "1 frame/detik"}
            </span>
            <span className="pb-row" style={{ gap: 6 }}>
              {picked !== null && <button className="pb-btn sm" onClick={() => setPicked(null)}>Langsung</button>}
              {frame && <button className="pb-btn sm" onClick={() => setZoom(true)}>Perbesar</button>}
            </span>
          </div>

          {frames.length > 1 && (
            <input className="pb-range" type="range" min={0} max={frames.length - 1} value={index}
              aria-label="Pilih frame"
              onChange={e => setPicked(frames[Number(e.target.value)]?.n ?? null)} />
          )}
        </>
      )}

      {tab === "rekaman" && (
        videos.length === 0
          ? <p className="pb-empty">
              {live ? "Video tersedia setelah run selesai."
                : "Run ini tidak merekam video. Centang “Rekam video” sebelum Run."}
            </p>
          : <div className="pb-videos">
              {videos.map(v => (
                <figure key={v.id} className="pb-video">
                  <video controls preload="metadata" src={artifactUrl(run!.id, v.path)} />
                  <figcaption>
                    <span className="pb-mono" title={v.path}>{v.path}</span>
                    <a className="pb-btn sm" href={artifactUrl(run!.id, v.path)} download>Unduh</a>
                  </figcaption>
                </figure>
              ))}
            </div>
      )}

      {tab === "trace" && (
        traces.length === 0
          ? <p className="pb-empty">
              Trace hanya disimpan saat run gagal atau mode Debug.
              Buka lewat <span className="pb-mono">npx playwright show-trace file.zip</span>.
            </p>
          : <div className="pb-videos">
              {traces.map(t => (
                <div key={t.id} className="pb-trace">
                  <span className="pb-mono" title={t.path}>{t.path}</span>
                  <a className="pb-btn sm" href={artifactUrl(run!.id, t.path)} download>Unduh trace</a>
                </div>
              ))}
            </div>
      )}

      {error && <div className="pb-err" role="alert" style={{ marginTop: 8 }}>{error}</div>}

      {zoom && frame && (
        <div className="pb-zoom" role="dialog" aria-modal="true" onClick={() => setZoom(false)}>
          <img src={liveFrameUrl(runId!, frame.n)} alt={`Layar ${fmtTime(frame.at)}`} />
          <button className="pb-btn" onClick={() => setZoom(false)}>Tutup (Esc)</button>
        </div>
      )}
    </section>
  );
}
