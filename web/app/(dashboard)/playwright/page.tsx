"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, artifactUrl, fmtDate, fmtDur, type Project, type RunRow, type Session, type TestFile } from "../../../lib/playbook";

export default function PlaywrightPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState("");
  // Env UI disembunyikan untuk demo: target selalu base_url (web online) dengan env
  // production. Konfirmasi nama project diisi otomatis, guard backend tetap jalan.
  // ponytail: kalau perlu pilih env lagi, kembalikan select + confirm input.
  const env = "production";
  const [fileId, setFileId] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.projects().then(p => {
      setProjects(p);
      if (p[0]) setProjectId(p[0].id);
    }).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.testFiles({ project: projectId, tool: "pw" })
      .then(f => { setFiles(f); setFileId(f[0]?.id ?? ""); })
      .catch(e => setError(e.message));
    api.runs({ project: projectId, tool: "pw", limit: 10 })
      .then(setRuns).catch(e => setError(e.message));
  }, [projectId]);

  const selected = useMemo(() => files.find(f => f.id === fileId), [files, fileId]);
  const project = projects.find(p => p.id === projectId);
  const target = project?.base_url ?? "";

  // Draft editor; disinkronkan saat spec berganti, bukan saat mengetik.
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(selected?.code ?? ""); }, [selected]);

  // PRD §10.3: editor memperingatkan URL hardcoded (bikin spec tidak bisa pindah env).
  const hardcoded = (draft.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter(u => !u.includes("process.env"));
  const dirty = !!selected && draft !== selected.code;

  const save = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const updated = await api.patchTestFile(selected.id, { code: draft });
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const start = async () => {
    setBusy(true); setError("");
    try {
      if (!target) throw new Error("Project ini belum punya URL.");
      if (!fileId) throw new Error("Pilih spec dulu.");
      if (dirty) throw new Error("Ada perubahan belum disimpan. Klik Simpan dulu.");
      let s = session;
      if (!s || s.project_id !== projectId || s.env !== env) {
        // Konfirmasi production diisi otomatis: UI tidak menampilkan env/konfirmasi.
        const created = await api.createSession(projectId, env, project?.name);
        s = created.session;
        setSession(s);
      }
      await api.createRun(s.id, fileId);
      location.href = `/reports/${s.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pb-head">
        <div>
          <div className="eyebrow">Playwright</div>
          <h1>Jalankan test suite.</h1>
          <p className="pb-lead">Pilih project dan file test. Run masuk antrean lalu dipantau di sini.</p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}

      <div className="pb-grid two">
        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Jalankan spec</h2>
          <div className="pb-grid" style={{ gap: 12 }}>
            <label className="pb-field">
              Project
              <select className="pb-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="pb-field">
              Spec
              <select className="pb-select" value={fileId} onChange={e => setFileId(e.target.value)}>
                {files.length === 0 && <option value="">(tidak ada spec)</option>}
                {files.map(f => <option key={f.id} value={f.id}>{f.label} — {f.path}</option>)}
              </select>
            </label>
            <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
              Target: <span className="pb-mono">{target || "belum diisi di project"}</span>
            </p>
            <div className="pb-row">
              <button className="pb-btn primary" onClick={start} disabled={busy || !fileId || !target || dirty}>
                {busy ? "Menjalankan…" : "Run"}
              </button>
              {session && <Link className="pb-btn sm" href={`/reports/${session.id}`}>Sesi aktif</Link>}
            </div>
            <p className="pb-muted" style={{ fontSize: 12, margin: 0 }}>
              Satu run = satu spec. Sesi dipakai ulang bila masih terbuka untuk project yang sama.
            </p>
          </div>
        </section>

        <section className="pb-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Isi spec</h2>
          {selected ? (
            <>
              <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <span className="pb-muted pb-mono" style={{ fontSize: 12 }}>{selected.path}</span>
                <span className="pb-row" style={{ gap: 8 }}>
                  {dirty && <span className="pb-muted" style={{ fontSize: 12 }}>belum disimpan</span>}
                  <button className="pb-btn sm primary" onClick={save} disabled={busy || !dirty}>Simpan</button>
                  <button className="pb-btn sm" onClick={() => setDraft(selected.code)} disabled={busy || !dirty}>Reset</button>
                </span>
              </div>
              {hardcoded.length > 0 && (
                <div className="pb-err" style={{ marginBottom: 8 }}>
                  URL hardcoded terdeteksi ({hardcoded.length}): spec tidak akan mengikuti env.
                  Pakai <code className="pb-mono">process.env.BASE_URL</code>. Contoh: <span className="pb-mono">{hardcoded[0]}</span>
                </div>
              )}
              <textarea className="pb-input pb-mono" style={{ minHeight: 380, lineHeight: 1.5, resize: "vertical" }}
                value={draft} spellCheck={false} onChange={e => setDraft(e.target.value)} />
            </>
          ) : <p className="pb-empty">Pilih project yang punya spec Playwright.</p>}
        </section>
      </div>

      <section className="pb-card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Report mentah terakhir</h2>
        {runs.length === 0 ? (
          <p className="pb-empty">Belum ada run Playwright untuk project ini.</p>
        ) : (
          <table className="pb-table">
            <thead><tr><th>Sesi</th><th>Env</th><th>Status</th><th>Waktu</th><th>Durasi</th><th /></tr></thead>
            <tbody>
              {runs.map(r => {
                const done = r.status === "passed" || r.status === "failed";
                return (
                  <tr key={r.id}>
                    <td>{r.session_label}</td>
                    <td className="pb-muted">{r.env}</td>
                    <td><span className={`pb-badge ${r.status}`}>{r.status}</span></td>
                    <td className="mono">{fmtDate(r.finished_at ?? r.queued_at)}</td>
                    <td className="mono">{fmtDur(r.duration_ms)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="pb-row" style={{ justifyContent: "flex-end" }}>
                        {!done ? <span className="pb-muted" style={{ fontSize: 12 }}>belum final</span>
                          : r.has_html
                            ? <>
                                <a className="pb-btn sm" href={artifactUrl(r.id, "playwright-report/index.html")}
                                  target="_blank" rel="noreferrer">HTML</a>
                                <a className="pb-btn sm" href={artifactUrl(r.id, "report.json")}
                                  target="_blank" rel="noreferrer">JSON</a>
                              </>
                            : <span className="pb-muted" style={{ fontSize: 12 }}>report hilang</span>}
                        <Link className="pb-btn sm" href={`/reports/${r.session_id}`}>Sesi</Link>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="pb-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Link HTML membuka report asli Playwright di tab baru (butuh login dashboard).
        </p>
      </section>
    </>
  );
}
