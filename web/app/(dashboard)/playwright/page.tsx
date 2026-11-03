"use client";

import Link from "next/link";
import { ArtifactLink } from "../../_components/report-link";
import { CodeEditor } from "../code-editor";
import { RunPanel } from "../run-panel";
import { useEffect, useRef, useState } from "react";
import {
  api, artifactUrl, fmtDur,
  type LogEntry, type PlaywrightResult, type Project, type Run, type TestFile,
} from "../../../lib/playbook";

const FINAL = ["passed", "failed", "cancelled", "interrupted"];


export default function PlaywrightPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [projectId, setProjectId] = useState("");
  // Env UI disembunyikan untuk demo: target selalu base_url (web online) dengan env
  // production. Konfirmasi nama project diisi otomatis, guard backend tetap jalan.
  // ponytail: kalau perlu pilih env lagi, kembalikan select + confirm input.
  const env = "production";

  // Editor
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Konflik = file di disk berubah sejak sinkron terakhir; butuh keputusan user.
  const [conflict, setConflict] = useState(false);

  // Run + terminal
  // runId di-sessionStorage: pindah ke Overview unmount page, state reset.
  // Restore di sini biar polling + log lanjut saat balik, run backend tak hilang.
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(
    () => (typeof window !== "undefined" ? sessionStorage.getItem("pw-runId") : null),
  );
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (runId) sessionStorage.setItem("pw-runId", runId);
    else sessionStorage.removeItem("pw-runId");
  }, [runId]);

  // ID dari sessionStorage bisa basi (run dihapus/cancel dari halaman lain).
  // Validasi sekali: kalau 404, buang ID, biar terminal tidak polling hantu.
  const restored = useRef(false);
  useEffect(() => {
    if (!runId || restored.current) return;
    restored.current = true;
    api.run(runId).then(() => {}).catch(() => { setRunId(null); setLogs([]); });
  }, [runId]);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      if (p[0]) setProjectId(p[0].id);
    }).catch(e => setError(e.message));
  }, []);

  // Spec otomatis: project hanya punya satu spec Playwright. Dropdown Spec dihapus
  // (belum ada API bikin file baru).
  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "pw" })
      .then(f => { setFiles(f); setDraft(f[0]?.code ?? ""); })
      .catch(e => setError(e.message));
  }, [projectId]);

  const selected = files[0] ?? null;
  const project = projects.find(p => p.id === projectId);
  const target = project?.base_url ?? "";
  const dirty = !!selected && draft !== selected.code;
  const running = !!run && !FINAL.includes(run.status);

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

  const save = async (force = false) => {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const updated = await api.patchTestFile(selected.id, { code: draft, ...(force ? { force: true } : {}) });
      setFiles([updated]);
      // Backend men-trim teks. Tanpa sinkron balik, `dirty` tetap true dan Run
      // terkunci walau sudah disimpan.
      setDraft(updated.code);
      setConflict(false);
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 409) setConflict(true);
      else setError(err.message);
    } finally { setSaving(false); }
  };

  // Arah sebaliknya: ambil versi disk (mis. habis pull dari git).
  const reload = async () => {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const updated = await api.reloadTestFile(selected.id);
      setFiles([updated]);
      setDraft(updated.code);
      setConflict(false);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const start = async () => {
    setStarting(true); setError("");
    setRunId(null); setRun(null); setLogs([]);
    try {
      if (!target) throw new Error("Project ini belum punya URL.");
      if (!selected) throw new Error("Project ini belum punya spec Playwright.");
      if (dirty) throw new Error("Ada perubahan belum disimpan. Klik Simpan dulu.");
      // Konfirmasi production diisi otomatis: UI tidak menampilkan env/konfirmasi.
      const created = await api.createSession(projectId, env, project?.name);
      const { runId } = await api.createRun(created.session.id, selected.id);
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
          <p className="pb-lead">Pilih project, cek spec-nya, lalu jalankan. Log muncul langsung di bawah.</p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", gap: 16 }}>
          <label className="pb-field" style={{ minWidth: 240 }}>
            Project
            <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
            Target: <span className="pb-mono">{target || "belum diisi di project"}</span>
          </p>
        </div>
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15 }}>Spec</h2>
            <div className="pb-card-sub pb-mono">{selected?.path ?? "belum ada spec"}</div>
          </div>
          <span className="pb-row" style={{ gap: 8 }}>
            {dirty && <span className="pb-muted" style={{ fontSize: 12 }}>belum disimpan</span>}
            <button className="pb-btn sm primary" onClick={() => save()} disabled={saving || !dirty || running}>
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
            <button className="pb-btn sm" onClick={() => setDraft(selected?.code ?? "")}
              disabled={saving || !dirty || running}>Reset</button>
            <button className="pb-btn sm pb-icon-btn" onClick={reload} disabled={saving || running}
              title="Muat ulang dari disk" aria-label="Muat ulang dari disk">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.65-3.94" />
                <path d="M13.5 1.8V4.6h-2.8" />
              </svg>
            </button>
          </span>
        </div>
        {conflict && (
          <div className="pb-err" style={{ marginBottom: 8, display: "grid", gap: 8 }}>
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
      <div className="pb-row" style={{ marginTop: 12 }}>
        <button className="pb-btn primary" onClick={start}
          disabled={starting || running || !selected || !target || dirty}>
          {starting ? "Mengantre…" : running ? "Berjalan…" : "Run"}
        </button>
        {running && <button className="pb-btn" onClick={stop}>Stop</button>}
      </div>

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
