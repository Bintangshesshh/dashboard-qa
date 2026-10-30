"use client";

// /settings (PRD §10.7): token CLI, retensi & batas, project, audit.
// Semua endpoint butuh admin; viewer mendapat 403 dan halaman menampilkan pesan.
import { useEffect, useState } from "react";
import { api, fmtDate, type AuditRow, type CliToken, type Project, type Settings } from "../../../lib/playbook";

const FIELDS: { key: keyof Settings; label: string; hint?: string }[] = [
  { key: "artifact_retention_days", label: "Retensi artifact", hint: "hari" },
  { key: "report_retention_days", label: "Retensi report", hint: "hari" },
  { key: "log_retention_days", label: "Retensi log", hint: "hari" },
  { key: "log_max_bytes", label: "Batas log per run", hint: "byte" },
  { key: "max_queue_length", label: "Antrean maksimum", hint: "run" },
  { key: "max_upload_mb", label: "Batas upload artifact", hint: "MB" },
  { key: "session_reuse_minutes", label: "Reuse sesi", hint: "menit" },
  { key: "range_default_days", label: "Range default", hint: "hari" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<keyof Settings, string>>>({});
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [newToken, setNewToken] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.settings().then(s => { setSettings(s); setDraft({}); }).catch(e => setError(e.message));
    api.cliTokens().then(setTokens).catch(() => {});
    api.projects().then(setProjects).catch(() => {});
    api.audit(50).then(setAudit).catch(() => {});
  };

  useEffect(load, []);

  const saveSettings = async () => {
    const body: Partial<Record<keyof Settings, number>> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== "" && v !== undefined) body[k as keyof Settings] = Number(v);
    }
    if (!Object.keys(body).length) { setNotice("Tidak ada perubahan."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      setSettings(await api.patchSettings(body));
      setDraft({});
      setNotice("Settings disimpan.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const saveProject = async (p: Project, patch: Parameters<typeof api.patchProject>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchProject(p.id, patch);
      setProjects(prev => prev.map(x => (x.id === p.id ? updated : x)));
      setNotice(`${p.name} disimpan.`);
    } catch (e) { setError((e as Error).message); }
  };

  const makeToken = async () => {
    setError(""); setNotice("");
    try {
      const t = await api.createCliToken(label);
      setNewToken(t.token);
      setLabel("");
      api.cliTokens().then(setTokens).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  };

  const revoke = async (id: string) => {
    if (!confirm("Cabut token ini? CLI yang memakainya langsung gagal.")) return;
    try { await api.revokeCliToken(id); api.cliTokens().then(setTokens).catch(() => {}); }
    catch (e) { setError((e as Error).message); }
  };

  if (error && !settings) return <p className="pb-empty">{error}</p>;
  if (!settings) return <p className="pb-empty">Memuat settings…</p>;

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Konfigurasi Playbook.</h1>
          <p className="pb-lead">Retensi, token CLI, project, dan audit log.</p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-card" style={{ marginBottom: 14 }}>{notice}</div>}

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Retensi &amp; batas</h2>
        <div className="pb-grid two">
          {FIELDS.map(f => (
            <label className="pb-field" key={f.key}>
              {f.label} {f.hint && <span className="pb-muted">({f.hint})</span>}
              <input
                className="pb-input"
                type="number"
                min={1}
                value={draft[f.key] ?? settings[f.key]}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="pb-row" style={{ marginTop: 12 }}>
          <button className="pb-btn primary" onClick={saveSettings} disabled={busy}>Simpan</button>
          <button className="pb-btn" onClick={() => setDraft({})} disabled={busy || !Object.keys(draft).length}>Reset</button>
        </div>
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Token CLI</h2>
        <div className="pb-row" style={{ marginBottom: 12 }}>
          <input className="pb-input" style={{ maxWidth: 240 }} placeholder="label (mis. laptop-budi)"
            value={label} onChange={e => setLabel(e.target.value)} />
          <button className="pb-btn primary" onClick={makeToken} disabled={!label.trim()}>Buat token</button>
        </div>
        {newToken && (
          <div className="pb-card" style={{ marginBottom: 12 }}>
            <p className="pb-muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
              Salin sekarang - nilai penuh tidak ditampilkan lagi.
            </p>
            <code className="pb-mono" style={{ wordBreak: "break-all" }}>{newToken}</code>
          </div>
        )}
        {tokens.length === 0
          ? <p className="pb-empty">Belum ada token.</p>
          : <table className="pb-table">
            <thead><tr><th>Label</th><th>Dibuat</th><th>Terakhir dipakai</th><th /></tr></thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id}>
                  <td>{t.label ?? "-"}</td>
                  <td className="mono">{fmtDate(t.created_at)}</td>
                  <td className="mono">{t.last_used_at ? fmtDate(t.last_used_at) : "belum"}</td>
                  <td style={{ textAlign: "right" }}>
                    {t.revoked_at
                      ? <span className="pb-muted">dicabut</span>
                      : <button className="pb-btn sm danger" onClick={() => revoke(t.id)}>Cabut</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
      </section>

      <section className="pb-card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Project</h2>
        {projects.map(p => <ProjectRow key={p.id} project={p} onSave={saveProject} />)}
      </section>

      <section className="pb-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Audit terakhir</h2>
        {audit.length === 0
          ? <p className="pb-empty">Belum ada aktivitas.</p>
          : <table className="pb-table">
            <thead><tr><th>Waktu</th><th>Aksi</th><th>Entitas</th><th>Detail</th></tr></thead>
            <tbody>
              {audit.map(a => (
                <tr key={a.id}>
                  <td className="mono">{fmtDate(a.created_at)}</td>
                  <td>{a.action}</td>
                  <td className="mono">{a.entity}{a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}</td>
                  <td className="mono" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{a.detail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </section>
    </>
  );
}

function ProjectRow({ project, onSave }: {
  project: Project;
  onSave: (p: Project, patch: Parameters<typeof api.patchProject>[1]) => Promise<void>;
}) {
  const [base, setBase] = useState(project.base_url);
  const [staging, setStaging] = useState(project.staging_url ?? "");
  const [local, setLocal] = useState(project.local_url ?? "");
  const [origins, setOrigins] = useState(project.origins.join(", "));
  const [allowProd, setAllowProd] = useState(!!project.allow_production);

  const save = () => onSave(project, {
    base_url: base,
    staging_url: staging || null,
    local_url: local || null,
    origins: origins.split(",").map(s => s.trim()).filter(Boolean),
    allow_production: allowProd ? 1 : 0,
  });

  return (
    <div className="pb-card" style={{ marginBottom: 12 }}>
      <div className="pb-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <strong>{project.name}</strong>
        <span className="pb-muted pb-mono">{project.slug}</span>
      </div>
      <div className="pb-grid two">
        <label className="pb-field">base_url<input className="pb-input" value={base} onChange={e => setBase(e.target.value)} /></label>
        <label className="pb-field">staging_url<input className="pb-input" value={staging} onChange={e => setStaging(e.target.value)} /></label>
        <label className="pb-field">local_url<input className="pb-input" value={local} onChange={e => setLocal(e.target.value)} /></label>
        <label className="pb-field">origins (pisah koma)<input className="pb-input" value={origins} onChange={e => setOrigins(e.target.value)} /></label>
      </div>
      <div className="pb-row" style={{ marginTop: 10 }}>
        <label className="pb-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={allowProd} onChange={e => setAllowProd(e.target.checked)} />
          izinkan run production
        </label>
        <span className="pb-spacer" />
        <button className="pb-btn sm primary" onClick={save}>Simpan project</button>
      </div>
    </div>
  );
}
