"use client";

import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import { CodeEditor } from "../code-editor";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, fmtDur, fmtTime, groupProjects,
  type LogEntry, type PlaywrightResult, type Project, type Run, type Session, type TestFile,
} from "../../../lib/playbook";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

type Env = "local" | "staging" | "production";
const ENVS: Env[] = ["local", "staging", "production"];

// Target ikut env. Kosong = project belum mengisi URL untuk env itu.
const resolvedUrl = (p: Project | undefined, e: Env) =>
  !p ? "" : e === "local" ? p.local_url ?? "" : e === "staging" ? p.staging_url ?? "" : p.base_url;


export default function PlaywrightPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [projectId, setProjectId] = useState("");
  // Default local: kasus utama menguji web yang jalan di laptop sendiri.
  // Konfirmasi production: ketik nama project. Guard sama ada di server.
  const [confirmName, setConfirmName] = useState("");
  const [env, setEnv] = useState<Env>("local");

  // Editor
  const [draft, setDraft] = useState("");
  // Baseline autosave: Run memakai kode tersimpan, bukan yang sedang diketik.
  const [savedCode, setSavedCode] = useState("");
  const [saving, setSaving] = useState(false);
  // Jam simpan terakhir: badge "Tersimpan" tanpa waktu tidak menjawab apa pun.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Konflik = file di disk berubah sejak sinkron terakhir; butuh keputusan user.
  const [conflict, setConflict] = useState(false);

  // Run + terminal
  // runId di-sessionStorage per project: ganti dropdown tidak menumpuk log
  // project lain, dan run tetap terpantau saat pindah halaman.
  // Terminal dipisah per project: satu kunci sessionStorage per project, jadi
  // ganti dropdown tidak menumpuk log project lain.
  const [starting, setStarting] = useState(false);
  // Sesi milik run terakhir + batas reuse dari DB (bukan hardcode).
  const [session, setSession] = useState<Session | null>(null);
  const [reuseMinutes, setReuseMinutes] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Run yang sedang dipantau, per project. Ditulis di start(): kalau lewat efek,
  // runId project lama sempat tertulis ke project baru saat dropdown diganti.
  const [runsByProject, setRunsByProject] = useState<Record<string, string>>({});

  // Ganti project → pasang lagi run project itu (kalau ada), terminal direset.
  useEffect(() => {
    if (!projectId) return;
    setRun(null); setLogs([]);
    setRunId(runsByProject[projectId] ?? sessionStorage.getItem(`pw-run:${projectId}`));
    // runsByProject sengaja tidak jadi dependency: membacanya di sini tidak boleh
    // memicu reset terminal setiap kali runId baru disimpan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ID tersimpan bisa basi (run dihapus/cancel dari halaman lain).
  // Validasi sekali per id: kalau 404, buang ID, biar terminal tidak polling hantu.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || restored.current === runId) return;
    restored.current = runId;
    api.run(runId).then(() => {}).catch(() => {
      sessionStorage.removeItem(`pw-run:${projectId}`);
      setRunId(null); setLogs([]);
    });
  }, [runId, projectId]);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      if (p[0]) setProjectId(p[0].id);
    }).catch(e => setError(e.message));
  }, []);

  // Nilai reuse dari tabel settings; endpoint admin-only, viewer cukup tidak
  // melihat saran sesi.
  useEffect(() => {
    api.settings().then(x => setReuseMinutes(Number(x.session_reuse_minutes) || null))
      .catch(() => {});
  }, []);

  // Spec otomatis: project hanya punya satu spec Playwright. Dropdown Spec dihapus
  // (belum ada API bikin file baru).
  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "pw" })
      .then(f => { setFiles(f); setDraft(f[0]?.code ?? ""); setSavedCode(f[0]?.code ?? ""); })
      .catch(e => setError(e.message));
  }, [projectId]);

  const selected = files[0] ?? null;
  const project = projects.find(p => p.id === projectId);
  const target = resolvedUrl(project, env);
  // Server juga menolak production kalau project belum mengizinkannya; tombol
// jangan aktif dulu supaya user tidak menunggu error yang bisa dicegah.
const productionOk = env !== "production"
  || (confirmName.trim() === (project?.name ?? "") && !!project?.allow_production);
  const dirty = !!selected && draft !== savedCode;
  const running = !!run && !FINAL.includes(run.status);
  // Umur sesi dihitung dari run terakhir, sama dengan aturan di server: satu sesi
  // = satu sesi kerja, bukan satu hari. Tanpa run, pakai waktu dibuat.
  const sessionAnchor = session?.last_run_at ?? session?.created_at;
  const sessionAge = sessionAnchor
    ? Math.max(0, Math.round((Date.now() - Date.parse(sessionAnchor)) / 60000))
    : 0;
  // Saran hanya muncul kalau batas reuse sudah diketahui dari DB.
  const stale = !!session && !session.closed_at && reuseMinutes !== null && sessionAge > reuseMinutes;

  // Poll run + log selama belum final. 1.5s cukup; run Playwright hitungan menit.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let after = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const [r, l] = await Promise.all([api.run(runId), api.runLogs(runId, after)]);
        if (!alive) return;
        setRun(r);
        if (l.logs.length) {
          after = l.nextAfter;
          setLogs(prev => [...prev, ...l.logs]);
        }
        // hasMore = backend memotong di 5000 baris; lanjut baca segera.
        if (l.hasMore) timer = setTimeout(tick, 0);
        else if (!FINAL.includes(r.status)) timer = setTimeout(tick, 1500);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [runId]);

  // Sesi milik run yang dipantau: umurnya menentukan saran sesi baru.
  useEffect(() => {
    const id = run?.session_id;
    if (!id) { setSession(null); return; }
    let alive = true;
    api.session(id).then(x => { if (alive) setSession(x); }).catch(() => {});
    return () => { alive = false; };
  }, [run?.session_id]);

  const save = async (force = false) => {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const updated = await api.patchTestFile(selected.id, { code: draft, ...(force ? { force: true } : {}) });
      setFiles([updated]);
      // Backend men-trim teks. Tanpa sinkron balik, `dirty` tetap true dan
      // autosave memicu simpan berulang.
      setDraft(updated.code);
      setSavedCode(updated.code);
      setSavedAt(new Date().toISOString());
      setConflict(false);
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 409) setConflict(true);
      else setError(err.message);
    } finally { setSaving(false); }
  };

  // Autosave: berhenti mengetik 1 dtk = tersimpan. Kelola konflik tetap manual.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selected || !dirty || conflict) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { save(); }, 1000);
    return () => { if (pending.current) clearTimeout(pending.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selected, savedCode, conflict]);

  const saveState = saving ? "Menyimpan…" : !selected ? ""
    : dirty ? "Belum disimpan"
    : savedAt ? `Tersimpan ${fmtTime(savedAt)}` : "Tersimpan";

  // Arah sebaliknya: ambil versi disk (mis. habis pull dari git).
  const reload = async () => {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const updated = await api.reloadTestFile(selected.id);
      setFiles([updated]);
      setDraft(updated.code);
      setSavedCode(updated.code);
      setSavedAt(new Date().toISOString());
      setConflict(false);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  // fresh=true memaksa sesi baru: server menutup sesi terbuka yang idle.
  const start = async (fresh = false) => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error(`Project ini belum punya URL untuk env ${env}`);
      if (env === "production" && confirmName.trim() !== project?.name)
        throw new Error(`Ketik nama project (${project?.name}) untuk konfirmasi production.`);
      if (!selected) throw new Error("Project ini belum punya spec Playwright.");
      // Flush autosave yang masih menunggu supaya run memakai kode terbaru.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; await save(); }
      // Konfirmasi production diketik user; guard yang sama ada di server.
      const created = await api.createSession(
        projectId, env, env === "production" ? confirmName : undefined, fresh,
      );
      const { runId } = await api.createRun(created.session.id, selected.id);
      sessionStorage.setItem(`pw-run:${projectId}`, runId);
      setRunsByProject(prev => ({ ...prev, [projectId]: runId }));
      setRunId(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!runId) return;
    try { setRun(await api.cancelRun(runId)); }
    catch (e) { setError((e as Error).message); }
  };

  const results = (run?.results ?? []) as PlaywrightResult[];
  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;
  const done = !!run && FINAL.includes(run.status);

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Jalankan test suite.</h1>
        </div>
        <div className="pb-filters">
          <span className={`pb-save-state${conflict ? " bad" : dirty ? " dirty" : ""}`} aria-live="polite">
            {conflict ? "Konflik disk" : saveState}
          </span>
          <button className="pb-btn primary" onClick={() => start()}
            disabled={starting || running || !selected || !target || !productionOk}>
            {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
          </button>
          <button className="pb-btn" onClick={() => start(true)}
            disabled={starting || running || !selected || !target || !productionOk}
            title="Tutup sesi terbuka yang idle lalu mulai sesi baru">
            Sesi baru
          </button>
          {running && <button className="pb-btn" onClick={stop}>Stop</button>}
        </div>
      </div>
      {error && <div className="pb-err" role="alert">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", gap: 16 }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId}
              onChange={e => { setProjectId(e.target.value); setConfirmName(""); }}>
              {groupProjects(projects).map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="pb-field">
            Environment
            <select className="pb-select" value={env}
              onChange={e => { setEnv(e.target.value as Env); setConfirmName(""); }}>
              {ENVS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Target {env}: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
          {env === "local" && (
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Env local dijalankan dari mesin server dashboard. Kalau dashboard dihosting,
            isi local_url dengan URL tunnel (cloudflared/ngrok) ke web lokal, bukan 127.0.0.1.
            Origin-nya wajib terdaftar di origins project atau TARGET_ALLOWLIST.
          </p>
          )}
          {session && (
            <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
              {session.closed_at ? "Sesi terakhir sudah ditutup" : "Sesi terbuka"}
              {" sejak "}<span className="pb-mono">{fmtTime(session.created_at)}</span>
              {session.closed_at ? "" : ` · idle ${sessionAge} menit`}
              {stale ? ` · lewat batas reuse ${reuseMinutes} menit, pakai Sesi baru` : ""}
            </p>
          )}
        </div>
        {env === "production" && (
          <label className="pb-field" style={{ marginTop: 12 }}>
            Ketik <strong>{project?.name ?? "nama project"}</strong> untuk konfirmasi production
            <input className="pb-input" value={confirmName} onChange={e => setConfirmName(e.target.value)} />
          </label>
        )}
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Spec</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada spec"}</div>
          </div>
        </div>
        {conflict && (
          <div className="pb-err" role="alert" style={{ marginBottom: 8, display: "grid", gap: 8 }}>
            <span>File spec di disk sudah berubah sejak sinkron terakhir (kemungkinan ada perubahan di git).</span>
            <span className="pb-row" style={{ gap: 8 }}>
              <button className="pb-btn sm danger" onClick={() => save(true)} disabled={saving}>Timpa file di disk</button>
              <button className="pb-btn sm" onClick={reload} disabled={saving}>Muat ulang dari disk</button>
            </span>
          </div>
        )}
        {selected ? (
          <CodeEditor value={draft} onChange={setDraft} disabled={running} />
        ) : (
          <p className="pb-empty">Project ini belum punya spec Playwright.</p>
        )}
      </section>

      <RunPanel
        logs={logs}
        run={run}
        live={running}
        downloadHref={runId ? `/api/runs/${runId}/logs/download` : null}
      />
      {done && run && (
        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Hasil run</h2>
              <div className="pb-card-sub">
                {passed} lulus · {failed} gagal · {results.length} test case
              </div>
            </div>
            <span className={`pb-badge ${run.status}`}>{run.status}</span>
          </div>
          <div className="pb-row">
            {run.artifacts?.some(a => a.path === "playwright-report/index.html") ? (
              <ArtifactLink href={artifactUrl(run.id, "playwright-report/index.html")}>Buka report (tab baru)</ArtifactLink>
            ) : <span className="pb-muted" style={{ fontSize: 12 }}>report HTML tidak ada</span>}
            {run.artifacts?.some(a => a.path === "report.json") && (
              <ArtifactLink href={artifactUrl(run.id, "report.json")} missing="JSON hilang">JSON</ArtifactLink>
            )}
            <Link className="pb-btn sm" href={`/reports/${run.session_id}`}>Detail sesi</Link>
          </div>
          {failed > 0 && (
            <div className="pb-fail-list" style={{ marginTop: 12 }}>
              {results.filter(r => r.status === "failed").map(r => (
                <div className="pb-fail-item" key={r.id}>
                  <span className="pb-fail-dot" />
                  <span>
                    <span className="pb-fail-title">{r.title}</span>
                    <span className="pb-fail-meta">{r.file} · {fmtDur(r.duration_ms)}</span>
                    <span className="pb-fail-msg">{r.error ?? "tanpa pesan error"}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
