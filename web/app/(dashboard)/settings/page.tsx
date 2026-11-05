"use client";

// Semua endpoint settings butuh admin; viewer kena 403 dan hanya melihat pesan galat.
// Tab: Project, Playwright, Lighthouse, Report, Akses, Bantuan.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api, fmtDate, fmtTime, readLastProject, rememberProject,
  type Project, type ProjectGroup, type Settings, type TestFile,
} from "../../../lib/playbook";
import { confirmAction, confirmRun, promptText, showErrorAlert, showInfoToast, showSuccessToast } from "../../../lib/alerts";
import { SpecGenerator } from "../spec-generator";
import { LhciCard, NewGroupForm, NewProjectForm, ProjectRow, PwCard } from "./project-panels";
import { Bantuan } from "./bantuan";

const num = (value: string) => Number(value) || 0;

const fmtDays = (value: string) => `${num(value).toLocaleString("id-ID")} hari`;
const fmtBytes = (value: string) => {
  const bytes = num(value);
  if (bytes >= 1048576) return `${(bytes / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toLocaleString("id-ID", { maximumFractionDigits: 0 })} KB`;
  return `${bytes.toLocaleString("id-ID")} byte`;
};
const fmtMinutes = (value: string) => {
  const minutes = num(value);
  return minutes >= 60
    ? `${Math.round((minutes / 60) * 10) / 10} jam (${minutes.toLocaleString("id-ID")} menit)`
    : `${minutes.toLocaleString("id-ID")} menit`;
};

type TabId = "project" | "pw" | "lh" | "report" | "bantuan";

// Urutan tab mengikuti alur kerja: siapkan project dulu, baru pengaturan per tool.
const TABS: { id: TabId; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "pw", label: "Playwright" },
  { id: "lh", label: "Lighthouse CI" },
  { id: "report", label: "Report" },
  { id: "bantuan", label: "Bantuan" },
];

const TAB_HINT: Record<TabId, string> = {
  project: "Grup, project, URL target, dan origin yang diizinkan.",
  pw: "Buat spec, atur antrean run, dan setelan runner Playwright.",
  lh: "Target audit dan budget Lighthouse per project.",
  report: "Retensi data, batas upload, dan tampilan ringkasan.",
  bantuan: "Istilah, versi tool, dan pertanyaan yang sering muncul.",
};

type SettingField = {
  key: keyof Settings;
  label: string;
  suffix: string;
  help: string;
  // Sama dengan SETTING_LIMITS di server: input menolak nilai di luar rentang
  // supaya user tidak menunggu 400 setelah klik Simpan.
  min: number;
  max: number;
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
        min: 1, max: 100,
        help: "Run baru ditolak saat antrean sudah mencapai jumlah ini.",
        format: value => `${num(value).toLocaleString("id-ID")} run`,
      },
      {
        key: "log_max_bytes", label: "Batas log per run", suffix: "byte",
        min: 1024, max: 104857600,
        help: "Log lebih panjang dari ini dipotong agar database tidak membengkak.",
        format: fmtBytes,
      },
    ],
  },
  {
    id: "sesi",
    tab: "report",
    title: "Pembagian sesi",
    desc: "Sesi baru dibuat setelah idle selama ini, jadi run berjauhan tidak menumpuk di satu laporan.",
    fields: [
      {
        key: "session_reuse_minutes", label: "Reuse sesi", suffix: "menit",
        min: 1, max: 10080,
        help: "Idle dihitung dari run terakhir. Lebih pendek = laporan lebih ringkas per sesi.",
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
        min: 1, max: 1024,
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
        min: 1, max: 365,
        help: "Screenshot, trace, dan file hasil test dihapus setelah umur ini.",
        format: fmtDays,
      },
      {
        key: "report_retention_days", label: "Report HTML", suffix: "hari",
        min: 1, max: 365,
        help: "Laporan yang dibuka dari dashboard tetap bisa diakses selama ini.",
        format: fmtDays,
      },
      {
        key: "log_retention_days", label: "Log run", suffix: "hari",
        min: 1, max: 365,
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
        min: 1, max: 365,
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [addPanel, setAddPanel] = useState<"group" | "project" | null>(null);
  const [genProjectId, setGenProjectId] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [files, setFiles] = useState<TestFile[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.settings().then(s => { setSettings(s); setDraft({}); setSavedAt({}); })
      .catch(e => setError(e.message));
    api.projects({ all: true }).then(setProjects).catch(() => {});
    api.projectGroups().then(setGroups).catch(() => {});
    api.testFiles({ all: true }).then(setFiles).catch(() => {});
  };

  useEffect(load, []);

  // Pilihan generator ikut project terakhir yang masih aktif; kalau tidak ada, yang pertama.
  useEffect(() => {
    setGenProjectId(current => {
      const active = projects.filter(p => p.active);
      if (active.some(p => p.id === current)) return current;
      const last = readLastProject();
      return active.some(p => p.id === last) ? last : active[0]?.id ?? "";
    });
  }, [projects]);

  const sectionDirty = (section: SettingSection) =>
    section.fields.some(f => draft[f.key] !== undefined && draft[f.key] !== settings?.[f.key]);

  const fieldInvalid = (field: SettingField) => {
    const raw = draft[field.key];
    if (raw === undefined) return false;
    const n = Number(raw);
    return raw === "" || !Number.isSafeInteger(n) || n < field.min || n > field.max;
  };

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
    if (!(await confirmAction({
      title: `Simpan ${section.title}?`,
      text: "Nilai baru berlaku untuk run berikutnya.",
      confirmButtonText: "Ya, Simpan",
    }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setSettings(await api.patchSettings(body));
      setDraft(current => {
        const next = { ...current };
        for (const key of Object.keys(body)) delete next[key as keyof Settings];
        return next;
      });
      setSavedAt(current => ({ ...current, [section.id]: new Date().toISOString() }));
      showSuccessToast(`${section.title} tersimpan.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const resetSection = async (section: SettingSection) => {
    if (!(await confirmAction({
      icon: "question",
      title: `Reset ${section.title}?`,
      text: "Perubahan yang belum disimpan akan dibuang.",
      confirmButtonText: "Ya, Reset",
    }))) return;
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
    showInfoToast(`${section.title} direset.`);
  };

  // Error diteruskan ke form: isian tidak boleh hilang saat gagal.
  const createProject = async (body: Parameters<typeof api.createProject>[0]) => {
    setError(""); setNotice("");
    const created = await api.createProject(body);
    setProjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    reloadGroups();
    setNotice(`${created.name} ditambahkan.`);
    showSuccessToast(`${created.name} ditambahkan.`);
  };

  const reloadGroups = () => api.projectGroups().then(setGroups).catch(e => setError(e.message));

  const addGroup = async (name: string) => {
    setError(""); setNotice("");
    try {
      const g = await api.createProjectGroup(name);
      setGroups(prev => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
      showSuccessToast(`Grup ${g.name} ditambahkan.`);
    } catch (e) { setError((e as Error).message); throw e; }
  };

  const renameGroup = async (id: string, name: string) => {
    if (!(await confirmAction({
      title: `Simpan nama grup "${name.trim()}"?`,
      confirmButtonText: "Ya, Simpan",
    }))) return;
    setError(""); setNotice("");
    try {
      const g = await api.patchProjectGroup(id, name);
      setGroups(prev => prev.map(x => (x.id === id ? g : x)));
      setEditingGroup(null);
      showSuccessToast(`Grup ${g.name} disimpan.`);
    } catch (e) { setError((e as Error).message); }
  };

  const removeGroup = async (g: ProjectGroup) => {
    if (!(await confirmAction({
      icon: "warning",
      title: `Hapus grup "${g.name}"?`,
      text: "Project di dalamnya harus dipindahkan dulu.",
      confirmButtonText: "Ya, Hapus",
    }))) return;
    setError(""); setNotice("");
    try {
      await api.deleteProjectGroup(g.id);
      setGroups(prev => prev.filter(x => x.id !== g.id));
      showSuccessToast(`Grup ${g.name} dihapus.`);
    } catch (e) { setError((e as Error).message); }
  };

  const saveProject = async (p: Project, patch: Parameters<typeof api.patchProject>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchProject(p.id, patch);
      setProjects(prev => prev.map(x => (x.id === p.id ? updated : x)));
      reloadGroups();
      setNotice(`${updated.name} disimpan.`);
      showSuccessToast(`${updated.name} disimpan.`);
    } catch (e) { setError((e as Error).message); }
  };

  const saveTestFile = async (file: TestFile, patch: Parameters<typeof api.patchTestFile>[1]) => {
    setError(""); setNotice("");
    try {
      const updated = await api.patchTestFile(file.id, patch);
      setFiles(prev => prev.map(x => (x.id === file.id ? updated : x)));
      setNotice(`${file.label} disimpan.`);
      showSuccessToast(`${file.label} disimpan.`);
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
    showSuccessToast(`${created.label} ditambahkan.`);
  };

  const removeTestFile = async (file: TestFile) => {
    if (!(await confirmAction({
      icon: "warning",
      title: "Hapus test file?",
      text: `${file.label} (${file.path})`,
      confirmButtonText: "Ya, Hapus",
    }))) return;
    setError(""); setNotice("");
    try {
      await api.deleteTestFile(file.id);
      setFiles(prev => prev.filter(x => x.id !== file.id));
      setNotice(`${file.label} dihapus.`);
      showSuccessToast(`${file.label} dihapus.`);
    } catch (e) { setError((e as Error).message); }
  };

  // Hapus permanen: project berriwayat ikut menghapus sesi, run, dan report.
  const deleteProject = async (p: Project) => {
    const typed = await promptText({
      icon: "warning",
      title: `Hapus permanen ${p.name}?`,
      text: `Ketik nama project untuk konfirmasi. Semua sesi, run, dan laporan project ini ikut terhapus dan tidak bisa dikembalikan.`,
      confirmButtonText: "Hapus permanen",
    });
    if (typed == null) return;
    if (typed.trim() !== p.name) {
      showErrorAlert("Nama tidak cocok", `Ketik persis "${p.name}" untuk menghapus.`);
      return;
    }
    setError(""); setNotice("");
    try {
      await api.deleteProject(p.id, true);
      setProjects(prev => prev.filter(x => x.id !== p.id));
      setFiles(prev => prev.filter(f => f.project_id !== p.id));
      reloadGroups();
      setNotice(`${p.name} dihapus.`);
      showSuccessToast(`${p.name} dihapus.`);
    } catch (e) { setError((e as Error).message); }
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
            {dirty ? "Belum disimpan" : saved ? `Tersimpan ${fmtTime(saved)}` : "Nilai aktif"}
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
                  min={field.min}
                  max={field.max}
                  step={1}
                  inputMode="numeric"
                  aria-invalid={fieldInvalid(field)}
                  value={draft[field.key] ?? settings[field.key]}
                  onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                />
                <span aria-hidden="true">{field.suffix}</span>
              </span>
              <span className="pb-set-help">
                {field.min.toLocaleString("id-ID")}-{field.max.toLocaleString("id-ID")} {field.suffix}. {field.help}
              </span>
            </label>
          ))}
        </div>
        <div className="pb-set-foot">
          <button className="pb-btn primary" onClick={() => saveSection(section)}
            disabled={busy || !dirty || section.fields.some(fieldInvalid)}
            title={section.fields.some(fieldInvalid) ? "Ada nilai di luar rentang." : undefined}>
            Simpan
          </button>
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
  const genProjects = activeProjects.map(p => ({ id: p.id, name: p.name }));
  const genProject = activeProjects.find(p => p.id === genProjectId) ?? null;
  const genFile = genProject ? pwFiles.find(f => f.project_id === genProject.id) ?? null : null;
  const genUrl = genProject ? (genProject.local_url || genProject.base_url || "") : "";

  return (
    <>
      <div className="pb-head">
        <div>
          <h1>Pengaturan.</h1>
          <p className="pb-lead">{TAB_HINT[tab]}</p>
        </div>
      </div>
      {error && <div className="pb-err" role="alert">{error}</div>}
      {notice && <div className="pb-note flash">{notice}</div>}

      <div className="pb-tabs pb-set-tabbar" role="tablist" aria-label="Bagian pengaturan">
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
            <SpecGenerator
              projectOptions={genProjects}
              onProjectChange={id => { setGenProjectId(id); rememberProject(id); }}
              defaultUrl={genUrl}
              projectId={genProject?.id}
              projectSlug={genProject?.slug}
              projectName={genProject?.name}
              existingFile={genFile}
              onSaved={file => {
                setFiles(prev => [...prev.filter(f => f.id !== file.id), file]);
                setNotice(`${file.label} disimpan ke ${file.path}.`);
              }}
            />

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
              {genProjects.length === 0 && (
                <p className="pb-empty">
                  Belum ada project aktif. Tambahkan project dulu di tab Project.
                </p>
              )}
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

            <section className="pb-card">
              <div className="pb-card-head">
                <div>
                  <h2>Setelan Playwright per project</h2>
                  <div className="pb-card-sub">
                    Nilai ini ditulis ke <code className="pb-mono">test_files.config</code> spec
                    pertama project dan dipakai saat config runner digenerate.
                  </div>
                </div>
              </div>
              {activeProjects.map(p => (
                <PwCard key={p.id} project={p}
                  file={pwFiles.find(f => f.project_id === p.id) ?? null}
                  onSave={saveTestFile} />
              ))}
              {activeProjects.length === 0 && (
                <p className="pb-empty">Belum ada project aktif.</p>
              )}
            </section>
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

              {/* Aksi tambah selalu di posisi yang sama; form muncul di bawahnya
                  supaya daftar project tidak terdorong saat panel ditutup. */}
              <div className="pb-set-toolbar">
                <button className={`pb-btn sm ${addPanel === "group" ? "primary" : ""}`}
                  aria-expanded={addPanel === "group"}
                  onClick={() => setAddPanel(addPanel === "group" ? null : "group")}>
                  + Grup
                </button>
                <button className={`pb-btn sm ${addPanel === "project" ? "primary" : ""}`}
                  aria-expanded={addPanel === "project"}
                  onClick={() => setAddPanel(addPanel === "project" ? null : "project")}>
                  + Project
                </button>
                <span className="pb-spacer" />
                <span className="pb-set-status">{projects.length} project · {groups.length} grup</span>
              </div>

              {addPanel === "group" && (
                <div className="pb-add-panel">
                  <span className="pb-card-sub">Grup baru</span>
                  <NewGroupForm onCreate={async name => { await addGroup(name); setAddPanel(null); }} />
                </div>
              )}

              {addPanel === "project" && (
                <div className="pb-add-panel">
                  <span className="pb-card-sub">
                    Project baru. base_url wajib; slug dipakai sebagai kunci di CLI dan URL report.
                  </span>
                  <NewProjectForm groups={groups}
                    onCreate={async body => { await createProject(body); setAddPanel(null); }} />
                </div>
              )}

              <div className="pb-note" style={{ marginTop: 14 }}>
                <p className="pb-note-title">Env local dijalankan dari mesin server dashboard</p>
                Kalau dashboard dihosting, isi <code>local_url</code> dengan URL tunnel
                (cloudflared/ngrok) ke web lokal, bukan 127.0.0.1. Origin-nya wajib terdaftar
                di origins project atau <code>TARGET_ALLOWLIST</code>.
              </div>

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
                            onClick={() => confirmRun({
                              title: "Batalkan ganti nama grup?",
                              text: "Perubahan nama yang belum disimpan akan dibuang.",
                              confirmButtonText: "Ya, Batal",
                            }, () => {
                              setEditingGroup(null);
                              showInfoToast("Ganti nama grup dibatalkan.");
                            })}>Batal</button>
                        </>
                      ) : (
                        <>
                          <strong>{g.name}</strong>
                          <span className="pb-muted pb-mono">{own.length} project</span>
                          <span className="pb-spacer" />
                          <button className="pb-btn sm"
                            onClick={() => confirmRun({
                              title: `Ganti nama grup "${g.name}"?`,
                              confirmButtonText: "Ganti",
                            }, () => {
                              setEditingGroup(g.id); setGroupName(g.name);
                              showInfoToast("Mode ganti nama grup aktif.");
                            })}>
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

          </>
        )}

        {tab === "bantuan" && <Bantuan />}

      </div>
    </>
  );
}
