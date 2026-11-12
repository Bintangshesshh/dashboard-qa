"use client";

// Editor config Lighthouse CI bersama untuk Pengaturan dan /lighthouse (PRD T09).
// Bentuk JSON-nya satu: { urls, numberOfRuns, budgets } → test_files.config.
// Komponen ini controlled: nilai masuk/keluar berupa string JSON, jadi dua
// halaman menulis bentuk yang sama dan autosave tidak menimpa nilai custom.
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../lib/playbook";
import { confirmAction, showErrorAlert, showInfoToast } from "../../lib/alerts";

// Sama dengan batas server: target sesi memakai 1 slot dari 5 URL.
export const MAX_EXTRA_URLS = 4;
export const MAX_RUNS = 10;

export const LH_CATEGORIES = [
  { key: "categories:performance", label: "Performa" },
  { key: "categories:accessibility", label: "Aksesibilitas" },
  { key: "categories:best-practices", label: "Praktik terbaik" },
  { key: "categories:seo", label: "SEO" },
];

export type LhConfig = {
  urls?: string[];
  numberOfRuns?: number;
  budgets?: Record<string, { minScore: number }>;
  formFactor?: "mobile" | "desktop" | "both";
  locale?: "id" | "en";
};

export const parseLhConfig = (raw: string | null | undefined): LhConfig => {
  try {
    const v = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" ? (v as LhConfig) : {};
  } catch { return {}; }
};

// Ubah sebagian config tanpa menyentuh isian lain; dipakai kontrol ringkas
// (jumlah run, bahasa) yang juga tampil di kartu project halaman Lighthouse.
export const patchLhConfig = (raw: string | null | undefined, patch: Partial<LhConfig>) =>
  JSON.stringify({ ...parseLhConfig(raw), formFactor: "both", ...patch });

const originOf = (v: string) => { try { return new URL(v).origin; } catch { return ""; } };
// Baris URL tambahan hanya menampilkan path; origin target tampil sebagai chip.
const pathOf = (v: string) => { try { const u = new URL(v); return u.pathname + u.search + u.hash; } catch { return v; } };

const sameUrl = (a: string, b: string) => {
  try { return new URL(a).href === new URL(b).href; } catch { return a.trim() === b.trim(); }
};

// URL yang sama dengan target project bukan "tambahan"; kalau dihitung,
// URL lama hasil seed akan muncul sebagai duplikat di form.
export const extraUrlsOf = (cfg: LhConfig, project: Project) => {
  const known = [project.base_url, project.staging_url, project.local_url].filter(Boolean) as string[];
  return (cfg.urls ?? []).filter(u => !known.some(k => sameUrl(u, k)));
};

// URL tambahan yang host-nya milik project ikut origin target (env terpilih).
// Sama dengan logika server di runner.mjs: lhUrls().
export const effectiveUrls = (target: string, extra: string[], project: Project) => {
  const origin = (v: string) => { try { return new URL(v).origin; } catch { return null; } };
  const known = new Set([project.base_url, project.staging_url, project.local_url].filter(Boolean).map(v => origin(v as string)).filter(Boolean));
  const base = origin(target);
  return extra.map(raw => {
    if (!base) return raw;
    try {
      const u = new URL(raw);
      return known.has(u.origin) ? base + u.pathname + u.search + u.hash : raw;
    } catch { return raw; }
  });
};

const isHttp = (u: string) => {
  try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; }
};

export const parseExtraUrl = (typed: string, current: string, target: string) => {
  const value = typed.trim();
  if (!value || isHttp(value)) return value;
  const base = originOf(current) || originOf(target);
  if (base && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return base + value;
  return value;
};

// Origin yang boleh dipakai URL tambahan: allowlist project + URL env project.
export const allowedOriginsOf = (project: Project, target: string) => {
  const list = [
    ...(project.origins ?? []),
    project.base_url, project.staging_url, project.local_url, target,
  ];
  return new Set(list.map(v => v ? originOf(v) : "").filter(Boolean));
};

// Validasi ketat sebelum URL masuk ke chip: path wajib diawali "/" dan URL
// penuh harus memakai origin yang terdaftar pada project.
export type ExtraUrlReason = "empty" | "format" | "origin" | "duplicate";

export const validateExtraUrl = (
  typed: string, target: string, project: Project, existing: string[],
): { value: string; error: string; reason?: ExtraUrlReason; origin?: string; allowed?: string[] } => {
  const value = parseExtraUrl(typed, target, target);
  if (!value) return { value, error: "URL tidak boleh kosong.", reason: "empty" };
  if (!isHttp(value)) {
    return {
      value, reason: "format",
      error: "Path harus diawali dengan / atau berupa URL lengkap yang valid.",
    };
  }
  const allowed = allowedOriginsOf(project, target);
  if (!allowed.has(originOf(value))) {
    return {
      value, reason: "origin", origin: originOf(value), allowed: [...allowed],
      error: "Origin atau path URL tidak diizinkan untuk project ini!",
    };
  }
  if (existing.some(u => sameUrl(u, value))) {
    return { value, reason: "duplicate", error: "URL ini sudah ada di daftar." };
  }
  return { value, error: "" };
};

// Pesan error pertama, atau "" kalau form sah. Dipakai sebelum simpan.
export function lhConfigError(draft: {
  target: string; extra: string[]; runs: number; scores: Record<string, number>;
}): string {
  const { target, extra, runs, scores } = draft;
  if (!target.trim()) return "Project ini belum punya URL target. Isi URL project dulu di tab Project.";
  if (extra.length > MAX_EXTRA_URLS) return `Maksimal ${MAX_EXTRA_URLS} URL tambahan.`;
  for (const u of extra) if (!isHttp(u)) return `URL tambahan tidak valid: ${u}`;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) return `Jumlah run harus 1-${MAX_RUNS}.`;
  for (const c of LH_CATEGORIES) {
    const v = scores[c.key];
    if (v == null || v < 0 || v > 100) return `Skor ${c.label} harus 0-100.`;
  }
  return "";
}

// Perkiraan durasi: tiap audit ~90 dtk, ditambah 5 menit overhead; both = 2 device.
export const lhEstimateMs = (urlCount: number, runs: number, devices = 1) => 300_000 + urlCount * runs * Math.max(1, devices) * 90_000;

export function LhRunsLocale({
  runs = 1,
  locale = "id",
  disabled,
  onChange,
  part = "both",
}: {
  runs?: number;
  locale?: NonNullable<LhConfig["locale"]>;
  disabled?: boolean;
  onChange: (patch: { runs?: number; locale?: NonNullable<LhConfig["locale"]> }) => void;
  // Dipisah supaya pill bahasa bisa sejajar dengan kolom skor minimum.
  part?: "both" | "runs" | "locale";
}) {
  const clamp = (v: number) => Math.min(MAX_RUNS, Math.max(1, v));
  return (
    <div className={`pb-lh-inline${part === "both" ? "" : " pb-lh-inline-single"}`}>
      {part !== "locale" && (<div className="pb-field pb-lh-runs">
        <span>Jumlah run per URL (1-{MAX_RUNS})</span>
        <div className="pb-seg" role="group" aria-label="Jumlah run per URL">
          {[1, 2, 3].map(n => (
            <button key={n} type="button" className={runs === n ? "active" : ""}
              aria-pressed={runs === n} disabled={disabled}
              onClick={() => onChange({ runs: n })}>{n}×</button>
          ))}
          <span className="pb-lh-stepper">
            <button type="button" className="pb-lh-step" aria-label="Kurangi jumlah run"
              disabled={disabled || runs <= 1}
              onClick={() => onChange({ runs: clamp(runs - 1) })}>−</button>
            <input className="pb-lh-step-v pb-mono" type="number" min={1} max={MAX_RUNS}
              value={runs} disabled={disabled} aria-label="Jumlah run"
              onChange={e => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 1 && v <= MAX_RUNS) onChange({ runs: v });
              }} />
            <button type="button" className="pb-lh-step" aria-label="Tambah jumlah run"
              disabled={disabled || runs >= MAX_RUNS}
              onClick={() => onChange({ runs: clamp(runs + 1) })}>+</button>
          </span>
        </div>
      </div>)}

      {part !== "runs" && (<div className="pb-field">
        <span>Bahasa report</span>
        <div className="pb-seg" role="group" aria-label="Bahasa report Lighthouse">
          {([["id", "Indonesia"], ["en", "Inggris"]] as const).map(([value, label]) => (
            <button key={value} type="button" className={locale === value ? "active" : ""}
              aria-pressed={locale === value} disabled={disabled}
              onClick={() => { onChange({ locale: value }); }}>{label}</button>
          ))}
        </div>
      </div>)}
    </div>
  );
}

export default function LhConfigEditor({
  project, value, target, disabled, onChange, idPrefix = "lh", showTarget = true,
  showRunsAndLocale = true,
}: {
  project: Project;
  value: string | null;
  target: string;
  disabled?: boolean;
  onChange: (json: string) => void;
  idPrefix?: string;
  // Halaman Lighthouse sudah menampilkan target di kartu atas; jangan ulangi di form.
  showTarget?: boolean;
  showRunsAndLocale?: boolean;
}) {
  const cfg = parseLhConfig(value);
  const [extra, setExtra] = useState<string[]>(() => extraUrlsOf(cfg, project));
  const [runs, setRuns] = useState(cfg.numberOfRuns ?? 1);
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(LH_CATEGORIES.map(c => [c.key, Math.round((cfg.budgets?.[c.key]?.minScore ?? 0.6) * 100)])),
  );
  const [locale, setLocale] = useState<NonNullable<LhConfig["locale"]>>(cfg.locale ?? "id");
  const [urlInput, setUrlInput] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  const addExtraUrl = () => {
    if (disabled || extra.length >= MAX_EXTRA_URLS) return;
    const result = validateExtraUrl(urlInput, target, project, extra);
    if (result.error) {
      let title = "URL Tidak Valid";
      let message = result.error;
      if (result.reason === "origin") {
        title = "Domain Tidak Diizinkan";
        message = `Origin "${result.origin ?? "-"}" tidak sesuai dengan project ini. `
          + `Gunakan origin: ${(result.allowed ?? []).join(", ") || "belum tersedia"}.`;
      } else if (result.reason === "duplicate") {
        title = "URL Sudah Ada";
        message = "Path atau URL ini sudah terdaftar. Gunakan URL yang berbeda.";
      } else if (result.reason === "format") {
        title = "Format URL Tidak Valid";
        message = "Path harus diawali dengan / (contoh /kategori) atau berupa URL lengkap yang valid.";
      }
      setUrlInput("");
      urlInputRef.current?.focus();
      void showErrorAlert(title, message);
      return;
    }
    const next = [...extra, result.value];
    setExtra(next); emit({ extra: next }); setUrlInput("");
    showInfoToast("URL tambahan ditambahkan.");
  };

  // Nilai dari luar (config dimuat belakangan / diganti di tab lain) disalin ke
  // form, tapi hasil emit sendiri diabaikan supaya autosave tidak mereset input.
  const lastEmit = useRef(value ?? "");
  useEffect(() => {
    if ((value ?? "") === lastEmit.current) return;
    const next = parseLhConfig(value);
    lastEmit.current = value ?? "";
    setExtra(extraUrlsOf(next, project));
    setRuns(next.numberOfRuns ?? 1);
    setScores(Object.fromEntries(LH_CATEGORIES.map(c => [
      c.key, Math.round((next.budgets?.[c.key]?.minScore ?? 0.6) * 100),
    ])));
    setLocale(next.locale ?? "id");
  }, [value, project]);

  const emit = (next: {
    extra?: string[]; runs?: number; scores?: Record<string, number>;
    locale?: NonNullable<LhConfig["locale"]>;
  }) => {
    const e = next.extra ?? extra;
    const r = next.runs ?? runs;
    const s = next.scores ?? scores;
    const json = JSON.stringify({
      urls: e.map(u => u.trim()).filter(Boolean),
      numberOfRuns: r,
      budgets: Object.fromEntries(LH_CATEGORIES.map(c => [c.key, { minScore: (s[c.key] ?? 60) / 100 }])),
      // UI tidak lagi memberi pilihan device: selalu audit mobile + desktop.
      formFactor: "both",
      locale: next.locale ?? locale,
    });
    lastEmit.current = json;
    onChange(json);
  };

  const clean = extra.map(u => u.trim()).filter(Boolean);
  const totalUrls = (target.trim() ? 1 : 0) + clean.length;
  const devices = 2;
  const totalAudits = totalUrls * runs * devices;
  const roughMinutes = Math.round(lhEstimateMs(totalUrls, runs, devices) / 60000);
  const err = lhConfigError({ target, extra: clean, runs, scores });

  return (
    <div className="pb-lh-form">
      <div className="pb-lh-columns">
        <div className="pb-lh-col">

          {showRunsAndLocale && (
            <LhRunsLocale
              part="runs"
              runs={runs}
              locale={locale}
              disabled={disabled}
              onChange={patch => {
                if (patch.runs !== undefined) setRuns(patch.runs);
                if (patch.locale !== undefined) setLocale(patch.locale);
                emit(patch);
              }}
            />
          )}

          <div className="pb-field">
            <span>URL tambahan ({clean.length}/{MAX_EXTRA_URLS})</span>
            <div className="pb-lh-url-add">
              <input ref={urlInputRef} className="pb-input pb-mono" value={urlInput}
                disabled={disabled || extra.length >= MAX_EXTRA_URLS}
                aria-label="URL tambahan baru"
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExtraUrl(); } }} />
              <button type="button" className="pb-btn sm primary" disabled={disabled || !urlInput.trim() || extra.length >= MAX_EXTRA_URLS}
                onClick={addExtraUrl}>+</button>
            </div>
            <div className="pb-lh-url-chips">
              {clean.map((u, i) => <div className="pb-lh-url-chip" key={`${u}-${i}`}>
                <span title={u}>{pathOf(u)}</span>
                <button type="button" aria-label={`Hapus URL ${i + 1}`} disabled={disabled}
                  onClick={async () => {
                    if (!(await confirmAction({ icon: "warning", title: "Hapus URL tambahan?", text: `URL ke-${i + 1} akan dihapus dari config.`, confirmButtonText: "Ya, Hapus" }))) return;
                    const next = extra.filter((_, j) => j !== i);
                    setExtra(next); emit({ extra: next }); showInfoToast("URL tambahan dihapus.");
                  }}>✕</button>
              </div>)}
            </div>
          </div>
        </div>

        <div className="pb-lh-col">
          {showRunsAndLocale && (
            <LhRunsLocale
              part="locale"
              runs={runs}
              locale={locale}
              disabled={disabled}
              onChange={patch => {
                if (patch.runs !== undefined) setRuns(patch.runs);
                if (patch.locale !== undefined) setLocale(patch.locale);
                emit(patch);
              }}
            />
          )}
          <div className="pb-lh-budget-cell">
            <span>Skor minimum per kategori</span>
            <div className="pb-lh-budgets">
              {LH_CATEGORIES.map(c => (
                <label className="pb-lh-budget" key={c.key}>
                  <span className="pb-lh-budget-label">{c.label}</span>
                  <input type="range" min={0} max={100} step={5} disabled={disabled}
                    className="pb-lh-range pb-lh-range-v" value={scores[c.key] ?? 60}
                    aria-label={"Skor minimum " + c.label}
                    onChange={e => {
                      const v = Number(e.target.value);
                      const next = { ...scores, [c.key]: v };
                      setScores(next); emit({ scores: next });
                    }} />
                  <output>{scores[c.key] ?? 60}%</output>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pb-lh-audit-total">
        <span className="pb-badge pb-lh-summary-pill">
          Total Audit: {totalAudits} ({totalUrls} URL × {runs} run{devices > 1 ? ` × ${devices} Device` : ""})
        </span>
        {totalAudits > 20 && (
          <span className="pb-badge warn">
            Perkiraan ~{roughMinutes} menit; jalankan saat tidak buru-buru
          </span>
        )}
      </div>

      {err && <div className="pb-err" role="alert">{err}</div>}
    </div>
  );
}
