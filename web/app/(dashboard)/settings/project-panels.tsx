"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Project, type ProjectGroup, type TestFile } from "../../../lib/playbook";
import { confirmAction, confirmRun, showInfoToast } from "../../../lib/alerts";
import LhConfigEditor, { LH_CATEGORIES, extraUrlsOf, lhConfigError, parseLhConfig } from "../../_components/lh-config-editor";

type SaveProject = (p: Project, patch: Parameters<typeof api.patchProject>[1]) => Promise<void>;
type SaveFile = (file: TestFile, patch: Parameters<typeof api.patchTestFile>[1]) => Promise<void>;
type AddFile = (p: Project, body: Omit<Parameters<typeof api.createTestFile>[0], "projectId">) => Promise<void>;
type ProjectHandlers = {
  onSave: SaveProject;
  onAddFile: AddFile;
  onRemoveFile: (f: TestFile) => Promise<void>;
  onToggleFile: (f: TestFile) => Promise<void>;
  onDelete: (p: Project) => Promise<void>;
};

// Config default Lighthouse: target utama selalu ikut diaudit runner.
const lhDefaultBody = (project: Project) => ({
  tool: "lh" as const,
  path: `lighthouserc.${project.slug}.js`,
  config: {
    urls: [], numberOfRuns: 1,
    budgets: Object.fromEntries(LH_CATEGORIES.map(c => [c.key, { minScore: 0.6 }])),
  },
});

// Editor config lhci per project; bentuk JSON sama dengan /lighthouse (PRD T09).
export function LhciCard({ project, file, onSave, onAddFile, onDirtyChange, registerSave }: {
  project: Project;
  file: TestFile | null;
  onSave: SaveFile;
  onAddFile: AddFile;
  onDirtyChange: (dirty: boolean) => void;
  registerSave: (save: (() => Promise<boolean>) | null) => void;
}) {
  const target = project.base_url || "";
  const [config, setConfig] = useState(file?.config ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !!file && config !== (file.config ?? "");

  const save = useCallback(async (): Promise<boolean> => {
    if (!file) return false;
    const cfg = parseLhConfig(config);
    const msg = lhConfigError({
      target, extra: extraUrlsOf(cfg, project),
      runs: cfg.numberOfRuns ?? 1,
      scores: Object.fromEntries(LH_CATEGORIES.map(c => [
        c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100),
      ])),
    });
    if (msg) { setError(msg); return false; }
    setSaving(true); setError("");
    try { await onSave(file, { config }); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setSaving(false); }
  }, [config, file, onSave, project, target]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    registerSave(dirty ? save : null);
    return () => registerSave(null);
  }, [dirty, registerSave, save]);
  // Draft ikut hilang saat card dilepas; jangan biarkan status global tertinggal.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Config default dari URL project.
  const create = async () => {
    if (!(await confirmAction({
      title: "Buat config Lighthouse default?",
      text: `${project.name}: target utama, 1 run, budget 60.`,
      confirmButtonText: "Ya, Buat",
    }))) return;
    setSaving(true); setError("");
    try {
      await onAddFile(project, lhDefaultBody(project));
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

      {error && <div className="pb-err" role="alert">{error}</div>}

      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">
          {!file ? "Belum ada config" : saving ? "Menyimpan…" : dirty ? "Belum disimpan" : "Tersimpan"}
        </span>
        <span className="pb-spacer" />
        {!file ? (
          <button className="pb-btn sm primary" onClick={create}
            disabled={saving || !target.trim()}>
            Buat config default
          </button>
        ) : (
          <span className="pb-muted" style={{ fontSize: 12 }}>
            {dirty ? "Perubahan ikut tombol Simpan Semua." : "Nilai aktif."}
          </span>
        )}
      </div>
    </div>
  );
}

// Setelan Playwright per project (PRD S03), disimpan di config spec pertama.
type PwCfg = { env?: string; timeout?: number; workers?: number; retries?: number };

export function PwCard({ project, file, onSave, onDirtyChange, registerSave }: {
  project: Project;
  file: TestFile | null;
  onSave: SaveFile;
  onDirtyChange: (dirty: boolean) => void;
  registerSave: (save: (() => Promise<boolean>) | null) => void;
}) {
  const parsed = (() => {
    try { return (JSON.parse(file?.config ?? "{}") ?? {}) as PwCfg; } catch { return {} as PwCfg; }
  })();
  const [pw, setPw] = useState<PwCfg>({
    env: parsed.env ?? "local",
    timeout: parsed.timeout ?? 120000,
    workers: parsed.workers ?? 1,
    retries: parsed.retries ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !!file && (pw.env !== (parsed.env ?? "local")
    || pw.timeout !== (parsed.timeout ?? 120000)
    || pw.workers !== (parsed.workers ?? 1)
    || pw.retries !== (parsed.retries ?? 0));

  const save = useCallback(async (): Promise<boolean> => {
    if (!file) return false;
    const timeout = pw.timeout ?? 120000;
    const workers = pw.workers ?? 1;
    const retries = pw.retries ?? 0;
    if (!Number.isSafeInteger(timeout) || timeout < 10000 || timeout > 900000) {
      setError("Timeout harus 10.000-900.000 ms."); return false;
    }
    if (!Number.isSafeInteger(workers) || workers < 1 || workers > 8) {
      setError("Workers harus 1-8."); return false;
    }
    if (!Number.isSafeInteger(retries) || retries < 0 || retries > 3) {
      setError("Retries harus 0-3."); return false;
    }
    setSaving(true); setError("");
    try { await onSave(file, { config: JSON.stringify({ ...parsed, ...pw }) }); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setSaving(false); }
  }, [file, onSave, parsed, pw]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    registerSave(dirty ? save : null);
    return () => registerSave(null);
  }, [dirty, registerSave, save]);
  // Draft ikut hilang saat card dilepas; jangan biarkan status global tertinggal.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  return (
    <div className="pb-proj-card">
      <div className="pb-row pb-proj-head">
        <strong>{project.name}</strong>
        <span className="pb-muted pb-mono">{file?.path ?? "belum ada spec"}</span>
      </div>
      {file ? (
        <div className="pb-set-grid">
          <label className="pb-set-field">
            <span className="pb-set-label">Env default</span>
            <select className="pb-select" value={pw.env}
              onChange={e => setPw(v => ({ ...v, env: e.target.value }))}>
              {["local", "staging", "production"].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <span className="pb-set-help">Env yang terpilih otomatis saat halaman run dibuka.</span>
          </label>
          <label className="pb-set-field">
            <span className="pb-set-label">Timeout per test</span>
            <span className="pb-input-unit">
              <input className="pb-input" type="number" min={10000} max={900000} step={1000}
                inputMode="numeric" value={pw.timeout}
                onChange={e => setPw(v => ({ ...v, timeout: Number(e.target.value) || 0 }))} />
              <span aria-hidden="true">ms</span>
            </span>
            <span className="pb-set-help">10.000-900.000 ms. Test lebih lama dari ini ditandai gagal.</span>
          </label>
          <label className="pb-set-field">
            <span className="pb-set-label">Workers</span>
            <span className="pb-input-unit">
              <input className="pb-input" type="number" min={1} max={8} inputMode="numeric"
                value={pw.workers}
                onChange={e => setPw(v => ({ ...v, workers: Number(e.target.value) || 1 }))} />
              <span aria-hidden="true">worker</span>
            </span>
            <span className="pb-set-help">Spec eureka memakai state bersama; 1 worker paling aman.</span>
          </label>
          <label className="pb-set-field">
            <span className="pb-set-label">Retries</span>
            <span className="pb-input-unit">
              <input className="pb-input" type="number" min={0} max={3} inputMode="numeric"
                value={pw.retries}
                onChange={e => setPw(v => ({ ...v, retries: Number(e.target.value) || 0 }))} />
              <span aria-hidden="true">kali</span>
            </span>
            <span className="pb-set-help">Test gagal diulang sebanyak ini sebelum dinyatakan gagal.</span>
          </label>
        </div>
      ) : (
        <p className="pb-hint">Tambahkan spec Playwright dulu di daftar Spec Playwright.</p>
      )}
      {error && <div className="pb-err" role="alert">{error}</div>}
      <div className="pb-row pb-proj-foot">
        <span className="pb-set-status">
          {!file ? "Belum ada spec" : saving ? "Menyimpan…" : dirty ? "Belum disimpan" : "Tersimpan"}
        </span>
        <span className="pb-spacer" />
        <span className="pb-muted" style={{ fontSize: 12 }}>
          {dirty ? "Perubahan ikut tombol Simpan Semua." : "Nilai aktif."}
        </span>
      </div>
    </div>
  );
}

// Tambah grup baru. Enter di kolom = simpan.
export function NewGroupForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !name.trim()) return;
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

// Tambah project. base_url wajib (server menolak yang kosong).
export function NewProjectForm({ groups, onCreate }: {
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
    if (busy || !name.trim() || !base.trim()) return;
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
      {error && <div className="pb-err" role="alert">{error}</div>}
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

// BASE_URL diisi runner dari target sesi (local/staging/production).
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\\/+$/, "");

test("halaman utama terbuka", async ({ page }) => {
  const res = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(res, "halaman merespons").not.toBeNull();
  expect(res!.status(), "HTTP status halaman").toBeLessThan(400);
  await expect(page).toHaveURL((u) => u.origin === new URL(BASE).origin);
  await expect(page.locator("body")).toBeVisible();
});
`;

// Satu project di pohon grup: pindah grup, arsip/pulihkan, dan detail URL.
export function ProjectRow({ project, groups, files, onSave, onAddFile, onRemoveFile, onToggleFile, onDelete }: {
  project: Project;
  groups: ProjectGroup[];
  files: TestFile[];
} & ProjectHandlers) {
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
        <button className="pb-btn sm danger" title="Hapus permanen project"
          onClick={() => onDelete(project)}>Hapus</button>
      </div>
      {open && (
        <ProjectDetail project={project} files={files} onSave={onSave}
          onAddFile={onAddFile} onRemoveFile={onRemoveFile} onToggleFile={onToggleFile} onDelete={onDelete} />
      )}
    </div>
  );
}

// Detail URL/origin project + test file. Slug read-only karena dipakai CLI dan URL report.
function ProjectDetail({ project, files, onSave, onAddFile, onRemoveFile, onToggleFile, onDelete }: {
  project: Project;
  files: TestFile[];
} & ProjectHandlers) {
  const [name, setName] = useState(project.name);
  const [base, setBase] = useState(project.base_url ?? "");
  const [staging, setStaging] = useState(project.staging_url ?? "");
  const [local, setLocal] = useState(project.local_url ?? "");
  const [origins, setOrigins] = useState(project.origins.join(", "));
  const [allowProd, setAllowProd] = useState(!!project.allow_production);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState(`${project.name} Playwright`.slice(0, 200));
  const [path, setPath] = useState(`tests/${project.slug}.spec.ts`);
  const [code, setCode] = useState(SPEC_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const own = files.filter(f => f.project_id === project.id);
  const hasLh = own.some(f => f.tool === "lh");
  // Petunjuk untuk UI saja; server tetap penjaga terakhir lewat 409.
  const deletable = !own.length && !project.lastRunAt;

  const save = async () => {
    if (!(await confirmAction({
      title: `Simpan ${project.name}?`,
      text: "Nama, URL, origin, dan izin production diperbarui.",
      confirmButtonText: "Ya, Simpan",
    }))) return;
    await onSave(project, {
      name: name.trim(),
      base_url: base.trim(),
      staging_url: staging.trim() || null,
      local_url: local.trim() || null,
      origins: origins.split(",").map(s => s.trim()).filter(Boolean),
      allow_production: allowProd ? 1 : 0,
    });
  };

  const addSpec = async () => {
    if (!(await confirmAction({
      title: "Tambah spec Playwright?",
      text: `${path.trim()} untuk ${project.name}.`,
      confirmButtonText: "Ya, Tambah",
    }))) return;
    setBusy(true); setErr("");
    try {
      // label wajib di server; kalau user mengosongkannya, pakai nama file.
      const specLabel = (label.trim() || path.trim().split("/").pop() || project.name).slice(0, 200);
      await onAddFile(project, { tool: "pw", path: path.trim(), label: specLabel, code });
      setAddOpen(false);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Config default dari URL project.
  const addLhConfig = async () => {
    if (!(await confirmAction({
      title: "Buat config Lighthouse?",
      text: `${project.name}: target utama, 1 run, budget 60.`,
      confirmButtonText: "Ya, Buat",
    }))) return;
    setBusy(true); setErr("");
    try {
      await onAddFile(project, lhDefaultBody(project));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const fileActions = (
    <>
      <button className="pb-btn sm" onClick={() => confirmRun({
        title: addOpen ? "Batal tambah spec?" : "Buka form spec Playwright?",
        confirmButtonText: addOpen ? "Ya, Batal" : "Buka",
      }, () => {
        setAddOpen(o => !o);
        showInfoToast(addOpen ? "Tambah spec dibatalkan." : "Form spec dibuka.");
      })} disabled={busy}>
        {addOpen ? "Batal" : "+ Spec Playwright"}
      </button>
      {!hasLh && (
        <button className="pb-btn sm" onClick={addLhConfig} disabled={busy}>
          Buat config Lighthouse
        </button>
      )}
    </>
  );

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
            <span className="pb-spec-actions">
              <button className="pb-btn sm" onClick={() => onToggleFile(f)}>
                {f.enabled ? "Nonaktifkan" : "Aktifkan"}
              </button>
              <button className="pb-btn sm danger" onClick={() => onRemoveFile(f)}>Hapus</button>
            </span>
          </div>
        ))}
        {own.length === 0 ? (
          <div className="pb-file-empty">
            <p className="pb-hint">
              Belum ada spec atau config. Generate spec lewat form di atas, atau buat manual:
            </p>
            <div className="pb-row" style={{ gap: 8 }}>{fileActions}</div>
          </div>
        ) : (
          <div className="pb-row pb-proj-foot" style={{ gap: 8 }}>{fileActions}</div>
        )}

        {addOpen && (
          <div className="pb-lh-field pb-proj-foot">
            <label className="pb-field">label
              <input className="pb-input" value={label} maxLength={200}
                onChange={e => setLabel(e.target.value)}
                placeholder={`${project.name} Playwright`} />
            </label>
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
            Project ini punya riwayat. Hapus permanen akan ikut menghapus semua sesi, run, dan laporan. Pakai Arsipkan kalau report masih mau dibuka.
          </p>
        )}
        <div className="pb-row pb-proj-foot">
          <button className="pb-btn sm danger" onClick={() => onDelete(project)}>
            Hapus permanen
          </button>
        </div>
        {err && <div className="pb-err" role="alert">{err}</div>}
      </div>
    </div>
  );
}

