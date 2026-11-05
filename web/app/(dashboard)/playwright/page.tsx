"use client";

import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import { CodeEditor } from "../code-editor";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, fmtDur, fmtTime, groupProjects, readLastProject, rememberProject,
  type LogEntry, type PlaywrightResult, type Project, type Run, type Session, type TestFile,
} from "../../../lib/playbook";
import { confirmAction, showInfoToast, showSuccessToast } from "../../../lib/alerts";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];

type Env = "local" | "staging" | "production";
const ENVS: Env[] = ["local", "staging", "production"];

// Target ikut env. Kosong = project belum mengisi URL untuk env itu.
const resolvedUrl = (p: Project | undefined, e: Env) =>
  !p ? "" : e === "local" ? p.local_url ?? "" : e === "staging" ? p.staging_url ?? "" : p.base_url;


export default function PlaywrightPage() {
  // Pilih spec: project bisa punya beberapa file Playwright; run memakai yang aktif.
  const [fileId, setFileId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [projectId, setProjectId] = useState("");
  // Default local: kasus utama menguji web di laptop sendiri.
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
  // Konflik: file di disk berubah sejak sinkron terakhir; butuh keputusan user.
  const [conflict, setConflict] = useState(false);

  // Run + terminal. runId disimpan per project di sessionStorage: ganti
  // dropdown tidak menumpuk log project lain, dan run tetap terpantau saat pindah halaman.
  const [starting, setStarting] = useState(false);
  // Sesi milik run terakhir + batas reuse dari DB (bukan hardcode).
  const [session, setSession] = useState<Session | null>(null);
  const [reuseMinutes, setReuseMinutes] = useState<number | null>(null);
  // Run yang sedang dipantau ditulis langsung di start(): kalau lewat efek,
  // runId project lama sempat tertulis ke project baru saat dropdown diganti.
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Ganti project → pasang lagi run project itu (kalau ada), terminal direset.
  useEffect(() => {
    if (!projectId) return;
    setRun(null); setLogs([]);
    setRunId(sessionStorage.getItem(`pw-run:${projectId}`));
    // sengaja tanpa dependency lain: menyimpan runId baru tidak boleh mereset terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ID tersimpan bisa basi (run dihapus/cancel dari halaman lain); validasi sekali per id.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || restored.current === runId) return;
    restored.current = runId;
    api.run(runId).catch(() => {
      sessionStorage.removeItem(`pw-run:${projectId}`);
      setRunId(null); setLogs([]);
    });
  }, [runId, projectId]);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      // Pakai project terakhir kalau masih aktif; kalau tidak, project pertama.
      const last = readLastProject();
      if (p.some(x => x.id === last)) setProjectId(last);
      else if (p[0]) setProjectId(p[0].id);
    }).catch(e => setError(e.message));
  }, []);

  // Nilai reuse dari tabel settings; viewer tidak perlu melihat saran sesi.
  useEffect(() => {
    api.settings().then(x => setReuseMinutes(Number(x.session_reuse_minutes) || null))
      .catch(() => {});
  }, []);

  // Semua spec Playwright project; file pertama jadi pilihan awal.
  useEffect(() => {
    if (!projectId) return;
    setFiles([]); setFileId(""); setDraft(""); setSavedCode("");
    setSavedAt(null); setConflict(false);
    api.testFiles({ project: projectId, tool: "pw" })
      .then(f => {
        setFiles(f);
        const first = f[0] ?? null;
        setFileId(first?.id ?? "");
        setDraft(first?.code ?? "");
        setSavedCode(first?.code ?? "");
      })
      .catch(e => setError(e.message));
  }, [projectId]);

  const selected = files.find(f => f.id === fileId) ?? files[0] ?? null;
  const project = projects.find(p => p.id === projectId);
  const target = resolvedUrl(project, env);
  // Server juga menolak production kalau project belum mengizinkannya; tombol
  // jangan aktif dulu supaya user tidak menunggu error yang bisa dicegah.
  const productionOk = env !== "production"
    || (confirmName.trim() === (project?.name ?? "") && !!project?.allow_production);
  const dirty = !!selected && draft !== savedCode;
  const running = !!run && !FINAL.includes(run.status);
  // Umur sesi dari run terakhir, sama dengan server: satu sesi kerja, bukan satu hari.
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

  // Nilai terbaru untuk mendeteksi user mengetik selama request berjalan.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const save = async (force = false): Promise<boolean> => {
    if (!selected) return false;
    const snapshot = draftRef.current;
    setSaving(true); setError("");
    try {
      const updated = await api.patchTestFile(selected.id, { code: snapshot, ...(force ? { force: true } : {}) });
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      // Backend men-trim teks. Sync balik hanya kalau user belum mengetik lagi.
      if (draftRef.current === snapshot) setDraft(updated.code);
      setSavedCode(updated.code);
      setSavedAt(new Date().toISOString());
      setConflict(false);
      return true;
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 409) setConflict(true);
      else setError(err.message);
      return false;
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

  // Pindah spec: simpan dulu perubahan spec lama supaya tidak hilang.
  const pickFile = async (id: string) => {
    const next = files.find(f => f.id === id);
    if (!next || next.id === selected?.id) return;
    if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    if (dirty && !(await save())) return;
    setFileId(next.id);
    setDraft(next.code);
    setSavedCode(next.code);
    setSavedAt(null);
    setConflict(false);
    showInfoToast(`Spec ${next.label} dipakai.`);
  };

  // Arah sebaliknya: ambil versi disk (mis. habis pull dari git).
  const reload = async () => {
    if (!selected) return;
    if (!(await confirmAction({
      icon: "warning",
      title: "Muat ulang dari disk?",
      text: "Perubahan yang belum disimpan akan hilang.",
      confirmButtonText: "Ya, Muat Ulang",
    }))) return;
    setSaving(true); setError("");
    try {
      const updated = await api.reloadTestFile(selected.id);
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      setDraft(updated.code);
      setSavedCode(updated.code);
      setSavedAt(new Date().toISOString());
      setConflict(false);
      showSuccessToast("Spec dimuat ulang dari disk.");
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
      // Run harus memakai kode tersimpan; kalau simpan gagal, jangan lanjut diam-diam.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      if (dirty) {
        const saved = await save();
        if (!saved) throw new Error("Kode belum tersimpan. Selesaikan error simpan sebelum run.");
      }
      // Konfirmasi production diketik user; guard yang sama ada di server.
      const created = await api.createSession(
        projectId, env, env === "production" ? confirmName : undefined, fresh,
      );
      const { runId } = await api.createRun(created.session.id, selected.id);
      sessionStorage.setItem(`pw-run:${projectId}`, runId);
      setRunId(runId);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!runId) return false;
    try { setRun(await api.cancelRun(runId)); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };

  const runWithConfirm = async (fresh = false) => {
    if (!(await confirmAction({
      icon: "question",
      title: fresh ? "Mulai sesi baru?" : "Jalankan test suite?",
      text: fresh
        ? "Sesi terbuka yang idle akan ditutup lalu run baru dimulai."
        : `Spec ${selected?.label ?? "terpilih"} di env ${env}.`,
      confirmButtonText: fresh ? "Ya, Sesi Baru" : "Ya, Jalankan",
    }))) return;
    if (await start(fresh)) showSuccessToast(fresh ? "Sesi baru dimulai." : "Run dimulai.");
  };

  const stopWithConfirm = async () => {
    if (!(await confirmAction({
      icon: "warning",
      title: "Hentikan run?",
      text: "Run yang berjalan akan dibatalkan.",
      confirmButtonText: "Ya, Stop",
    }))) return;
    if (await stop()) showSuccessToast("Run dihentikan.");
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
          <button className="pb-btn primary" onClick={() => runWithConfirm()}
            disabled={starting || running || !selected || !target || !productionOk}>
            {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
          </button>
          <button className="pb-btn" onClick={() => runWithConfirm(true)}
            disabled={starting || running || !selected || !target || !productionOk}
            title="Tutup sesi terbuka yang idle lalu mulai sesi baru">
            Sesi baru
          </button>
          {running && <button className="pb-btn" onClick={stopWithConfirm}>Stop</button>}
        </div>
      </div>
      {error && <div className="pb-err" role="alert">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", gap: 16 }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId}
              onChange={e => {
                const id = e.target.value;
                setProjectId(id); rememberProject(id); setConfirmName("");
              }}>
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
        <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Spec</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada spec"}</div>
          </div>
          <div className="pb-row" style={{ gap: 12 }}>
            {files.length > 0 && (
              <label className="pb-field" style={{ minWidth: 260 }}>
                File spec
                <select className="pb-select" value={selected?.id ?? ""}
                  onChange={e => pickFile(e.target.value)} disabled={saving}>
                  {files.map(f => (
                    <option key={f.id} value={f.id}>{f.label} · {f.path}</option>
                  ))}
                </select>
              </label>
            )}
            <Link className="pb-link-muted" href="/settings">Kelola spec di Pengaturan</Link>
          </div>
        </div>
        {conflict && (
          <div className="pb-err" role="alert" style={{ marginBottom: 8, display: "grid", gap: 8 }}>
            <span>File spec di disk sudah berubah sejak sinkron terakhir (kemungkinan ada perubahan di git).</span>
            <span className="pb-row" style={{ gap: 8 }}>
              <button className="pb-btn sm danger" disabled={saving}
                onClick={async () => {
                  if (await confirmAction({
                    icon: "warning",
                    title: "Timpa file di disk?",
                    text: "Perubahan di luar dashboard akan hilang.",
                    confirmButtonText: "Ya, Timpa",
                  })) {
                    if (await save(true)) showSuccessToast("File di disk ditimpa.");
                  }
                }}>
                Timpa file di disk
              </button>
              <button className="pb-btn sm" onClick={reload} disabled={saving}>Muat ulang dari disk</button>
            </span>
          </div>
        )}
        {selected ? (
          <CodeEditor value={draft} onChange={setDraft} disabled={running} />
        ) : (
          <p className="pb-empty">
            Project ini belum punya spec Playwright. <Link href="/settings">Tambah spec di Pengaturan</Link>.
          </p>
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
