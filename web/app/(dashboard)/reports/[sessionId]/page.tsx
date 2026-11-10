"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api, artifactUrl, fmtDate, fmtDur, pct, rememberProject, reportUrl, runStatusLabel,
  type LighthouseResult, type PlaywrightResult, type Report, type Run, type Session,
} from "../../../../lib/playbook";
import { RunTerminal } from "../../run-terminal";
import { ArtifactLink, LoginAgain, useProbe } from "../../../_components/report-link";
import { RunClock } from "../../../_components/run-clock";
import { ToolMark } from "../../../_components/tool-mark";
import { confirmAction, showInfoToast, showSuccessToast } from "../../../../lib/alerts";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

// Backend membalas {"error":"Not found"} untuk sesi yang dihapus/kena retensi;
// terjemahkan jadi pesan user.
const friendly = (msg: string) =>
  /not ?found/i.test(msg) ? "Sesi tidak ditemukan - mungkin sudah dihapus atau kena retensi." : msg;

// stale tanpa path = folder report sudah dibuang retensi, jangan tawarkan Buka.
const canPublish = (rep: Report) => rep.status !== "queued" && rep.status !== "building";

const publishNote = (rep: Report) =>
  rep.status === "failed" ? "gagal - build ulang" : rep.status === "stale" ? "folder report hilang" : "menunggu build selesai";

// Report Playwright/Lighthouse ada di index.html; screenshot HTML tidak boleh menang.
function lhViewerHref(run: Run, resultId?: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const query = new URLSearchParams({ run: run.id });
  if (resultId) query.set("result", resultId);
  return `${basePath}/reports/${encodeURIComponent(run.session_id)}/lh-report?${query}`;
}

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
  // B9/A58: label tombol report memakai jendela retensi (endpoint publik).
  // ponytail: fallback 7 kalau request gagal.
  const [retention, setRetention] = useState(7);

  useEffect(() => {
    api.publicSettings().then(s => setRetention(Number(s.artifact_retention_days) || 7)).catch(() => { });
  }, []);

  const load = useCallback(() => {
    api.session(sessionId).then(setSession).catch(e => setError(friendly(e.message)));
  }, [sessionId]);

  // Buka laporan = jadikan project sesi ini project terakhir.
  useEffect(() => {
    if (session?.project_id) rememberProject(session.project_id);
  }, [session?.project_id]);

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
    try {
      setOpenRun(await api.run(run.id));
      // Panel muncul di bawah daftar run; tanpa scroll user mengira tombol diam.
      setTimeout(() => {
        const el = document.getElementById("hasil-run");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        el?.focus({ preventScroll: true });
      }, 0);
    } catch (e) { setError((e as Error).message); }
  };

  const closeRunPanel = async () => {
    if (!(await confirmAction({
      icon: "question",
      title: "Tutup panel hasil run?",
      confirmButtonText: "Ya, Tutup",
    }))) return;
    setOpenRun(null);
    showInfoToast("Panel hasil run ditutup.");
  };

  // Snapshot run terbuka ikut diperbarui selama belum final.
  useEffect(() => {
    if (!openRun) return;
    if (!["queued", "running", "uploading"].includes(openRun.status)) return;
    const t = setTimeout(() => {
      api.run(openRun.id).then(setOpenRun).catch(() => { });
    }, 2000);
    return () => clearTimeout(t);
  }, [openRun]);

  const publish = async (scope: "pw" | "lh" | "both", verb = "Buat") => {
    const label = scope === "both" ? "Gabungan" : scope === "pw" ? "Playwright" : "Lighthouse";
    if (!(await confirmAction({
      icon: "question",
      title: `${verb} laporan ${label}?`,
      text: "Laporan dibangun dari run yang sudah selesai.",
      confirmButtonText: `Ya, ${verb}`,
    }))) return;
    setError(""); setNotice("");
    setBusy(scope);
    try {
      const r = await api.createReport(sessionId, scope);
      setNotice(`Laporan ${scope} masuk antrean (${r.reportId.slice(0, 8)}).`);
      showSuccessToast(`Laporan ${label} masuk antrean.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(""); }
  };

  const cancelRun = async (run: Run) => {
    if (!(await confirmAction({
      icon: "warning",
      title: "Batalkan run ini?",
      text: "Proses tool akan dimatikan.",
      confirmButtonText: "Ya, Batalkan",
    }))) return;
    setBusy(run.id); setError(""); setNotice("");
    try {
      await api.cancelRun(run.id);
      setNotice("Run dibatalkan.");
      showSuccessToast("Run dibatalkan.");
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const deleteSession = async () => {
    const activeRuns = session?.runs?.filter(r => !FINAL.includes(r.status)).length ?? 0;
    if (activeRuns > 0) { setError("Batalkan run yang masih berjalan sebelum menghapus sesi."); return; }
    if (!(await confirmAction({
      icon: "warning",
      title: "Hapus sesi ini?",
      text: "Semua run, artifact, dan laporannya ikut terhapus. Tidak bisa dibatalkan.",
      confirmButtonText: "Ya, Hapus",
    }))) return;
    setBusy("delete"); setError("");
    const back = session?.project_id ? `/reports/project/${session.project_id}` : "/reports";
    try {
      await api.deleteSession(sessionId);
      showSuccessToast("Sesi dihapus.");
      router.push(back);
    }
    catch (e) { setError((e as Error).message); setBusy(""); }
  };

  const closeSession = async () => {
    if (!(await confirmAction({
      icon: "question",
      title: "Tutup sesi ini?",
      text: "Run baru akan membuat sesi terpisah.",
      confirmButtonText: "Ya, Tutup",
    }))) return;
    setBusy("close"); setError(""); setNotice("");
    try {
      await api.closeSession(sessionId);
      setNotice("Sesi ditutup.");
      showSuccessToast("Sesi ditutup.");
      load();
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const deleteRun = async (run: Run) => {
    if (!(await confirmAction({
      icon: "warning",
      title: "Hapus run ini?",
      text: "Artifact run ikut terhapus.",
      confirmButtonText: "Ya, Hapus",
    }))) return;
    setBusy(run.id); setError(""); setNotice("");
    try {
      await api.deleteRun(run.id);
      setNotice("Run dihapus.");
      showSuccessToast("Run dihapus.");
      load();
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  if (!session) {
    return error ? (
      <section className="pb-card">
        <div className="pb-err" role="alert">{error}</div>
        <Link className="pb-btn sm" href="/reports">Kembali ke Laporan</Link>
      </section>
    ) : <p className="pb-empty">Memuat sesi…</p>;
  }

  const runs = session.runs ?? [];
  const tools = new Set(runs.filter(r => FINAL.includes(r.status)).map(r => r.tool));
  const hasPw = tools.has("pw");
  const hasLh = tools.has("lh");
  const hasBoth = hasPw && hasLh;
  const passed = runs.filter(r => r.status === "passed").length;
  const failed = runs.filter(r => r.status === "failed").length;
  const active = runs.filter(r => !FINAL.includes(r.status)).length;
  const runActive = active > 0;
  const durations = runs.map(r => r.duration_ms).filter((v): v is number => v != null);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  return (
    <>
      <div className="pb-sess-head">
        <div className="pb-sess-title">
          <h1>{session.label}</h1>
          <div className="pb-sess-meta">
            <span className={`pb-badge ${session.status}`}>{session.status}</span>
            <span className="pb-chip mono">{session.target_url}</span>
            <span className="pb-chip">{fmtDate(session.created_at)}</span>
          </div>
        </div>
        <div className="pb-sess-actions">
          <div className="pb-btn-group">
            <button className="pb-btn sm primary" onClick={() => publish(hasBoth ? "both" : hasPw ? "pw" : "lh")}
              disabled={(!hasPw && !hasLh) || !!busy || runActive}
              title={runActive ? "Tunggu run yang sedang berjalan selesai." : undefined}>
              {busy ? "…" : hasBoth ? "Buat laporan (Gabungan)" : hasPw ? "Buat laporan (Playwright)" : "Buat laporan (Lighthouse)"}
            </button>
            {/* Scope tunggal hanya relevan kalau dua-duanya punya run final. */}
            {hasBoth && (
              <>
                <button className="pb-btn sm" onClick={() => publish("pw")} disabled={!!busy || runActive}
                  title={runActive ? "Tunggu run yang sedang berjalan selesai." : undefined}>
                  <ToolMark tool="pw" inline /> saja
                </button>
                <button className="pb-btn sm" onClick={() => publish("lh")} disabled={!!busy || runActive}
                  title={runActive ? "Tunggu run yang sedang berjalan selesai." : undefined}>
                  <ToolMark tool="lh" inline /> saja
                </button>
              </>
            )}
          </div>
          <button className="pb-btn sm" onClick={closeSession}
            disabled={!!busy || !!session.closed_at || active > 0}
            title={active > 0 ? "Tunggu run selesai dulu." : "Run baru akan memakai sesi baru."}>
            Tutup sesi
          </button>
          <button className="pb-btn sm danger" onClick={deleteSession} disabled={!!busy || active > 0}
            title={active > 0 ? "Batalkan run yang berjalan dulu." : "Hapus sesi dan seluruh isinya."}>
            {busy === "delete" ? "Menghapus…" : "Hapus sesi"}
          </button>
        </div>
      </div>

      {error && <div className="pb-err" role="alert">{error}</div>}
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
          <div className="pb-kpi-foot">dari {runs.length} run</div>
        </div>
        <div className="pb-kpi">
          <div className="pb-kpi-label">Gagal</div>
          <div className="pb-kpi-value bad">{failed}</div>
          <div className="pb-kpi-foot">dari {runs.length} run</div>
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
                  <ToolMark tool={r.tool} />
                  <div className="pb-runrow-main">
                    <div className="pb-runrow-title">{r.tool === "pw" ? "Playwright" : "Lighthouse"}</div>
                    <div className="pb-runrow-sub pb-row" style={{ gap: 6 }}>
                      <RunClock run={r} />
                      <span className="mono">{fmtDate(r.finalized_at ?? r.started_at ?? r.queued_at)} - exit {r.exit_code ?? "-"}</span>
                    </div>
                  </div>
                  <span className={`pb-badge ${r.status}`}>{runStatusLabel(r.status)}</span>
                  <div className="pb-runrow-act">
                    {!FINAL.includes(r.status) && (
                      <button className="pb-btn sm" onClick={() => cancelRun(r)} disabled={busy === r.id}>
                        {busy === r.id ? "…" : "Cancel"}
                      </button>
                    )}
                    <button className="pb-btn sm" onClick={() => openRunDetail(r)}>Lihat hasil run</button>
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
            <p className="pb-empty">
              {runActive
                ? "Run masih berjalan. Laporan bisa diterbitkan setelah semua run selesai."
                : "Belum ada laporan. Terbitkan dari tombol di atas."}
            </p>
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
                      <ToolMark tool={rep.scope} />
                      <div className="pb-repcard-main">
                        <div className="pb-repcard-title">{scopeLabel}</div>
                        <div className="pb-repcard-sub mono">{fmtDate(rep.built_at)}</div>
                      </div>
                      {runActive && <span className="pb-badge running">run berjalan</span>}
                      <span className={`pb-badge ${rep.status}`}>{rep.status}</span>
                    </div>
                    {runActive && (
                      <div className="pb-repcard-note">Run sedang berjalan. Laporan ini snapshot run sebelumnya.</div>
                    )}
                    {rep.status === "stale" && <div className="pb-repcard-note">ada run baru, build ulang</div>}
                    {missing.length > 0 && <div className="pb-repcard-note">run dihapus: {missing.length}</div>}
                    {rep.status === "ready" && rep.mode === "html" && (
                      <div className="pb-repcard-note">HTML cadangan (satu file)</div>
                    )}
                    {rep.status === "failed" && rep.error && (
                      <div className="pb-repcard-note">gagal: {rep.error}</div>
                    )}
                    <div className="pb-repcard-act">
                      {canOpen
                        ? <ArtifactLink className="pb-btn sm primary" href={reportUrl(rep.id)}
                          missing="report hilang - perbarui laporan">Buka HTML</ArtifactLink>
                        : <span className="pb-muted" style={{ fontSize: 12 }}>{publishNote(rep)}</span>}
                      {rep.status === "ready" && (
                        <ArtifactLink href={reportUrl(rep.id, "report.md")}
                          missing="markdown tidak ada">Markdown</ArtifactLink>
                      )}
                      {/* Teks polos siap salin; isi sama dengan tabel HTML. */}
                      {canOpen && <CopyRingkas reportId={rep.id} runIds={ids} />}
                      <button className="pb-btn sm"
                        onClick={() => publish(rep.scope, rep.status === "ready" || rep.status === "stale" ? "Perbarui" : "Terbitkan")}
                        disabled={busy === rep.scope || !canPublish(rep) || runActive}
                        title={runActive ? "Tunggu run yang sedang berjalan selesai." : undefined}>
                        {busy === rep.scope ? "…" : rep.status === "ready" ? "Perbarui laporan" : rep.status === "stale" ? "Perbarui laporan" : "Terbitkan"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {openRun && <RunPanel run={openRun} retention={retention} onClose={closeRunPanel} />}
    </>
  );
}

function RunPanel({ run, retention, onClose }: { run: Run; retention: number; onClose: () => void }) {
  const results = run.results ?? [];
  const isPw = run.tool === "pw";
  const { html, json: report } = pickReportArtifacts(run);

  return (
    <section className="pb-card pb-runpanel" id="hasil-run" tabIndex={-1}>
      <div className="pb-runpanel-head">
        <ToolMark tool={run.tool} />
        <h2>Hasil run - {isPw ? "Playwright" : "Lighthouse"}</h2>
        <span className={`pb-badge ${run.status}`}>{runStatusLabel(run.status)}</span>
        <span className="pb-spacer" />
        <RunClock run={run} />
        <button className="pb-btn sm" onClick={onClose}>Tutup</button>
      </div>

      {results.length === 0 ? (
        // Failed/timed-out runs leave no result rows; explain instead of empty table.
        <p className="pb-empty">
          Tidak ada hasil {isPw ? "Playwright" : "Lighthouse"} pada run ini.
          {run.error ? ` Error: ${run.error}` : ""}
        </p>
      ) : isPw ? (
        <div className="pb-table-wrap"><table className="pb-table">
          <thead><tr><th>TC</th><th>Judul</th><th>Status</th><th>Durasi</th><th>Retry</th><th>Error</th></tr></thead>
          <tbody>
            {(results as PlaywrightResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.tc_id ?? "-"}</td>
                <td>{r.title}</td>
                <td><span className={`pb-badge ${r.status}`}>{runStatusLabel(r.status)}</span></td>
                <td className="mono">{fmtDur(r.duration_ms)}</td>
                <td className="mono">{r.retry}</td>
                <td className="mono" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{r.error ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <div className="pb-table-wrap"><table className="pb-table">
          <thead><tr><th>URL</th><th>Mode</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP</th><th>Skor tidak memenuhi</th><th /></tr></thead>
          <tbody>
            {(results as LighthouseResult[]).map(r => (
              <tr key={r.id}>
                <td className="mono">{r.url}</td>
                <td>{r.form_factor === "desktop" ? "Desktop" : "Mobile"}</td>
                <td>{pct(r.performance)}</td>
                <td>{pct(r.accessibility)}</td>
                <td>{pct(r.best_practices)}</td>
                <td>{pct(r.seo)}</td>
                <td className="mono">{r.lcp_ms ? `${Math.round(r.lcp_ms)}ms` : "-"}</td>
                <td className="mono">{r.budget_failed ?? "-"}</td>
                <td style={{ textAlign: "right" }}>
                  {r.report_path
                    ? <ArtifactLink probeHref={artifactUrl(run.id, r.report_path)} href={lhViewerHref(run, r.id)}>Report</ArtifactLink>
                    : <span className="pb-muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <RunTerminal runId={run.id} />

      {html && (
        <p style={{ marginTop: 14 }}>
          {isPw
            ? <NativeReportLink runId={run.id} path={html.path} label="Report asli Playwright" />
            : <Link className="pb-btn sm" href={lhViewerHref(run, (results as LighthouseResult[]).find(r => r.report_path)?.id)}>
                Report asli Lighthouse
              </Link>}
          {report?.path && <ArtifactLink href={artifactUrl(run.id, report.path)}>JSON mentah</ArtifactLink>}
        </p>
      )}
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

// Report asli berat (2 MB + script sendiri); iframe bikin scroll bertingkat,
// jadi buka di tab baru atau unduh.
function NativeReportLink({ runId, path, label }: { runId: string; path: string; label: string }) {
  const state = useProbe(artifactUrl(runId, path));
  if (state === "checking") return <span className="pb-muted" style={{ fontSize: 12 }}>cek report…</span>;
  if (state === "auth") return <LoginAgain />;
  if (state !== "ok") return <span className="pb-muted" style={{ fontSize: 12 }}>report asli hilang - dibuang retensi</span>;
  return (
    <>
      <a className="pb-btn sm" href={artifactUrl(runId, path)} target="_blank" rel="noreferrer">{label}</a>{" "}
      {/* download attribute hanya berlaku same-origin, dan /artifacts memang same-origin. */}
      <a className="pb-btn sm" href={artifactUrl(runId, path)} download>Unduh</a>
    </>
  );
}

// Salin ringkas.txt (teks polos untuk tiket/dokumen) tanpa membuka tab baru.
function CopyRingkas({ reportId, runIds }: { reportId: string; runIds: string[] }) {
  const [label, setLabel] = useState("Salin markdown");
  const copy = async () => {
    if (!(await confirmAction({
      icon: "question",
      title: "Salin markdown laporan?",
      confirmButtonText: "Ya, Salin",
    }))) return;
    try {
      // ringkas.txt ada per run; gabungkan semua run di report ini.
      const parts = await Promise.all(runIds.map(async id => {
        const res = await fetch(reportUrl(reportId, id + "/ringkas.txt"), { credentials: "include" });
        return res.ok ? await res.text() : "";
      }));
      await navigator.clipboard.writeText(parts.filter(Boolean).join("\n\n"));
      setLabel("Tersalin");
      showSuccessToast("Markdown disalin.");
      setTimeout(() => setLabel("Salin markdown"), 2000);
    } catch {
      setLabel("Gagal salin");
    }
  };
  return <button className="pb-btn sm" onClick={copy}>{label}</button>;
}
