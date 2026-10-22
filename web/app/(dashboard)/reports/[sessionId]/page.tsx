"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api, artifactUrl, fmtDate, fmtDur, pct, reportUrl,
  type LighthouseResult, type PlaywrightResult, type Report, type Run, type Session,
} from "../../../../lib/playbook";
import { RunTerminal } from "../../run-terminal";

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState("");
  // B9/A58: label tombol report memakai jendela retensi; viewer 403 → fallback 7.
  const [retention, setRetention] = useState(7);

  useEffect(() => {
    api.settings().then(s => setRetention(Number(s.artifact_retention_days) || 7)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.session(sessionId).then(setSession).catch(e => setError(e.message));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // Poll selama ada run atau laporan yang belum selesai.
  useEffect(() => {
    const runActive = session?.runs?.some(r => ["queued", "running", "uploading"].includes(r.status));
    const reportActive = session?.reports?.some(r => ["queued", "building"].includes(r.status));
    if (!runActive && !reportActive) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [session, load]);

  const openRunDetail = async (run: Run) => {
    try { setOpenRun(await api.run(run.id)); } catch (e) { setError((e as Error).message); }
  };

  // Snapshot run terbuka ikut diperbarui selama belum final.
  useEffect(() => {
    if (!openRun) return;
    if (!["queued", "running", "uploading"].includes(openRun.status)) return;
    const t = setTimeout(() => {
      api.run(openRun.id).then(setOpenRun).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [openRun]);

  const publish = async (scope: "pw" | "lh" | "both") => {
    setBusy(scope); setError(""); setNotice("");
    try {
      const r = await api.createReport(sessionId, scope);
      setNotice(`Laporan ${scope} masuk antrean (${r.reportId.slice(0, 8)}).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(""); }
  };

  const cancelRun = async (run: Run) => {
    if (!confirm("Batalkan run ini? Proses tool akan dimatikan.")) return;
    setBusy(run.id); setError(""); setNotice("");
    try {
      await api.cancelRun(run.id);
      setNotice("Run dibatalkan.");
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const closeSession = async () => {
    if (!confirm("Tutup sesi ini? Sesi tertutup tidak bisa dipakai ulang, tapi datanya tetap ada.")) return;
    setBusy("close"); setError(""); setNotice("");
    try { await api.closeSession(sessionId); setNotice("Sesi ditutup."); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const deleteSession = async () => {
    if (!confirm("Hapus sesi ini beserta semua run, artifact, dan laporannya? Tidak bisa dibatalkan.")) return;
    try { await api.deleteSession(sessionId); location.href = "/reports"; }
    catch (e) { setError((e as Error).message); }
  };

  const deleteRun = async (run: Run) => {
    if (!confirm("Hapus run ini beserta artifact-nya?")) return;
    setBusy(run.id); setError(""); setNotice("");
    try { await api.deleteRun(run.id); setNotice("Run dihapus."); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  if (!session) return <p className="pb-empty">{error || "Memuat sesi…"}</p>;

  const runs = session.runs ?? [];
  const tools = new Set(runs.filter(r => ["passed", "failed"].includes(r.status)).map(r => r.tool));

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>{session.label}</h1>
          <p className="pb-muted" style={{ margin: "4px 0 0" }}>
            {session.env} · {session.target_url} · <span className={`pb-badge ${session.status}`}>{session.status}</span>
          </p>
        </div>
        <div className="pb-row">
          <button className="pb-btn sm" onClick={closeSession} disabled={!!session.closed_at || !!busy}>Tutup sesi</button>
          <button className="pb-btn sm" onClick={deleteSession} disabled={!!busy}>Hapus sesi</button>
          <button className="pb-btn sm" onClick={() => { setBusy("pw"); publish("pw"); }} disabled={!tools.has("pw") || !!busy}>Laporan Playwright</button>
          <button className="pb-btn sm" onClick={() => { setBusy("lh"); publish("lh"); }} disabled={!tools.has("lh") || !!busy}>Laporan Lighthouse</button>
          <button className="pb-btn sm primary" onClick={() => publish("both")} disabled={!tools.has("pw") || !tools.has("lh") || !!busy}>Gabungan</button>
        </div>
      </div>

      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-card" style={{ marginBottom: 14 }}>{notice}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Run ({runs.length})</h2>
        {runs.length === 0 && <p className="pb-empty">Belum ada run di sesi ini.</p>}
        {runs.length > 0 && (
          <table className="pb-table">
            <thead><tr><th>Tool</th><th>Status</th><th>Durasi</th><th>Exit</th><th>Final</th><th /></tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td>{r.tool === "pw" ? "Playwright" : "Lighthouse"}</td>
                  <td><span className={`pb-badge ${r.status}`}>{r.status}</span></td>
                  <td className="mono">{fmtDur(r.duration_ms)}</td>
                  <td className="mono">{r.exit_code ?? "—"}</td>
                  <td className="mono">{fmtDate(r.finalized_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className="pb-row" style={{ justifyContent: "flex-end" }}>
                      {!["passed", "failed", "cancelled", "interrupted"].includes(r.status) && (
                        <button className="pb-btn sm" onClick={() => cancelRun(r)} disabled={busy === r.id}>
                          {busy === r.id ? "Membatalkan…" : "Cancel"}
                        </button>
                      )}
                      <button className="pb-btn sm" onClick={() => openRunDetail(r)}>Hasil</button>
                      {["passed", "failed", "cancelled", "interrupted"].includes(r.status) && (
                        <button className="pb-btn sm" onClick={() => deleteRun(r)} disabled={busy === r.id}>Hapus</button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(session.reports?.length ?? 0) > 0 && (
        <section className="pb-card" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Laporan</h2>
          <table className="pb-table">
            <tbody>
              {session.reports!.map((rep: Report) => {
                const ids: string[] = (() => { try { return JSON.parse(rep.run_ids ?? "[]"); } catch { return []; } })();
                const missing = ids.filter(id => !runs.some(r => r.id === id));
                const scopeLabel = rep.scope === "both" ? "Gabungan" : rep.scope === "pw" ? "Playwright" : "Lighthouse";
                return (
                  <tr key={rep.id}>
                    <td>{scopeLabel}</td>
                    <td>
                      <span className={`pb-badge ${rep.status}`}>{rep.status}</span>
                      {rep.status === "stale" && <span className="pb-muted" style={{ fontSize: 11, marginLeft: 6 }}>ada run baru</span>}
                    </td>
                    <td className="mono">{fmtDate(rep.built_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="pb-row" style={{ justifyContent: "flex-end" }}>
                        {rep.status === "ready" || rep.status === "stale"
                          ? <a className="pb-btn sm" href={reportUrl(rep.id)} target="_blank" rel="noreferrer">Buka</a>
                          : <span className="pb-muted">{rep.error ?? "…"}</span>}
                        <button className="pb-btn sm" onClick={() => publish(rep.scope)} disabled={!!busy}>
                          {rep.status === "stale" ? "Build ulang" : "Terbitkan"}
                        </button>
                      </span>
                      {missing.length > 0 && <div className="pb-muted" style={{ fontSize: 11 }}>run dihapus: {missing.length}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {openRun && <RunPanel run={openRun} retention={retention} onClose={() => setOpenRun(null)} />}
    </>
  );
}

function RunPanel({ run, retention, onClose }: { run: Run; retention: number; onClose: () => void }) {
  const results = run.results ?? [];
  const isPw = run.tool === "pw";
  const report = run.artifacts?.find(a => a.path.endsWith("report.json"));
  const html = run.artifacts?.find(a => a.path.endsWith(".html"));

  return (
    <section className="pb-card" style={{ marginBottom: 16 }}>
      <div className="pb-row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Hasil run · {run.tool === "pw" ? "Playwright" : "Lighthouse"}</h2>
        <span className={`pb-badge ${run.status}`}>{run.status}</span>
        <span className="pb-spacer" />
        <button className="pb-btn sm" onClick={onClose}>Tutup</button>
      </div>

      {isPw ? (
        <table className="pb-table">
          <thead><tr><th>TC</th><th>Judul</th><th>Status</th><th>Durasi</th><th>Retry</th><th>Error</th></tr></thead>
          <tbody>
            {(results as PlaywrightResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.tc_id ?? "—"}</td>
                <td>{r.title}</td>
                <td><span className={`pb-badge ${r.status}`}>{r.status}</span></td>
                <td className="mono">{fmtDur(r.duration_ms)}</td>
                <td className="mono">{r.retry}</td>
                <td className="mono" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{r.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="pb-table">
          <thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Budget gagal</th><th /></tr></thead>
          <tbody>
            {(results as LighthouseResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.url}</td>
                <td>{pct(r.performance)}</td>
                <td>{pct(r.accessibility)}</td>
                <td>{pct(r.best_practices)}</td>
                <td>{pct(r.seo)}</td>
                <td className="mono">{r.lcp_ms ? `${Math.round(r.lcp_ms)}ms` : "—"}</td>
                <td className="mono">{r.budget_failed ?? "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {r.report_path
                    ? <a className="pb-btn sm" href={artifactUrl(run.id, r.report_path)} target="_blank" rel="noreferrer">Report</a>
                    : <span className="pb-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RunTerminal runId={run.id} />

      {html && (
        <div style={{ marginTop: 14 }}>
          <div className="pb-row" style={{ marginBottom: 8 }}>
            <a className="pb-btn sm" href={artifactUrl(run.id, html.path)} target="_blank" rel="noreferrer">Buka tab baru</a>
            {report && <a className="pb-btn sm" href={artifactUrl(run.id, report.path)} target="_blank" rel="noreferrer">JSON mentah</a>}
          </div>
          <iframe title="report mentah" src={artifactUrl(run.id, html.path)}
            style={{ width: "100%", height: 520, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }} />
        </div>
      )}
      {!html && !(run.artifacts?.length) && ["passed", "failed", "cancelled", "interrupted"].includes(run.status) && (
        <p className="pb-muted" style={{ marginTop: 12, fontSize: 12 }}>
          <button className="pb-btn sm" disabled>Report mentah</button>{" "}
          artifact dihapus (retensi {retention} hari)
        </p>
      )}
    </section>
  );
}
