"use client";

import Link from "next/link";
import { CodeEditor } from "../code-editor";
import { RunPanel } from "../run-panel";
import { ScreenPanel } from "../screen-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, fmtDur, fmtTime, groupProjects, readLastEnv, readLastProject, rememberEnv, rememberProject,
  type LogEntry, type PlaywrightResult, type Project, type Run, type Session, type TestFile,
} from "../../../lib/playbook";
import { confirmAction, showErrorAlert, showInfoToast, showSuccessToast } from "../../../lib/alerts";

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
  const [env, setEnv] = useState<Env>("local");

  // Editor
  const [draft, setDraft] = useState("");
  // Baseline autosave: Run memakai kode tersimpan, bukan yang sedang diketik.
  const [savedCode, setSavedCode] = useState("");
  const [saving, setSaving] = useState(false);
  // Generate spec membuka Chromium di server; bisa lama, jadi statusnya terpisah.
  const [generating, setGenerating] = useState(false);
  // Jam simpan terakhir: badge "Tersimpan" tanpa waktu tidak menjawab apa pun.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Konflik: file di disk berubah sejak sinkron terakhir; butuh keputusan user.
  const [conflict, setConflict] = useState(false);

  // Run + terminal. runId disimpan per project di sessionStorage: ganti
  // dropdown tidak menumpuk log project lain, dan run tetap terpantau saat pindah halaman.
  const [starting, setStarting] = useState(false);
  // Opsi visual per run. Debug = slowMo + timeout panjang + pause/step.
  const [recordVideo, setRecordVideo] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
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
      // Environment ikut pilihan terakhir lintas halaman.
      const lastEnv = readLastEnv();
      if (lastEnv) setEnv(lastEnv as Env);
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
  const productionBlocked = env === "production" && !project?.allow_production;
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

  const openCreated = (created: TestFile) => {
    setFiles(prev => [created, ...prev]);
    setFileId(created.id);
    setDraft(created.code);
    setSavedCode(created.code);
    setSavedAt(null);
    showSuccessToast(`${created.label} dibuat.`);
  };

  // Project tanpa spec: buat scaffold dasar langsung dari halaman run.
  const addSpec = async () => {
    if (!project || saving) return;
    const path = `tests/${project.slug}.spec.ts`;
    if (!(await confirmAction({
      title: "Buat spec Playwright?",
      text: `${path} untuk ${project.name}.`,
      confirmButtonText: "Ya, Buat",
    }))) return;
    setSaving(true); setError("");
    try {
      const fallback = resolvedUrl(project, env) || project.base_url || "";
      const code = [
        'import { test, expect } from "@playwright/test";',
        "",
        'test("homepage terbuka", async ({ page }) => {',
        `  await page.goto(process.env.BASE_URL ?? ${JSON.stringify(fallback)});`,
        "  await expect(page).toHaveTitle(/./);",
        "});",
        "",
      ].join("\n");
      const created = await api.createTestFile({
        projectId, tool: "pw", path, label: `${project.name} Playwright`, code,
      });
      openCreated(created);
    } catch (e) { showErrorAlert("Gagal membuat spec", (e as Error).message); }
    finally { setSaving(false); }
  };

  // Generate template dari target env terpilih, lalu simpan sebagai spec project.
  const generateSpecFile = async () => {
    if (!project || !target || generating || saving) return;
    if (!(await confirmAction({
      title: "Generate spec Playwright?",
      text: `Crawl ${target} dari mesin server.`,
      confirmButtonText: "Ya, Generate",
    }))) return;
    setGenerating(true); setError("");
    try {
      const result = await api.generateSpec(target, projectId);
      const created = await api.createTestFile({
        projectId, tool: "pw", path: `tests/${project.slug}.spec.ts`,
        label: `${project.name} Playwright (generated)`, code: result.code,
      });
      openCreated(created);
    } catch (e) { showErrorAlert("Gagal generate spec", (e as Error).message); }
    finally { setGenerating(false); }
  };

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
      if (!selected) throw new Error("Project ini belum punya spec Playwright.");
      // Run harus memakai kode tersimpan; kalau simpan gagal, jangan lanjut diam-diam.
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      if (dirty) {
        const saved = await save();
        if (!saved) throw new Error("Kode belum tersimpan. Selesaikan error simpan sebelum run.");
      }
      // Konfirmasi production lewat dialog; server tetap wajib allow_production.
      const created = await api.createSession(
        projectId, env, undefined, fresh,
      );
      const { runId } = await api.createRun(created.session.id, selected.id, {
        recordVideo, debug: debugMode,
      });
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

  const scrollToTerminal = () => {
    const el = document.getElementById("run-terminal");
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const runNow = async (fresh = false) => {
    if (await start(fresh)) {
      showSuccessToast(fresh ? "Sesi baru dimulai." : "Run dimulai.");
      scrollToTerminal();
    }
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
      {error && <div className="pb-err" role="alert">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="pb-field" style={{ minWidth: 200 }}>
            Project
            <select className="pb-select" value={projectId}
              onChange={e => {
                const id = e.target.value;
                setProjectId(id); rememberProject(id);
              }}>
              {groupProjects(projects).map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="pb-field" style={{ minWidth: 240, flex: "1 1 260px" }}>
            File spec
            <select className="pb-select" value={selected?.id ?? ""}
              onChange={e => pickFile(e.target.value)} disabled={saving || files.length === 0}>
              {files.length === 0 && <option value="">belum ada spec</option>}
              {files.map(f => (
                <option key={f.id} value={f.id}>{f.label} - {f.path}</option>
              ))}
            </select>
          </label>
          <label className="pb-field" style={{ minWidth: 150 }}>
            Environment
            <select className="pb-select" value={env}
              onChange={e => { const v = e.target.value as Env; setEnv(v); rememberEnv(v); }}>
              {ENVS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="pb-row" style={{ gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Target {env}: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
          {session && (
            <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
              {session.closed_at ? "Sesi terakhir sudah ditutup" : "Sesi terbuka"}
              {" sejak "}<span className="pb-mono">{fmtTime(session.created_at)}</span>
              {session.closed_at ? "" : ` - idle ${sessionAge} menit`}
              {stale ? ` - lewat batas reuse ${reuseMinutes} menit, pakai Sesi baru` : ""}
            </p>
          )}
        </div>
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="pb-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>Spec</h2>
              <span className={`pb-save-state${conflict ? " bad" : dirty ? " dirty" : ""}`} aria-live="polite">
                {conflict ? "Konflik disk" : saveState}
              </span>
            </div>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada spec"}</div>
          </div>
          <div className="pb-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label className="pb-check" title="Simpan rekaman WebM tiap test (lebih besar di disk)">
              <input type="checkbox" checked={recordVideo} disabled={running || starting}
                onChange={e => setRecordVideo(e.target.checked)} />
              Rekam video
            </label>
            <label className="pb-check" title="Slow motion, timeout 30 menit, dan tombol jeda/step di panel layar">
              <input type="checkbox" checked={debugMode} disabled={running || starting}
                onChange={e => setDebugMode(e.target.checked)} />
              Debug
            </label>
            <button className="pb-btn primary" onClick={() => runNow()}
              disabled={starting || running || !selected || !target || productionBlocked}>
              {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
            </button>
            <button className="pb-btn" onClick={() => runNow(true)}
              disabled={starting || running || !selected || !target || productionBlocked}
              title="Tutup sesi terbuka yang idle lalu mulai sesi baru">
              Sesi baru
            </button>
            {running && <button className="pb-btn" onClick={stopWithConfirm}>Stop</button>}
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
          <div className="pb-empty">
            <p style={{ margin: 0 }}>Project ini belum punya spec Playwright.</p>
            <div className="pb-row" style={{ justifyContent: "center", gap: 8, marginTop: 10 }}>
              <button className="pb-btn sm" onClick={addSpec} disabled={!project || saving || generating}>
                {saving ? "Membuat…" : "Buat spec"}
              </button>
              <button className="pb-btn sm primary" onClick={generateSpecFile}
                disabled={!project || !target || saving || generating}
                title={target ? `Crawl ${target}` : "Project belum punya URL untuk env ini"}>
                {generating ? "Generate…" : "Generate spec"}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="pb-run-split" id="run-terminal">
        <RunPanel
          logs={logs}
          run={run}
          live={running}
          downloadHref={runId ? `/api/runs/${runId}/logs/download` : null}
        />
        <ScreenPanel runId={runId} run={run} live={running} />
      </div>
      {done && run && (
        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Hasil run</h2>
              <div className="pb-card-sub">
                {passed} lulus - {failed} gagal - {results.length} test case
              </div>
            </div>
            <span className={`pb-badge ${run.status}`}>{run.status}</span>
          </div>
          <div className="pb-row">
            <Link className="pb-btn sm" href={`/reports/${run.session_id}`}>Detail sesi</Link>
          </div>
          {failed > 0 && (
            <div className="pb-fail-list" style={{ marginTop: 12 }}>
              {results.filter(r => r.status === "failed").map(r => (
                <div className="pb-fail-item" key={r.id}>
                  <span className="pb-fail-dot" />
                  <span>
                    <span className="pb-fail-title">{r.title}</span>
                    <span className="pb-fail-meta">{r.file} - {fmtDur(r.duration_ms)}</span>
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
