"use client";

// Semua endpoint settings butuh admin; viewer kena 403 dan hanya melihat pesan galat.
// Halaman dibagi tab: Playwright (spec + antrean), Lighthouse (config lhci per project),
// Report (retensi + tampilan), Akses (alamat project + token CLI).
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api, fmtDate,
  type CliToken, type Project, type Settings, type TestFile,
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

type TabId = "pw" | "lh" | "report" | "access";

const TABS: { id: TabId; label: string }[] = [
  { id: "pw", label: "Playwright" },
  { id: "lh", label: "Lighthouse" },
  { id: "report", label: "Report" },
  { id: "access", label: "Akses" },
];

// Cermin konstanta server: MAX_LH_URLS=3, target sesi memakai 1 slot.
const MAX_EXTRA_URLS = 2;
const RUN_CHOICES = [1, 2, 3, 5];
const CATEGORIES = [
  { key: "categories:performance", label: "Performance" },
  { key: "categories:accessibility", label: "Accessibility" },
  { key: "categories:best-practices", label: "Best practices" },
  { key: "categories:seo", label: "SEO" },
];

type Budgets = Record<string, { minScore: number }>;
type LhConfig = { urls?: string[]; numberOfRuns?: number; budgets?: Budgets };

const parseConfig = (config: string | null): LhConfig => {
  try { return JSON.parse(config ?? "{}") ?? {}; } catch { return {}; }
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
  tab: TabId;
  title: string;
  desc: string;
  fields: SettingField[];
};

// Tiap key di tabel settings punya tepat satu rumah tab.
const SECTIONS: SettingSection[] = [
  {
    id: "antrean",
    tab: "pw",
    title: "Antrean & log run",
    desc: "Batas run menunggu dan ukuran teks log yang disimpan.",
    fields: [
      {
        key: "max_queue_length", label: "Antrean maksimum", suffix: "run",
        help: "Run baru ditolak saat antrean sudah mencapai jumlah ini.",
        format: value => `${num(value).toLocaleString("id-ID")} run`,
      },
      {
        key: "log_max_bytes", label: "Batas log per run", suffix: "byte",
        help: "Log lebih panjang dari ini dipotong agar database tidak membengkak.",
        format: fmtBytes,
      },
    ],
  },
  {
    id: "sesi",
    tab: "pw",
    title: "Reuse sesi",
    desc: "Sesi Playwright yang masih terbuka dipakai ulang supaya laporan tidak terpecah.",
    fields: [
      {
        key: "session_reuse_minutes", label: "Reuse sesi", suffix: "menit",
        help: "Sesi yang masih terbuka dipakai ulang bila umurnya belum melewati ini.",
        format: fmtMinutes,
      },
    ],
  },
  {
    id: "upload",
    tab: "lh",
    title: "Upload artifact",
    desc: "Batas ukuran satu upload artifact dari runner.",
    fields: [
      {
        key: "max_upload_mb", label: "Batas upload artifact", suffix: "MB",
        help: "Ukuran maksimum satu upload artifact dari runner.",
        format: value => `${num(value).toLocaleString("id-ID")} MB`,
      },
    ],
  },
  {
    id: "retensi",
    tab: "report",
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
    id: "tampilan",
    tab: "report",
    title: "Tampilan ringkasan",
    desc: "Rentang hari yang dipakai Overview saat pertama dibuka.",
    fields: [
      {
        key: "range_default_days", label: "Range default", suffix: "hari",
        help: "Rentang hari yang dipilih otomatis saat Ringkasan pertama dibuka.",
        format: fmtDays,
      },
    ],
  },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("pw");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<keyof Settings, string>>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<TestFile[]>([]);
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
    api.testFiles({ all: true }).then(setFiles).catch(() => {});
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

  const createProject = async (body: Parameters<typeof api.createProject>[0]) => {
    setError(""); setNotice("");
    try {
      const created = await api.createProject(body);
      setProjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(`${created.name} ditambahkan.`);
    } catch (e) { setError((e as Error).message); }
  };

  const saveProject = async (p: Project, patch: Parameters<typeof api.patchProject>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchProject(p.id, patch);
      setProjects(prev => prev.map(x => (x.id === p.id ? updated : x)));
      setNotice(`${p.name} disimpan.`);
    } catch (e) { setError((e as Error).message); }
  };

  const saveTestFile = async (file: TestFile, patch: Parameters<typeof api.patchTestFile>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchTestFile(file.id, patch);
      setFiles(prev => prev.map(x => (x.id === file.id ? updated : x)));
      setNotice(`${file.label} disimpan.`);
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

  const renderSection = (section: SettingSection) => {
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
  };

  const tabSections = (id: TabId) => SECTIONS.filter(s => s.tab === id).map(renderSection);
  const pwFiles = files.filter(f => f.tool === "pw");
  const lhFiles = files.filter(f => f.tool === "lh");

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Seting.</h1>
        </div>
      </div>
      {error && <div className="pb-err">{error}</div>}
      {notice && <div className="pb-note flash">{notice}</div>}

      <div className="pb-tabs pb-set-tabbar" role="tablist" aria-label="Bagian seting">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`pb-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => { setTab(t.id); setNotice(""); }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="pb-set-tab-body">
        {tab === "pw" && (
          <>
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Spec Playwright</h2>
                  <div className="pb-card-sub">
                    Spec nonaktif tetap tersimpan tapi tidak ditawarkan saat memilih run.
                  </div>
                </div>
              </div>
              {projects.map(p => {
                const own = pwFiles.filter(f => f.project_id === p.id);
                if (!own.length) return null;
                return (
                  <div className="pb-spec-list" key={p.id}>
                    <div className="pb-spec-head">
                      <strong>{p.name}</strong>
                      <span className="pb-muted pb-mono">{own.length} spec</span>
                    </div>
                    {own.map(f => (
                      <label className="pb-spec-row" key={f.id}>
                        <input type="checkbox" checked={!!f.enabled}
                          onChange={e => saveTestFile(f, { enabled: e.target.checked ? 1 : 0 })} />
                        <span className="pb-spec-name">{f.label}</span>
                        <span className="pb-spec-path">{f.path}</span>
                        <span className={`pb-badge ${f.enabled ? "passed" : "closed"}`}>
                          {f.enabled ? "aktif" : "nonaktif"}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
              {pwFiles.length === 0 && <p className="pb-empty">Belum ada spec Playwright.</p>}
            </section>
            {tabSections("pw")}
          </>
        )}

        {tab === "lh" && (
          <>
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Konfigurasi Lighthouse CI</h2>
                  <div className="pb-card-sub">
                    Nilai ini ditulis ke <code className="pb-mono">test_files.config</code> dan dipakai
                    saat lhci digenerate. Target utama project selalu ikut diaudit.
                  </div>
                </div>
              </div>
              {projects.map(p => {
                const file = lhFiles.find(f => f.project_id === p.id);
                if (!file) return null;
                return <LhciCard key={p.id} project={p} file={file} onSave={saveTestFile} />;
              })}
              {lhFiles.length === 0 && <p className="pb-empty">Belum ada config Lighthouse.</p>}
            </section>
            {tabSections("lh")}
          </>
        )}

        {tab === "report" && (
          <>
            {tabSections("report")}
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Isi report</h2>
                  <div className="pb-card-sub">
                    Report sesi memuat log runner, daftar artifact, dan skor Lighthouse terakhir.
                  </div>
                </div>
                <Link className="pb-link-muted" href="/reports">Buka Reports</Link>
              </div>
              <p className="pb-hint">
                Retensi di atas menentukan berapa lama file report di disk masih bisa dibuka.
              </p>
            </section>
          </>
        )}

        {tab === "access" && (
          <>
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Project</h2>
                  <div className="pb-card-sub">
                    Alamat target per environment dan origin yang boleh diakses runner.
                  </div>
                </div>
              </div>
              <NewProjectForm onCreate={createProject} />
              {projects.length === 0
                ? <p className="pb-empty">Belum ada project.</p>
                : projects.map(p => <ProjectRow key={p.id} project={p} onSave={saveProject} />)}
            </section>

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
          </>
        )}
      </div>
    </>
  );
}

// Editor config lhci per project. Bentuk JSON sama dengan /lighthouse supaya run
// dari dua halaman tidak saling menimpa nilai.
function LhciCard({ project, file, onSave }: {
  project: Project;
  file: TestFile;
  onSave: (file: TestFile, patch: Parameters<typeof api.patchTestFile>[1]) => Promise<void>;
}) {
  const cfg = parseConfig(file.config);
  const baselineUrls = cfg.urls ?? [];
  const [runs, setRuns] = useState(cfg.numberOfRuns ?? 1);
  const [extraUrls, setExtraUrls] = useState<string[]>(baselineUrls);
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(CATEGORIES.map(c => [c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100)])),
  );
  const [saving, setSaving] = useState(false);

  const extra = extraUrls.map(s => s.trim()).filter(Boolean);
  const dirty =
    runs !== (cfg.numberOfRuns ?? 1) ||
    extra.join("\n") !== baselineUrls.join("\n") ||
    CATEGORIES.some(c => (scores[c.key] ?? 60) !== Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(file, {
        config: JSON.stringify({
          urls: extra,
          numberOfRuns: runs,
          budgets: Object.fromEntries(CATEGORIES.map(c => [c.key, { minScore: (scores[c.key] ?? 60) / 100 }])),
        }),
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="pb-proj-card">
      <div className="pb-row pb-proj-head">
        <strong>{project.name}</strong>
        <span className="pb-muted pb-mono">{file.path}</span>
      </div>

      <div className="pb-lh-form">
        <div className="pb-lh-field">
          <span className="pb-set-label">Jumlah run per URL</span>
          <div className="pb-seg">
            {RUN_CHOICES.map(n => (
              <button key={n} className={runs === n ? "active" : ""}
                onClick={() => setRuns(n)} aria-pressed={runs === n}>{n}×</button>
            ))}
          </div>
        </div>

        <div className="pb-lh-field">
          <span className="pb-set-label">
            URL tambahan ({extra.length}/{MAX_EXTRA_URLS})
          </span>
          <div className="pb-lh-urls">
            <div className="pb-row">
              <input className="pb-input" value={project.base_url} readOnly aria-label="Target utama" />
              <span className="pb-badge closed">target utama</span>
            </div>
            {extraUrls.map((u, i) => (
              <div className="pb-row" key={i}>
                <input className="pb-input" value={u} placeholder="https://…"
                  aria-label={`URL tambahan ${i + 1}`}
                  onChange={e => setExtraUrls(list => list.map((x, j) => (j === i ? e.target.value : x)))} />
                <button className="pb-btn sm" onClick={() => setExtraUrls(list => list.filter((_, j) => j !== i))}>
                  Hapus
                </button>
              </div>
            ))}
            {extraUrls.length < MAX_EXTRA_URLS && (
              <button className="pb-btn sm" onClick={() => setExtraUrls(list => [...list, ""])}>
                + Tambah URL
              </button>
            )}
          </div>
        </div>

        <div className="pb-lh-field">
          <span className="pb-set-label">Skor minimum per kategori</span>
          <div className="pb-lh-budgets">
            {CATEGORIES.map(c => (
              <label className="pb-lh-budget" key={c.key}>
                <span className="pb-lh-budget-top">
                  <span>{c.label}</span>
                  <output>{scores[c.key] ?? 60}%</output>
                </span>
                <input type="range" min={0} max={100} step={5}
                  value={scores[c.key] ?? 60} aria-label={"Skor minimum " + c.label}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setScores(s => ({ ...s, [c.key]: v }));
                  }} />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">{dirty ? "Belum disimpan" : "Tersimpan"}</span>
        <span className="pb-spacer" />
        <button className="pb-btn sm primary" onClick={save} disabled={saving || !dirty}>
          Simpan config
        </button>
      </div>
    </div>
  );
}

// Tambah departemen baru. base_url boleh dikosongkan kalau targetnya masih lokal;
// server memakai local_url sebagai gantinya supaya kolom NOT NULL tetap terisi.
function NewProjectForm({ onCreate }: {
  onCreate: (body: Parameters<typeof api.createProject>[0]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        base_url: base.trim(),
        local_url: local.trim() || undefined,
      });
      setName(""); setBase(""); setLocal("");
    } finally { setBusy(false); }
  };

  return (
    <div className="pb-proj-card">
      <div className="pb-row pb-proj-head">
        <strong>Tambah departemen</strong>
      </div>
      <div className="pb-grid two">
        <label className="pb-field">nama<input className="pb-input" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="pb-field">base_url<input className="pb-input" placeholder="https://…" value={base} onChange={e => setBase(e.target.value)} /></label>
        <label className="pb-field">local_url<input className="pb-input" placeholder="http://localhost:5173" value={local} onChange={e => setLocal(e.target.value)} /></label>
      </div>
      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">{name.trim() ? "" : "nama wajib diisi"}</span>
        <span className="pb-spacer" />
        <button className="pb-btn sm primary" onClick={submit}
          disabled={busy || !name.trim() || !(base.trim() || local.trim())}>
          {busy ? "Menyimpan…" : "Tambah project"}
        </button>
      </div>
    </div>
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
