"use client";

// Semua endpoint settings butuh admin; viewer kena 403 dan hanya melihat pesan galat.
// Halaman dibagi tab: Playwright (spec + antrean), Lighthouse (config lhci per project),
// Report (retensi + tampilan), Akses (alamat project + token CLI).
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api, fmtDate,
  type CliToken, type Help, type Project, type ProjectGroup, type Settings, type TestFile,
} from "../../../lib/playbook";
import LhConfigEditor, {
  LH_CATEGORIES, extraUrlsOf, lhConfigError, parseLhConfig,
} from "../../_components/lh-config-editor";

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

type TabId = "project" | "pw" | "lh" | "report" | "bantuan";

// Urutan tab mengikuti alur kerja: siapkan project dulu, baru seting per tool.
const TABS: { id: TabId; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "pw", label: "Playwright" },
  { id: "lh", label: "Lighthouse CI" },
  { id: "report", label: "Report" },
  { id: "bantuan", label: "Bantuan" },
];

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
    tab: "report",
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
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [files, setFiles] = useState<TestFile[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.settings().then(s => { setSettings(s); setDraft({}); setSavedAt({}); })
      .catch(e => setError(e.message));
    api.cliTokens().then(setTokens).catch(() => {});
    api.projects({ all: true }).then(setProjects).catch(() => {});
    api.projectGroups().then(setGroups).catch(() => {});
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

  // Error diteruskan ke form: isian tidak boleh hilang saat gagal.
  const createProject = async (body: Parameters<typeof api.createProject>[0]) => {
    setError(""); setNotice("");
    const created = await api.createProject(body);
    setProjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    reloadGroups();
    setNotice(`${created.name} ditambahkan.`);
  };

  const reloadGroups = () => api.projectGroups().then(setGroups).catch(e => setError(e.message));

  const addGroup = async (name: string) => {
    setError(""); setNotice("");
    try {
      const g = await api.createProjectGroup(name);
      setGroups(prev => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) { setError((e as Error).message); throw e; }
  };

  const renameGroup = async (id: string, name: string) => {
    setError(""); setNotice("");
    try {
      const g = await api.patchProjectGroup(id, name);
      setGroups(prev => prev.map(x => (x.id === id ? g : x)));
      setEditingGroup(null);
    } catch (e) { setError((e as Error).message); }
  };

  const removeGroup = async (g: ProjectGroup) => {
    if (!confirm(`Hapus grup "${g.name}"?`)) return;
    setError(""); setNotice("");
    try {
      await api.deleteProjectGroup(g.id);
      setGroups(prev => prev.filter(x => x.id !== g.id));
    } catch (e) { setError((e as Error).message); }
  };

  const saveProject = async (p: Project, patch: Parameters<typeof api.patchProject>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchProject(p.id, patch);
      setProjects(prev => prev.map(x => (x.id === p.id ? updated : x)));
      reloadGroups();
      setNotice(`${updated.name} disimpan.`);
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

  // Test file milik project. Error diteruskan ke form supaya isian tidak hilang.
  const addTestFile = async (
    p: Project,
    body: Omit<Parameters<typeof api.createTestFile>[0], "projectId">,
  ) => {
    setError(""); setNotice("");
    const created = await api.createTestFile({ projectId: p.id, ...body });
    setFiles(prev => [...prev, created]);
    setNotice(`${created.label} ditambahkan.`);
  };

  const removeTestFile = async (file: TestFile) => {
    if (!confirm(`Hapus ${file.label} (${file.path})?`)) return;
    setError(""); setNotice("");
    try {
      await api.deleteTestFile(file.id);
      setFiles(prev => prev.filter(x => x.id !== file.id));
      setNotice(`${file.label} dihapus.`);
    } catch (e) { setError((e as Error).message); }
  };

  // Hapus permanen hanya untuk project tanpa riwayat; server menolak dengan 409.
  const deleteProject = async (p: Project) => {
    if (!confirm(`Hapus permanen ${p.name}? Tidak bisa dibatalkan.`)) return;
    setError(""); setNotice("");
    try {
      await api.deleteProject(p.id);
      setProjects(prev => prev.filter(x => x.id !== p.id));
      reloadGroups();
      setNotice(`${p.name} dihapus.`);
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
  const visibleProjects = showArchived ? projects : projects.filter(p => p.active);
  const byGroup = (id: string | null) =>
    visibleProjects.filter(p => (p.group_id ?? null) === id)
      .sort((a, b) => a.name.localeCompare(b.name));
  const orphans = byGroup(null);
  const activeProjects = projects.filter(p => p.active)
    .sort((a, b) => a.name.localeCompare(b.name));
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
                <span className="pb-set-status">
                  {pwFiles.filter(f => f.enabled).length} spec aktif dari {pwFiles.length}
                </span>
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
              {activeProjects.map(p => {
                const file = lhFiles.find(f => f.project_id === p.id) ?? null;
                return (
                  <LhciCard key={p.id} project={p} file={file}
                    onSave={saveTestFile} onAddFile={addTestFile} />
                );
              })}
              {activeProjects.length === 0 && (
                <p className="pb-empty">Belum ada project aktif.</p>
              )}
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

        {tab === "project" && (
          <>
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Grup & project</h2>
                  <div className="pb-card-sub">
                    Grup mengelompokkan project di Overview dan filter. Project arsip tetap
                    menyimpan riwayat tapi tidak bisa dijalankan.
                  </div>
                </div>
                <label className="pb-row" style={{ gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={showArchived}
                    onChange={e => setShowArchived(e.target.checked)} />
                  Tampilkan arsip
                </label>
              </div>

              <NewGroupForm onCreate={addGroup} />

              {groups.length === 0 && orphans.length === 0 && (
                <p className="pb-empty">
                  Belum ada project. Tambahkan grup dulu, lalu project di dalamnya.
                </p>
              )}

              {groups.map(g => {
                const own = byGroup(g.id);
                const editing = editingGroup === g.id;
                return (
                  <div className="pb-group" key={g.id}>
                    <div className="pb-group-head">
                      {editing ? (
                        <>
                          <input className="pb-input" value={groupName} autoFocus
                            aria-label="Nama grup"
                            onChange={e => setGroupName(e.target.value)} />
                          <button className="pb-btn sm primary"
                            onClick={() => renameGroup(g.id, groupName)}
                            disabled={!groupName.trim()}>Simpan</button>
                          <button className="pb-btn sm"
                            onClick={() => setEditingGroup(null)}>Batal</button>
                        </>
                      ) : (
                        <>
                          <strong>{g.name}</strong>
                          <span className="pb-muted pb-mono">{own.length} project</span>
                          <span className="pb-spacer" />
                          <button className="pb-btn sm"
                            onClick={() => { setEditingGroup(g.id); setGroupName(g.name); }}>
                            Ganti nama
                          </button>
                          <button className="pb-btn sm danger" disabled={own.length > 0}
                            title={own.length > 0 ? "Pindahkan project dulu" : undefined}
                            onClick={() => removeGroup(g)}>Hapus grup</button>
                        </>
                      )}
                    </div>
                    {own.length === 0
                      ? <p className="pb-empty sm">Belum ada project di grup ini.</p>
                      : own.map(p => (
                        <ProjectRow key={p.id} project={p} groups={groups} files={files}
                          onSave={saveProject} onAddFile={addTestFile}
                          onRemoveFile={removeTestFile} onDelete={deleteProject} />
                      ))}
                  </div>
                );
              })}

              {orphans.length > 0 && (
                <div className="pb-group">
                  <div className="pb-group-head">
                    <strong>Tanpa grup</strong>
                    <span className="pb-muted pb-mono">{orphans.length} project</span>
                  </div>
                  {orphans.map(p => (
                    <ProjectRow key={p.id} project={p} groups={groups} files={files}
                      onSave={saveProject} onAddFile={addTestFile}
                      onRemoveFile={removeTestFile} onDelete={deleteProject} />
                  ))}
                </div>
              )}
            </section>

            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Project baru</h2>
                  <div className="pb-card-sub">
                    base_url wajib. Slug dipakai sebagai kunci di CLI dan URL report.
                  </div>
                </div>
              </div>
              <NewProjectForm groups={groups} onCreate={createProject} />
            </section>
          </>
        )}

        {tab === "bantuan" && (
          <>
            <Bantuan />
            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Token CLI</h2>
                  <div className="pb-card-sub">
                    Dipakai playbook CLI di laptop untuk memicu run tanpa login. Token ini
                    bukan kredensial login dashboard, dan pembuatannya lewat CLI
                    (<code className="pb-mono">playbook login</code>).
                  </div>
                </div>
              </div>
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

// Editor config lhci per project, memakai komponen bersama LhConfigEditor
// supaya bentuk JSON-nya sama dengan /lighthouse (PRD T09).
function LhciCard({ project, file, onSave, onAddFile }: {
  project: Project;
  file: TestFile | null;
  onSave: (file: TestFile, patch: Parameters<typeof api.patchTestFile>[1]) => Promise<void>;
  onAddFile: (p: Project, body: Omit<Parameters<typeof api.createTestFile>[0], "projectId">) => Promise<void>;
}) {
  const target = project.base_url || "";
  const [config, setConfig] = useState(file?.config ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !!file && config !== (file.config ?? "");

  const save = async () => {
    if (!file) return;
    const cfg = parseLhConfig(config);
    const msg = lhConfigError({
      target, extra: extraUrlsOf(cfg, project),
      runs: cfg.numberOfRuns ?? 1,
      scores: Object.fromEntries(LH_CATEGORIES.map(c => [
        c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100),
      ])),
    });
    if (msg) { setError(msg); return; }
    setSaving(true); setError("");
    try { await onSave(file, { config }); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  // Config default dari URL project: target utama selalu ikut diaudit runner.
  const create = async () => {
    setSaving(true); setError("");
    try {
      await onAddFile(project, {
        tool: "lh",
        path: `lighthouserc.${project.slug}.js`,
        config: {
          urls: [], numberOfRuns: 1,
          budgets: Object.fromEntries(LH_CATEGORIES.map(c => [c.key, { minScore: 0.6 }])),
        },
      });
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="pb-proj-card">
      <div className="pb-row pb-proj-head">
        <strong>{project.name}</strong>
        <span className="pb-muted pb-mono">{file?.path ?? "belum ada config"}</span>
      </div>

      {!target.trim() && (
        <div className="pb-note warn">
          Project ini belum punya <code className="pb-mono">base_url</code>. Isi dulu di tab
          Project supaya target audit bisa ditentukan.
        </div>
      )}

      {file ? (
        <LhConfigEditor project={project} value={config} target={target}
          onChange={setConfig} idPrefix={`set-${project.id}`} />
      ) : (
        <p className="pb-hint">
          Config default dibuat dari URL project: target utama, 1 run, budget 60.
        </p>
      )}

      {error && <div className="pb-err">{error}</div>}

      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">
          {!file ? "Belum ada config" : dirty ? "Belum disimpan" : "Tersimpan"}
        </span>
        <span className="pb-spacer" />
        {file ? (
          <button className="pb-btn sm primary" onClick={save}
            disabled={saving || !dirty || !target.trim()}>
            Simpan config
          </button>
        ) : (
          <button className="pb-btn sm primary" onClick={create}
            disabled={saving || !target.trim()}>
            Buat config default
          </button>
        )}
      </div>
    </div>
  );
}

// Tambah grup baru. Enter di kolom = simpan.
function NewGroupForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onCreate(name.trim()); setName(""); }
    catch { /* pesan sudah tampil di halaman; isian dibiarkan */ }
    finally { setBusy(false); }
  };

  return (
    <div className="pb-row pb-mb-3" style={{ gap: 8 }}>
      <input className="pb-input pb-input-narrow" placeholder="nama grup baru"
        value={name} aria-label="Nama grup baru"
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      <button className="pb-btn sm primary" onClick={submit} disabled={busy || !name.trim()}>
        + Grup
      </button>
    </div>
  );
}

// Tambah project. base_url wajib (server menolak yang kosong); error dari
// onCreate diteruskan balik supaya isian tidak hilang saat gagal.
function NewProjectForm({ groups, onCreate }: {
  groups: ProjectGroup[];
  onCreate: (body: Parameters<typeof api.createProject>[0]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [local, setLocal] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onCreate({
        name: name.trim(),
        base_url: base.trim(),
        local_url: local.trim() || null,
        groupId: groupId || null,
      });
      setName(""); setBase(""); setLocal(""); setGroupId("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="pb-proj-card">
      <div className="pb-grid two">
        <label className="pb-field">nama
          <input className="pb-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="pb-field">grup
          <select className="pb-select" value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">tanpa grup</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="pb-field">base_url (wajib)
          <input className="pb-input" placeholder="https://…" value={base}
            onChange={e => setBase(e.target.value)} />
        </label>
        <label className="pb-field">local_url
          <input className="pb-input" placeholder="http://localhost:5173" value={local}
            onChange={e => setLocal(e.target.value)} />
        </label>
      </div>
      {error && <div className="pb-err">{error}</div>}
      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">
          {name.trim() && base.trim() ? "" : "nama dan base_url wajib diisi"}
        </span>
        <span className="pb-spacer" />
        <button className="pb-btn sm primary" onClick={submit}
          disabled={busy || !name.trim() || !base.trim()}>
          {busy ? "Menyimpan…" : "Tambah project"}
        </button>
      </div>
    </div>
  );
}

// Template spec minimal: server menolak code kosong.
const SPEC_TEMPLATE = `import { test, expect } from "@playwright/test";

test("halaman utama terbuka", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
`;

// Satu project di pohon grup: pindah grup, arsip/pulihkan, dan detail URL.
function ProjectRow({ project, groups, files, onSave, onAddFile, onRemoveFile, onDelete }: {
  project: Project;
  groups: ProjectGroup[];
  files: TestFile[];
  onSave: (p: Project, patch: Parameters<typeof api.patchProject>[1]) => Promise<void>;
  onAddFile: (p: Project, body: Omit<Parameters<typeof api.createTestFile>[0], "projectId">) => Promise<void>;
  onRemoveFile: (f: TestFile) => Promise<void>;
  onDelete: (p: Project) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const archived = !project.active;

  return (
    <div className={`pb-proj-row ${archived ? "archived" : ""}`}>
      <div className="pb-proj-row-head">
        <button className="pb-proj-toggle" onClick={() => setOpen(o => !o)}
          aria-expanded={open}>
          <span className="pb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <strong>{project.name}</strong>
          <span className="pb-muted pb-mono">{project.slug}</span>
        </button>
        {archived && <span className="pb-badge closed">Arsip</span>}
        <span className="pb-spacer" />
        <select className="pb-select sm" value={project.group_id ?? ""}
          aria-label={"Grup untuk " + project.name}
          onChange={e => onSave(project, { groupId: e.target.value || null })}>
          <option value="">tanpa grup</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="pb-btn sm" onClick={() => onSave(project, { active: archived ? 1 : 0 })}>
          {archived ? "Pulihkan" : "Arsipkan"}
        </button>
      </div>
      {open && (
        <ProjectDetail project={project} files={files} onSave={onSave}
          onAddFile={onAddFile} onRemoveFile={onRemoveFile} onDelete={onDelete} />
      )}
    </div>
  );
}

// Detail URL/origin project + test file miliknya. Slug read-only karena dipakai
// CLI dan URL report.
function ProjectDetail({ project, files, onSave, onAddFile, onRemoveFile, onDelete }: {
  project: Project;
  files: TestFile[];
  onSave: (p: Project, patch: Parameters<typeof api.patchProject>[1]) => Promise<void>;
  onAddFile: (p: Project, body: Omit<Parameters<typeof api.createTestFile>[0], "projectId">) => Promise<void>;
  onRemoveFile: (f: TestFile) => Promise<void>;
  onDelete: (p: Project) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [base, setBase] = useState(project.base_url ?? "");
  const [staging, setStaging] = useState(project.staging_url ?? "");
  const [local, setLocal] = useState(project.local_url ?? "");
  const [origins, setOrigins] = useState(project.origins.join(", "));
  const [allowProd, setAllowProd] = useState(!!project.allow_production);
  const [addOpen, setAddOpen] = useState(false);
  const [path, setPath] = useState(`tests/${project.slug}.spec.ts`);
  const [code, setCode] = useState(SPEC_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const own = files.filter(f => f.project_id === project.id);
  const hasLh = own.some(f => f.tool === "lh");
  // Petunjuk untuk UI saja; server tetap penjaga terakhir lewat 409.
  const deletable = !own.length && !project.lastRunAt;

  const save = () => onSave(project, {
    name: name.trim(),
    base_url: base.trim(),
    staging_url: staging.trim() || null,
    local_url: local.trim() || null,
    origins: origins.split(",").map(s => s.trim()).filter(Boolean),
    allow_production: allowProd ? 1 : 0,
  });

  const addSpec = async () => {
    setBusy(true); setErr("");
    try {
      await onAddFile(project, { tool: "pw", path: path.trim(), code });
      setAddOpen(false);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Config default dari URL project: target utama selalu ikut diaudit runner.
  const addLhConfig = async () => {
    setBusy(true); setErr("");
    try {
      await onAddFile(project, {
        tool: "lh",
        path: `lighthouserc.${project.slug}.js`,
        config: {
          urls: [], numberOfRuns: 1,
          budgets: Object.fromEntries(LH_CATEGORIES.map(c => [c.key, { minScore: 0.6 }])),
        },
      });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="pb-proj-body">
      <div className="pb-grid two">
        <label className="pb-field">nama
          <input className="pb-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="pb-field">slug (tidak bisa diubah)
          <input className="pb-input pb-mono" value={project.slug} readOnly />
        </label>
        <label className="pb-field">base_url
          <input className="pb-input" value={base} onChange={e => setBase(e.target.value)} />
        </label>
        <label className="pb-field">staging_url
          <input className="pb-input" value={staging} onChange={e => setStaging(e.target.value)} />
        </label>
        <label className="pb-field">local_url
          <input className="pb-input" value={local} onChange={e => setLocal(e.target.value)} />
        </label>
        <label className="pb-field">origins (pisah koma)
          <input className="pb-input" value={origins} onChange={e => setOrigins(e.target.value)} />
        </label>
      </div>
      <div className="pb-row pb-proj-foot">
        <label className="pb-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={allowProd} onChange={e => setAllowProd(e.target.checked)} />
          izinkan run production
        </label>
        <span className="pb-spacer" />
        <button className="pb-btn sm primary" onClick={save}>Simpan project</button>
      </div>

      <div className="pb-file-list">
        <div className="pb-spec-head">
          <strong>Test file</strong>
          <span className="pb-muted pb-mono">{own.length}</span>
        </div>
        {own.map(f => (
          <div className="pb-spec-row" key={f.id}>
            <span className={`pb-badge ${f.enabled ? "passed" : "closed"}`}>
              {f.tool === "pw" ? "Playwright" : "Lighthouse"}
            </span>
            <span className="pb-spec-name">{f.label}</span>
            <span className="pb-spec-path">{f.path}</span>
            <button className="pb-btn sm danger" onClick={() => onRemoveFile(f)}>Hapus</button>
          </div>
        ))}
        {!own.length && <p className="pb-hint">Belum ada spec atau config untuk project ini.</p>}

        <div className="pb-row pb-proj-foot" style={{ gap: 8 }}>
          <button className="pb-btn sm" onClick={() => setAddOpen(o => !o)} disabled={busy}>
            {addOpen ? "Batal" : "+ Spec Playwright"}
          </button>
          {!hasLh && (
            <button className="pb-btn sm" onClick={addLhConfig} disabled={busy}>
              Buat config Lighthouse
            </button>
          )}
        </div>

        {addOpen && (
          <div className="pb-lh-field pb-proj-foot">
            <label className="pb-field">path spec
              <input className="pb-input pb-mono" value={path}
                onChange={e => setPath(e.target.value)} />
            </label>
            <label className="pb-field">code
              <textarea className="pb-input pb-mono" rows={8} value={code}
                onChange={e => setCode(e.target.value)} />
            </label>
            <div className="pb-row">
              <button className="pb-btn sm primary" onClick={addSpec} disabled={busy}>
                {busy ? "Menyimpan…" : "Tambah spec"}
              </button>
            </div>
          </div>
        )}

        {!deletable && (
          <p className="pb-hint">
            Project ini sudah punya riwayat. Pakai Arsipkan supaya report tetap bisa dibuka.
          </p>
        )}
        {deletable && (
          <div className="pb-row pb-proj-foot">
            <button className="pb-btn sm danger" onClick={() => onDelete(project)}>
              Hapus permanen
            </button>
          </div>
        )}
        {err && <div className="pb-err">{err}</div>}
      </div>
    </div>
  );
}

// FAQ ringkas + versi tool + perintah update manual. Dijawab dari data server,
// bukan teks statis, supaya versi yang tampil tidak pernah bohong.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Apa beda sesi dan run?",
    a: "Sesi adalah wadah per project + environment + user. Run adalah satu eksekusi spec. "
      + "Sesi terbuka dipakai ulang selama umurnya belum lewat batas reuse, supaya report tidak terpecah.",
  },
  {
    q: "Kenapa waktu tampil WIB?",
    a: "Semua timestamp disimpan UTC dan ditampilkan dalam WIB agar jadwal run tim tidak beda-beda.",
  },
  {
    q: "Bagaimana token CLI dipakai?",
    a: "Token hanya untuk playbook CLI di laptop, bukan login dashboard. Buat lewat "
      + "playbook login, lalu cabut dari tab ini kalau perangkatnya hilang.",
  },
  {
    q: "Kenapa config Lighthouse ditolak?",
    a: "Total URL maksimal 5 (1 target project + 4 URL tambahan), numberOfRuns 1-10, "
      + "dan setiap URL harus satu origin dengan URL project yang diizinkan.",
  },
  {
    q: "Apa beda grup dan project?",
    a: "Grup hanya pengelompokan tampilan (Overview + filter). Project menyimpan URL, "
      + "spec, dan config. Project berriwayat diarsipkan, tidak dihapus.",
  },
];

function Bantuan() {
  const [help, setHelp] = useState<Help | null>(null);

  useEffect(() => { api.help().then(setHelp).catch(() => {}); }, []);

  const rows: { label: string; value: string }[] = help ? [
    { label: "Versi dashboard", value: help.version },
    { label: "Node", value: help.node },
    { label: "Playwright", value: help.playwright },
    { label: "Lighthouse CI", value: help.lighthouse },
  ] : [];

  return (
    <>
      <section className="pb-card">
        <div className="pb-card-head">
          <div>
            <h2>Versi & update</h2>
            <div className="pb-card-sub">
              Update tool dijalankan manual dari terminal. Dashboard tidak pernah menjalankan
              npm sendiri.
            </div>
          </div>
        </div>
        {help ? (
          <div className="pb-kv">
            {rows.map(r => (
              <div className="pb-kv-row" key={r.label}>
                <span>{r.label}</span>
                <code className="pb-mono">{r.value ?? "tidak diketahui"}</code>
              </div>
            ))}
          </div>
        ) : <p className="pb-empty sm">Memuat versi…</p>}

        {help && (
          <div className="pb-lh-field pb-proj-foot">
            {help.update_commands.map(cmd => (
              <div className="pb-row" key={cmd}>
                <code className="pb-mono pb-cmd">{cmd}</code>
                <button className="pb-btn sm" onClick={() => copy(cmd)}>Salin</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pb-card">
        <div className="pb-card-head">
          <div>
            <h2>FAQ</h2>
            <div className="pb-card-sub">Pertanyaan yang paling sering muncul saat pakai dashboard.</div>
          </div>
        </div>
        {FAQ.map(item => (
          <details className="pb-faq" key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <section className="pb-card">
        <div className="pb-card-head">
          <div>
            <h2>Masukan</h2>
            <div className="pb-card-sub">Laporan bug dan permintaan fitur.</div>
          </div>
        </div>
        {help?.feedback_url
          ? <a className="pb-link" href={help.feedback_url} target="_blank" rel="noreferrer">
            Buka form masukan
          </a>
          : <p className="pb-hint">
            Belum ada tautan masukan. Hubungi admin dashboard dan minta isi
            {" "}<code className="pb-mono">FEEDBACK_URL</code> di file .env server.
          </p>}
      </section>
    </>
  );
}

// navigator.clipboard tidak ada di konteks non-secure; gagal = diamkan saja.
function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}
