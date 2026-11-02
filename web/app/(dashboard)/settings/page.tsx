"use client";

// Semua endpoint settings butuh admin; viewer kena 403 dan hanya melihat pesan galat.
import { useEffect, useState } from "react";
import {
  api, fmtAuditAction, fmtAuditUser, fmtDate,
  type AuditRow, type CliToken, type Project, type Settings,
} from "../../../lib/playbook";

const num = (value: string) => Number(value) || 0;

const fmtDays = (value: string) => `${num(value).toLocaleString("id-ID")} hari`;
const fmtBytes = (value: string) => {
  const bytes = num(value);
  if (bytes >= 1048576) return `${(bytes / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toLocaleString("id-ID", { maximumFractionDigits: 0 })} KB`;
  return `${bytes.toLocaleString("id-ID")} byte`;
};
const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const fmtMinutes = (value: string) => {
  const minutes = num(value);
  return minutes >= 60
    ? `${Math.round((minutes / 60) * 10) / 10} jam (${minutes.toLocaleString("id-ID")} menit)`
    : `${minutes.toLocaleString("id-ID")} menit`;
};

type SettingField = {
  key: keyof Settings;
  label: string;
  suffix: string;
  help: string;
  format: (value: string) => string;
};

type SettingSection = {
  id: string;
  title: string;
  desc: string;
  fields: SettingField[];
};

const SECTIONS: SettingSection[] = [
  {
    id: "retensi",
    title: "Retensi",
    desc: "Berapa lama data disimpan sebelum dibersihkan otomatis.",
    fields: [
      {
        key: "artifact_retention_days", label: "Artifact", suffix: "hari",
        help: "Screenshot, trace, dan file hasil test dihapus setelah umur ini.",
        format: fmtDays,
      },
      {
        key: "report_retention_days", label: "Report HTML", suffix: "hari",
        help: "Laporan yang dibuka dari dashboard tetap bisa diakses selama ini.",
        format: fmtDays,
      },
      {
        key: "log_retention_days", label: "Log run", suffix: "hari",
        help: "Teks log runner disimpan selama ini sebelum dipangkas.",
        format: fmtDays,
      },
    ],
  },
  {
    id: "batas",
    title: "Batas & antrean",
    desc: "Seberapa besar data yang boleh masuk dan berapa banyak run menunggu.",
    fields: [
      {
        key: "log_max_bytes", label: "Batas log per run", suffix: "byte",
        help: "Log lebih panjang dari ini dipotong agar database tidak membengkak.",
        format: fmtBytes,
      },
      {
        key: "max_queue_length", label: "Antrean maksimum", suffix: "run",
        help: "Run baru ditolak saat antrean sudah mencapai jumlah ini.",
        format: value => `${num(value).toLocaleString("id-ID")} run`,
      },
      {
        key: "max_upload_mb", label: "Batas upload artifact", suffix: "MB",
        help: "Ukuran maksimum satu upload artifact dari runner.",
        format: value => `${num(value).toLocaleString("id-ID")} MB`,
      },
    ],
  },
  {
    id: "perilaku",
    title: "Perilaku run",
    desc: "Kapan sesi dipakai ulang dan rentang waktu awal di Overview.",
    fields: [
      {
        key: "session_reuse_minutes", label: "Reuse sesi", suffix: "menit",
        help: "Sesi yang masih terbuka dipakai ulang bila umurnya belum melewati ini.",
        format: fmtMinutes,
      },
      {
        key: "range_default_days", label: "Range default", suffix: "hari",
        help: "Rentang hari yang dipilih otomatis saat Overview pertama dibuka.",
        format: fmtDays,
      },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<keyof Settings, string>>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [newToken, setNewToken] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.settings().then(s => { setSettings(s); setDraft({}); setSavedAt({}); })
      .catch(e => setError(e.message));
    api.cliTokens().then(setTokens).catch(() => {});
    api.projects().then(setProjects).catch(() => {});
    api.audit(50).then(setAudit).catch(() => {});
  };

  useEffect(load, []);

  const sectionDirty = (section: SettingSection) =>
    section.fields.some(f => draft[f.key] !== undefined && draft[f.key] !== settings?.[f.key]);

  const saveSection = async (section: SettingSection) => {
    if (!settings) return;
    const body: Partial<Record<keyof Settings, number>> = {};
    for (const field of section.fields) {
      const value = draft[field.key];
      if (value !== undefined && value !== "" && value !== settings[field.key]) {
        body[field.key] = Number(value);
      }
    }
    if (!Object.keys(body).length) { setNotice("Tidak ada perubahan di bagian ini."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      setSettings(await api.patchSettings(body));
      setDraft(current => {
        const next = { ...current };
        for (const key of Object.keys(body)) delete next[key as keyof Settings];
        return next;
      });
      setSavedAt(current => ({ ...current, [section.id]: new Date().toISOString() }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const resetSection = (section: SettingSection) => {
    setDraft(current => {
      const next = { ...current };
      for (const field of section.fields) delete next[field.key];
      return next;
    });
    setSavedAt(current => {
      if (!current[section.id]) return current;
      const next = { ...current };
      delete next[section.id];
      return next;
    });
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
          <p className="pb-lead">
            Atur retensi, batas run, token CLI, dan alamat project. Setiap bagian disimpan sendiri.
          </p>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-note flash">{notice}</div>}

      <div className="pb-settings-stack">
        {SECTIONS.map(section => {
          const dirty = sectionDirty(section);
          const saved = savedAt[section.id];
          return (
            <section className="pb-card" key={section.id}>
              <div className="pb-card-head">
                <div>
                  <h2>{section.title}</h2>
                  <div className="pb-card-sub">{section.desc}</div>
                </div>
                <span className={`pb-set-status ${dirty ? "dirty" : saved ? "ok" : ""}`}>
                  {dirty ? "Belum disimpan" : saved ? `Tersimpan ${fmtClock(saved)}` : "Nilai aktif"}
                </span>
              </div>
              <div className="pb-set-grid">
                {section.fields.map(field => (
                  <label className="pb-set-field" key={field.key}>
                    <span className="pb-set-field-top">
                      <span className="pb-set-label">{field.label}</span>
                      <span className="pb-set-current">sekarang {field.format(settings[field.key])}</span>
                    </span>
                    <span className="pb-input-unit">
                      <input
                        className="pb-input"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={draft[field.key] ?? settings[field.key]}
                        onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                      />
                      <span aria-hidden="true">{field.suffix}</span>
                    </span>
                    <span className="pb-set-help">{field.help}</span>
                  </label>
                ))}
              </div>
              <div className="pb-set-foot">
                <button className="pb-btn primary" onClick={() => saveSection(section)}
                  disabled={busy || !dirty}>Simpan</button>
                <button className="pb-btn" onClick={() => resetSection(section)}
                  disabled={busy || !dirty}>Reset</button>
                <span className="pb-spacer" />
                <span className="pb-set-status">Berlaku untuk run berikutnya.</span>
              </div>
            </section>
          );
        })}

        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Token CLI</h2>
              <div className="pb-card-sub">
                Dipakai playbook CLI di laptop untuk memicu run tanpa login.
              </div>
            </div>
          </div>
          <div className="pb-row pb-mb-3">
            <input className="pb-input pb-input-narrow" placeholder="label (mis. laptop-budi)"
              value={label} onChange={e => setLabel(e.target.value)} />
            <button className="pb-btn primary" onClick={makeToken} disabled={!label.trim()}>Buat token</button>
          </div>
          {newToken && (
            <div className="pb-note warn flash">
              <p className="pb-note-title">Salin sekarang — token hanya tampil sekali.</p>
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
                    <td className="pb-right">
                      {t.revoked_at
                        ? <span className="pb-muted">dicabut</span>
                        : <button className="pb-btn sm danger" onClick={() => revoke(t.id)}>Cabut</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
        </section>

        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Project</h2>
              <div className="pb-card-sub">
                Alamat target per environment dan origin yang boleh diakses runner.
              </div>
            </div>
          </div>
          {projects.length === 0
            ? <p className="pb-empty">Belum ada project.</p>
            : projects.map(p => <ProjectRow key={p.id} project={p} onSave={saveProject} />)}
        </section>

        <section className="pb-card">
          <div className="pb-card-head">
            <div>
              <h2>Audit</h2>
              <div className="pb-card-sub">
                Perubahan terakhir oleh admin. Detail mentah tidak ditampilkan di sini.
              </div>
            </div>
          </div>
          {audit.length === 0
            ? <p className="pb-empty">Belum ada aktivitas.</p>
            : <table className="pb-table">
              <thead><tr><th>Waktu</th><th>Aksi</th><th>User</th></tr></thead>
              <tbody>
                {audit.map(a => (
                  <tr key={a.id}>
                    <td className="mono">{fmtDate(a.created_at)}</td>
                    <td>
                      {fmtAuditAction(a.action)}
                      <span className="pb-audit-ent">{a.entity}</span>
                    </td>
                    <td>{fmtAuditUser(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
        </section>
      </div>
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
    <div className="pb-proj-card">
      <div className="pb-row pb-proj-head">
        <strong>{project.name}</strong>
        <span className="pb-muted pb-mono">{project.slug}</span>
      </div>
      <div className="pb-grid two">
        <label className="pb-field">base_url<input className="pb-input" value={base} onChange={e => setBase(e.target.value)} /></label>
        <label className="pb-field">staging_url<input className="pb-input" value={staging} onChange={e => setStaging(e.target.value)} /></label>
        <label className="pb-field">local_url<input className="pb-input" value={local} onChange={e => setLocal(e.target.value)} /></label>
        <label className="pb-field">origins (pisah koma)<input className="pb-input" value={origins} onChange={e => setOrigins(e.target.value)} /></label>
      </div>
      <div className="pb-row pb-proj-foot">
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
