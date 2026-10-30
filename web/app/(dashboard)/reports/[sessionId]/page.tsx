"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api, artifactUrl, fmtDate, fmtDur, pct, reportUrl,
  type LighthouseResult, type PlaywrightResult, type Report, type Run, type Session,
} from "../../../../lib/playbook";
import { RunTerminal } from "../../run-terminal";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

// stale tanpa path = folder report sudah dibuang retensi, jangan tawarkan Buka.
const canPublish = (rep: Report) => rep.status !== "queued" && rep.status !== "building";

const publishNote = (rep: Report) =>
  rep.status === "failed" ? "gagal - build ulang" : rep.status === "stale" ? "folder report hilang" : "menunggu build selesai";

// Report Playwright/Lighthouse ada di index.html; screenshot HTML tidak boleh menang.
function pickReportArtifacts(run: Run) {
  const arts = run.artifacts ?? [];
  const html = arts.find(a => a.kind === "pw-html" || a.kind === "lh-html")
    ?? arts.find(a => /(^|\/)index\.html$/.test(a.path))
    ?? arts.find(a => a.path.endsWith(".html"));
  const dir = html ? html.path.replace(/[^/]+$/, "") : "";
  const json = arts.find(a => a.path === dir + "report.json")
    ?? arts.find(a => a.path.endsWith("report.json"));
  return { html, json };
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState("");
  // B9/A58: label tombol report memakai jendela retensi (endpoint publik, viewer boleh baca).
  // ponytail: fallback 7 kalau request gagal - tampilkan angka default saja.
  const [retention, setRetention] = useState(7);

  useEffect(() => {
    api.publicSettings().then(s => setRetention(Number(s.artifact_retention_days) || 7)).catch(() => {});
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
    setError(""); setNotice("");
    setBusy(scope);
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

  const deleteSession = async () => {
    if (!confirm("Hapus sesi ini beserta semua run, artifact, dan laporannya? Tidak bisa dibatalkan.")) return;
    const back = session?.project_id ? `/reports/project/${session.project_id}` : "/reports";
    try { await api.deleteSession(sessionId); router.push(back); }
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
  const tools = new Set(runs.filter(r => FINAL.includes(r.status)).map(r => r.tool));
  const passed = runs.filter(r => r.status === "passed").length;
  const failed = runs.filter(r => r.status === "failed").length;
  const active = runs.filter(r => !FINAL.includes(r.status)).length;
  const durations = runs.map(r => r.duration_ms).filter((v): v is number => v != null);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const back = session.project_id ? `/reports/project/${session.project_id}` : "/reports";

  return (
    <>
      <Link className="pb-crumb" href={back}>← Kembali ke project</Link>

      <div className="pb-sess-head">
        <div className="pb-sess-title">
          <div className="eyebrow">Sesi</div>
          <h1>{session.label}</h1>
          <div className="pb-sess-meta">
            <span className={`pb-badge ${session.status}`}>{session.status}</span>
            <span className="pb-chip mono">{session.target_url}</span>
            <span className="pb-chip">{fmtDate(session.created_at)}</span>
          </div>
        </div>
        <div className="pb-sess-actions">
          <div className="pb-btn-group">
            <button className="pb-btn sm" onClick={() => publish("pw")}
              disabled={!tools.has("pw") || !!busy}>{busy === "pw" ? "…" : "Playwright"}</button>
            <button className="pb-btn sm" onClick={() => publish("lh")}
              disabled={!tools.has("lh") || !!busy}>{busy === "lh" ? "…" : "Lighthouse"}</button>
            <button className="pb-btn sm primary" onClick={() => publish("both")}
              disabled={!tools.has("pw") || !tools.has("lh") || !!busy}>{busy === "both" ? "…" : "Gabungan"}</button>
          </div>
          <button className="pb-btn sm danger" onClick={deleteSession} disabled={!!busy}>Hapus sesi</button>
        </div>
      </div>

      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-card pb-notice">{notice}</div>}

      <div className="pb-kpi-grid">
        <div className="pb-kpi">
          <div className="pb-kpi-label">Total run</div>
          <div className="pb-kpi-value">{runs.length}</div>
          <div className="pb-kpi-foot">{active > 0 ? `${active} masih jalan` : "semua final"}</div>
        </div>
        <div className="pb-kpi">
          <div className="pb-kpi-label">Lulus</div>
          <div className="pb-kpi-value ok">{passed}</div>
          <div className="pb-kpi-foot">run status passed</div>
        </div>
        <div className="pb-kpi">
          <div className="pb-kpi-label">Gagal</div>
          <div className="pb-kpi-value bad">{failed}</div>
          <div className="pb-kpi-foot">run status failed</div>
        </div>
        <div className="pb-kpi">
          <div className="pb-kpi-label">Rata-rata durasi</div>
          <div className="pb-kpi-value">{avgDur == null ? "-" : fmtDur(avgDur)}</div>
          <div className="pb-kpi-foot">{durations.length} run terukur</div>
        </div>
      </div>

      <div className="pb-sess-cols">
        <section className="pb-card pb-sess-panel">
          <div className="pb-card-head">
            <div>
              <h2>Run</h2>
              <div className="pb-card-sub">{runs.length} run di sesi ini</div>
            </div>
          </div>

          {runs.length === 0 ? (
            <p className="pb-empty">Belum ada run di sesi ini.</p>
          ) : (
            <div className="pb-runlist">
              {runs.map(r => (
                <div className="pb-runrow" key={r.id}>
                  <span className={`pb-tool ${r.tool}`}>{r.tool === "pw" ? "PW" : "LH"}</span>
                  <div className="pb-runrow-main">
                    <div className="pb-runrow-title">{r.tool === "pw" ? "Playwright" : "Lighthouse"}</div>
                    <div className="pb-runrow-sub mono">
                      {fmtDate(r.finalized_at)} · {fmtDur(r.duration_ms)} · exit {r.exit_code ?? "-"}
                    </div>
                  </div>
                  <span className={`pb-badge ${r.status}`}>{r.status}</span>
                  <div className="pb-runrow-act">
                    {!FINAL.includes(r.status) && (
                      <button className="pb-btn sm" onClick={() => cancelRun(r)} disabled={busy === r.id}>
                        {busy === r.id ? "…" : "Cancel"}
                      </button>
                    )}
                    <button className="pb-btn sm" onClick={() => openRunDetail(r)}>Hasil</button>
                    {FINAL.includes(r.status) && (
                      <button className="pb-btn sm" onClick={() => deleteRun(r)} disabled={busy === r.id}>Hapus</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="pb-card pb-sess-panel">
          <div className="pb-card-head">
            <div>
              <h2>Laporan</h2>
              <div className="pb-card-sub">Snapshot HTML dari run sesi ini</div>
            </div>
          </div>

          {(session.reports?.length ?? 0) === 0 ? (
            <p className="pb-empty">Belum ada laporan. Terbitkan dari tombol di atas.</p>
          ) : (
            <div className="pb-replist">
              {session.reports!.map((rep: Report) => {
                const ids: string[] = (() => { try { return JSON.parse(rep.run_ids ?? "[]"); } catch { return []; } })();
                const missing = ids.filter(id => !runs.some(r => r.id === id));
                // stale tanpa path = folder report sudah dibuang retensi.
                const canOpen = rep.status === "ready" || (rep.status === "stale" && !!rep.path);
                const scopeLabel = rep.scope === "both" ? "Gabungan" : rep.scope === "pw" ? "Playwright" : "Lighthouse";
                return (
                  <div className="pb-repcard" key={rep.id}>
                    <div className="pb-repcard-top">
                      <span className={`pb-tool ${rep.scope === "both" ? "both" : rep.scope}`}>
                        {rep.scope === "both" ? "PW+LH" : rep.scope === "pw" ? "PW" : "LH"}
                      </span>
                      <div className="pb-repcard-main">
                        <div className="pb-repcard-title">{scopeLabel}</div>
                        <div className="pb-repcard-sub mono">{fmtDate(rep.built_at)}</div>
                      </div>
                      <span className={`pb-badge ${rep.status}`}>{rep.status}</span>
                    </div>
                    {rep.status === "stale" && <div className="pb-repcard-note">ada run baru, build ulang</div>}
                    {missing.length > 0 && <div className="pb-repcard-note">run dihapus: {missing.length}</div>}
                    {rep.status === "ready" && rep.mode === "html" && (
                      <div className="pb-repcard-note">mode HTML cadangan</div>
                    )}
                    {rep.status === "ready" && rep.mode === "docs" && (
                      <div className="pb-repcard-note" style={{ color: "var(--ok)" }}>mode Docusaurus</div>
                    )}
                    {rep.status === "failed" && rep.error && (
                      <div className="pb-repcard-note">gagal: {rep.error}</div>
                    )}
                    <div className="pb-repcard-act">
                      {canOpen
                        ? <a className="pb-btn sm primary" href={reportUrl(rep.id)} target="_blank" rel="noreferrer">Buka</a>
                        : <span className="pb-muted" style={{ fontSize: 12 }}>{publishNote(rep)}</span>}
                      {rep.status === "ready" && (
                        <a className="pb-btn sm" href={reportUrl(rep.id, "report.md")} target="_blank" rel="noreferrer">Markdown</a>
                      )}
                      <button className="pb-btn sm" onClick={() => publish(rep.scope)}
                        disabled={busy === rep.scope || !canPublish(rep)}>
                        {busy === rep.scope ? "…" : rep.status === "ready" || rep.status === "stale" ? "Build ulang" : "Terbitkan"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {openRun && <RunPanel run={openRun} retention={retention} onClose={() => setOpenRun(null)} />}
    </>
  );
}

function RunPanel({ run, retention, onClose }: { run: Run; retention: number; onClose: () => void }) {
  const results = run.results ?? [];
  const isPw = run.tool === "pw";
  const { html, json: report } = pickReportArtifacts(run);

  return (
    <section className="pb-card pb-runpanel">
      <div className="pb-runpanel-head">
        <span className={`pb-tool ${run.tool}`}>{isPw ? "PW" : "LH"}</span>
        <h2>Hasil run · {isPw ? "Playwright" : "Lighthouse"}</h2>
        <span className={`pb-badge ${run.status}`}>{run.status}</span>
        <span className="pb-spacer" />
        <span className="pb-muted mono" style={{ fontSize: 12 }}>{fmtDur(run.duration_ms)}</span>
        <button className="pb-btn sm" onClick={onClose}>Tutup</button>
      </div>

      {isPw ? (
        <table className="pb-table">
          <thead><tr><th>TC</th><th>Judul</th><th>Status</th><th>Durasi</th><th>Retry</th><th>Error</th></tr></thead>
          <tbody>
            {(results as PlaywrightResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.tc_id ?? "-"}</td>
                <td>{r.title}</td>
                <td><span className={`pb-badge ${r.status}`}>{r.status}</span></td>
                <td className="mono">{fmtDur(r.duration_ms)}</td>
                <td className="mono">{r.retry}</td>
                <td className="mono" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{r.error ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="pb-table">
          <thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Skor tidak memenuhi</th><th /></tr></thead>
          <tbody>
            {(results as LighthouseResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.url}</td>
                <td>{pct(r.performance)}</td>
                <td>{pct(r.accessibility)}</td>
                <td>{pct(r.best_practices)}</td>
                <td>{pct(r.seo)}</td>
                <td className="mono">{r.lcp_ms ? `${Math.round(r.lcp_ms)}ms` : "-"}</td>
                <td className="mono">{r.budget_failed ?? "-"}</td>
                <td style={{ textAlign: "right" }}>
                  {r.report_path
                    ? <a className="pb-btn sm" href={artifactUrl(run.id, r.report_path)} target="_blank" rel="noreferrer">Report</a>
                    : <span className="pb-muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RunTerminal runId={run.id} />

      {html && <ReportFrame runId={run.id} path={html.path} jsonPath={report?.path} />}
      {!html && !(run.artifacts?.length) && FINAL.includes(run.status) && (
        <p className="pb-muted" style={{ marginTop: 12, fontSize: 12 }}>
          <button className="pb-btn sm" disabled>Report mentah</button>{" "}
          artifact dihapus (retensi {retention} hari)
        </p>
      )}
      {!html && (run.artifacts?.length ?? 0) > 0 && (
        <p className="pb-muted" style={{ marginTop: 12, fontSize: 12 }}>
          run ini tidak menghasilkan HTML report{" "}
          <button className="pb-btn sm" onClick={onClose}>Tutup</button>
        </p>
      )}
    </section>
  );
}

// PRD §10.8: cek artifact dulu. 401 → tombol login ulang, selain itu → pesan jelas,
// supaya tidak ada iframe kosong yang bikin dashboard terlihat rusak.
function ReportFrame({ runId, path, jsonPath }: { runId: string; path: string; jsonPath?: string }) {
  const url = artifactUrl(runId, path);
  const [state, setState] = useState<"checking" | "ok" | "auth" | "missing">("checking");

  useEffect(() => {
    let live = true;
    setState("checking");
    // Backend mati tidak boleh menggantung panel sampai proxy timeout 30 s.
    fetch(url, { method: "HEAD", credentials: "include", signal: AbortSignal.timeout(5000) })
      .then(r => { if (live) setState(r.ok ? "ok" : r.status === 401 ? "auth" : "missing"); })
      .catch(() => { if (live) setState("missing"); });
    return () => { live = false; };
  }, [url]);

  if (state === "checking") return <div className="pb-skel" style={{ height: 200, marginTop: 14 }} />;
  if (state === "auth") {
    const next = typeof window === "undefined" ? "" : location.pathname + location.search;
    return (
      <p className="pb-muted" style={{ marginTop: 14, fontSize: 12 }}>
        Sesi login habis.{" "}
        <a className="pb-btn sm" href={"/login?next=" + encodeURIComponent(next)}>Login ulang</a>
      </p>
    );
  }
  if (state === "missing") return <p className="pb-muted" style={{ marginTop: 14, fontSize: 12 }}>report tidak tersedia</p>;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="pb-row" style={{ marginBottom: 8 }}>
        <a className="pb-btn sm" href={url} target="_blank" rel="noreferrer">Buka tab baru</a>
        {jsonPath && <a className="pb-btn sm" href={artifactUrl(runId, jsonPath)} target="_blank" rel="noreferrer">JSON mentah</a>}
      </div>
      <iframe title="report mentah" src={url}
        style={{ width: "100%", height: 520, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }} />
    </div>
  );
}
